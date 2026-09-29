// lib/gemini.js
//
// ORCHESTRATION IA DU COACH (nom de fichier historique : les deux fournisseurs, Gemini et
// Groq, passent par ici via lib/aiClient.js).
//
// PIPELINE D'UNE GÉNÉRATION (plan complet ou semaine) — refonte 09/2026 :
//
//   1. PROMPT (lib/coachPrompts.js) : instruction système stable + données de l'athlète,
//      arithmétique faite par le code, règles identiques à celles qui sont vérifiées.
//   2. GÉNÉRATION avec sortie structurée imposée (lib/planSchema.js).
//   3. NORMALISATION (ids uniques, jours complets, types canoniques) + enrichissement
//      déterministe des champs (sanitizeWorkout).
//   4. VALIDATION déterministe (lib/planValidation.js) : liste précise des problèmes.
//   5. RELECTURE + RÉPARATION IA : le modèle reçoit le plan ET la liste des problèmes, relit
//      la cohérence d'ensemble et renvoie des séances COMPLÈTES corrigées. Les corrections ne
//      sont acceptées que si le score de validation ne se dégrade pas.
//      (Avant : la relecture tournait APRÈS les garde-fous, ses corrections n'étaient jamais
//      revalidées et pouvaient réintroduire des erreurs.)
//   6. GARDE-FOUS DÉTERMINISTES (lib/workouts.js) en dernier recours, désormais cohérents :
//      une séance allégée est réécrite ENTIÈREMENT (titre, intensité, description), une
//      durée réduite est expliquée dans une note séparée.
//   7. VALIDATION FINALE → avertissements réellement non résolus.
//
// Mesuré au banc d'essai (test/aiPipeline.test.js) : sur un plan expert cohérent, l'ancien
// pipeline dégradait 9 séances sur 12 et lançait 2 appels IA de "complétion" inutiles ; le
// nouveau le laisse intact et répare réellement un plan défectueux.

import { callAI } from './aiClient';
import { createDeadline } from './aiConfig';
import {
  sanitizeWorkout, checkSessionCountCoherence, enforceSessionCount, dedupeIdenticalSameDaySessions,
  rebalanceSameDisciplineDoubles, enforceMaxSessionsPerDay, enforceSessionSpread, enforceThirdSessionLowIntensity,
  enforceBeginnerProgression, enforceNoConsecutiveHardDays, enforceDoubleThresholdEligibility, enforceTaperVolume,
  applyFatigueAutoRegulation, checkMonotonyWarning, checkTrailElevationWarning, injectPhysioTestSessions,
  enforceWeekVolumeCap, injectRaceEntries, enforceDayDurationCaps, enforceSwimQuality,
  enforceSwimVolumeFloor, enforceLongSessionFloor, applyBeginnerFirstPlanRamp, applyEasierTrendProgression,
  classifyDiscipline, mergeWorkoutPatches,
} from './workouts';
import {
  normalizeAiWeek, validatePlan, validateSingleWeek, buildValidationContext, scoreViolations, countErrors, sanitizeWeek,
} from './planValidation';
import { PLAN_SCHEMA, WEEK_SCHEMA, REVIEW_SCHEMA, CHAT_SCHEMA, ACTIVITY_ANALYSIS_SCHEMA, ZONE_CHECK_SCHEMA, ROUTE_PICK_SCHEMA } from './planSchema';
import {
  buildAthleteContext, buildPlanPrompt, buildWeekPrompt, buildReviewPrompt, buildChatPrompt,
  AI_LANGUAGE_NAMES, toISODateUTC, mondayOf,
} from './coachPrompts';
import { phasesToCycles, getProgressionFactor } from './periodization';
import { TIER_LABELS, getCarbRange, getFluidRange, getSodiumRange, getPotassiumRange } from './nutritionData';
import { describeLaps } from './lapsAnalysis';
import { describeActivityFacts } from './activityFacts';

// Compatibilité : anciennes signatures (prompt, provider) utilisées par du code externe éventuel.
async function callAIJSON(prompt, provider = 'gemini', opts = {}) {
  return callAI({ provider, prompt, json: true, tier: opts.tier || 'light', system: opts.system, schema: opts.schema, deadline: opts.deadline });
}
async function callAIText(prompt, provider = 'gemini', opts = {}) {
  return callAI({ provider, prompt, json: false, tier: opts.tier || 'light', system: opts.system, deadline: opts.deadline });
}

// ---------------------------------------------------------------------------------------
// Tests terrain (VMA / FTP / CSS manquantes)
// ---------------------------------------------------------------------------------------

const TEST_COOLDOWN_DAYS = 12;      // métrique manquante : pas de nouvelle proposition avant 12 j
const RETEST_AFTER_DAYS = 56;       // métrique connue : re-test proposé au-delà de ~8 semaines
const DISCIPLINE_METRIC_KEY = { 'C.A.P': 'vma', CYCLISME: 'ftp', NATATION: 'css' };
const METRIC_LABEL = { 'C.A.P': 'VMA', CYCLISME: 'FTP', NATATION: 'CSS' };

/**
 * Tests terrain à programmer dans UNE semaine donnée.
 * CORRECTIFS (simulation de 4 200 questionnaires) :
 *   - avant, toutes les métriques manquantes étaient testées la même semaine : 3 tests pour
 *     3 séances = une semaine entière de tests. Désormais au plus 1 test (≤ 5 séances ou
 *     débutant), 2 (6-9 séances) ou 3 (≥ 10) par semaine ; les autres suivent ;
 *   - avant, une métrique connue n'était jamais re-testée (une FTP de septembre servait
 *     encore en juin). Désormais re-test au-delà de ~8 semaines, uniquement en phase de
 *     base/développement et sur une semaine "fraîche" (1re semaine de charge après une
 *     décharge, ou semaine normale sans cycle) ;
 *   - avant, la régénération de semaine ne proposait jamais de test.
 * Jamais de test en semaine d'affûtage, de course, de récupération ou de décharge.
 */
export function computeTestPlan(ctx, profile, weekKey = 'N') {
  const wctx = ctx.weekCtx?.[weekKey];
  if (!wctx || ['taper', 'race', 'recovery', 'decharge'].includes(wctx.kind)) return [];
  const sessions = Number(ctx.wizardData.maxSessionsPerWeek) || 0;
  let cap = sessions >= 10 ? 3 : sessions >= 6 ? 2 : 1;
  if (ctx.expRank <= 2) cap = 1;

  const disciplines = ['C.A.P', ...(ctx.hasBike ? ['CYCLISME'] : []), ...(ctx.hasSwim ? ['NATATION'] : [])];
  const sourceOf = { 'C.A.P': ctx.physio.vmaSource, CYCLISME: ctx.physio.ftpSource, NATATION: ctx.physio.nat100Source };
  const proposedAt = profile?.physioTestProposedAt || {};
  const updatedAt = profile?.metricsUpdatedAt || {};
  const weekStart = new Date(`${wctx.weekMonday}T12:00:00Z`).getTime();
  const daysSince = (iso) => (iso ? (weekStart - new Date(iso).getTime()) / 86_400_000 : Infinity);
  const freshWeek = wctx.kind === 'normal' || (wctx.kind === 'charge' && wctx.index === 1);
  const retestPhase = ['base', 'build'].includes(wctx.phaseKey);

  const missing = [];
  const stale = [];
  disciplines.forEach((d) => {
    const metric = DISCIPLINE_METRIC_KEY[d];
    const isMissing = String(sourceOf[d] || '').startsWith('non renseignée');
    if (isMissing) {
      if (daysSince(proposedAt[metric]) >= TEST_COOLDOWN_DAYS) missing.push({ disc: d, reason: 'missing' });
      return;
    }
    if (!freshWeek || !retestPhase) return;
    const last = [proposedAt[metric], updatedAt[metric], ctx.planStartIso].filter(Boolean).sort().pop();
    if (daysSince(last) >= RETEST_AFTER_DAYS) stale.push({ disc: d, reason: 'stale' });
  });
  return [...missing, ...stale].slice(0, cap);
}

export function describeTests(tests) {
  return (tests || []).map((t) => `${METRIC_LABEL[t.disc]} (${t.reason === 'missing' ? 'métrique manquante' : 'dernière valeur de plus de 8 semaines — re-test'})`);
}

// ---------------------------------------------------------------------------------------
// Relecture + réparation
// ---------------------------------------------------------------------------------------

/**
 * Applique des corrections (séances complètes) renvoyées par l'IA. Même id = remplacement ;
 * id inconnu = ajout ; type REPOS = suppression (ou jour de repos si c'était la seule séance).
 */
export function applyCorrections(weeks, corrections, scope, profile, { sanitize = true } = {}) {
  const out = { N: [...(weeks.N || [])], 'N+1': [...(weeks['N+1'] || [])] };
  (corrections || []).forEach((raw) => {
    if (!raw || typeof raw !== 'object') return;
    const wk = raw.week === 'N+1' ? 'N+1' : 'N';
    if (!scope.includes(wk)) return;
    const fields = { ...raw };
    delete fields.week;
    const list = out[wk];
    const idx = list.findIndex((w) => w.id === fields.id);
    const isRest = classifyDiscipline(fields.type) === 'REPOS';
    if (idx !== -1) {
      if (isRest) {
        const day = list[idx].day;
        const others = list.filter((w, i) => i !== idx && w.day === day && w.type !== 'REPOS');
        if (others.length) list.splice(idx, 1);
        else list[idx] = { id: list[idx].id, day, type: 'REPOS' };
      } else {
        list[idx] = { ...fields, id: list[idx].id };
      }
    } else if (!isRest) {
      list.push(fields);
    }
  });
  const used = new Set();
  const result = { ...out };
  ['N', 'N+1'].forEach((wk) => {
    if (!scope.includes(wk)) { result[wk] = out[wk]; return; }
    const normalized = normalizeAiWeek(out[wk], wk, used);
    result[wk] = sanitize ? sanitizeWeek(normalized, profile) : normalized;
    if (!scope.includes(wk)) out[wk].forEach((w) => used.add(w.id));
  });
  return result;
}

async function reviewAndRepair({ weeks, ctx, vctx, provider, deadline, scope, validate }) {
  const before = validate(weeks);
  if (deadline && deadline.remainingMs() < 30_000) {
    return { weeks, violations: before, issues: [], accepted: false, skipped: 'budget' };
  }
  const { system, prompt } = buildReviewPrompt(ctx, { weeks, violations: before, scope });
  let data;
  try {
    data = await callAI({ provider, tier: 'review', system, prompt, schema: REVIEW_SCHEMA, deadline });
  } catch (err) {
    console.warn(`[coach] Relecture IA indisponible (${provider}) :`, err?.message || err);
    return { weeks, violations: before, issues: [], accepted: false, skipped: 'error' };
  }
  const corrections = (Array.isArray(data?.corrections) ? data.corrections : []).filter((c) => scope.includes(c?.week));
  const issues = (Array.isArray(data?.issues) ? data.issues : []).filter((i) => i && i.problem);
  if (!corrections.length) return { weeks, violations: before, issues: [], accepted: false, noChange: true };

  // Évaluation sur les valeurs BRUTES des corrections : l'enrichissement (sanitizeWorkout)
  // remplace par exemple une allure aberrante par une allure de repli, ce qui masquerait une
  // correction de mauvaise qualité et effacerait la valeur correcte d'origine.
  const raw = applyCorrections(weeks, corrections, scope, ctx.profileForSanitize, { sanitize: false });
  const after = validate(raw);
  const accepted = scoreViolations(after) <= scoreViolations(before) && countErrors(after) <= countErrors(before);
  if (!accepted) {
    console.warn(`[coach] Corrections IA rejetées (score ${scoreViolations(before)} → ${scoreViolations(after)}).`);
    return { weeks, violations: before, issues: [], accepted: false };
  }
  const correctedIds = new Set(corrections.map((c) => c.id));
  const candidate = { ...raw };
  scope.forEach((wk) => { candidate[wk] = sanitizeWeek(raw[wk], ctx.profileForSanitize); });
  return {
    weeks: candidate,
    violations: after,
    issues: issues.filter((i) => !i.id || correctedIds.has(i.id)),
    accepted: true,
  };
}

// ---------------------------------------------------------------------------------------
// Garde-fous déterministes (dernier recours)
// ---------------------------------------------------------------------------------------

const REDUCED_KINDS = ['decharge', 'taper', 'race', 'recovery', 'transition'];
const KIND_REASON = {
  decharge: 'semaine de décharge', taper: 'affûtage', race: 'semaine de course', recovery: 'récupération post-course', transition: 'transition',
};

function runDeterministicGuardrails(weeks, ctx, keys, { testsByWeek = {} } = {}) {
  const w = ctx.wizardData;
  const profile = ctx.profileForSanitize;
  const out = { ...weeks };
  keys.forEach((wk) => {
    const wctx = ctx.weekCtx?.[wk] || {};
    const kind = wctx.kind || 'normal';
    // Phase EFFECTIVE de la semaine pour les garde-fous : une semaine allégée (décharge,
    // affûtage, course, récupération, transition) ne doit jamais être regonflée par les
    // planchers de volume natation / sorties longues.
    const phaseForGuards = REDUCED_KINDS.includes(kind) ? 'recovery' : (wctx.phaseKey || ctx.phaseKey);
    const races = [
      ...(wctx.raceDay ? [{ day: wctx.raceDay, name: w.eventName || 'Course objectif', duration: w.targetTime || undefined }] : []),
      ...(wctx.otherRaces || []).map((r) => ({ day: r.day, name: r.name })),
    ];
    // Les entrées de course sont MISES DE CÔTÉ pendant les garde-fous de structure (sinon une
    // course un jour de repos obligatoire — cas fréquent le dimanche — serait déplacée ou
    // supprimée), puis réinsérées seules sur leur jour.
    const isRaceW = (x) => Boolean(x.isRace) || /^\s*🏁/.test(String(x.title || ''));
    const raceDays = new Set(races.map((r) => r.day));
    const aiRaceEntries = out[wk].filter(isRaceW);
    let list = out[wk].filter((x) => !isRaceW(x) && !raceDays.has(x.day));

    const count = list.filter((x) => x.type !== 'REPOS').reduce((sum, x) => sum + (classifyDiscipline(x.type) === 'ENCHAÎNEMENT' ? 2 : 1), 0) + races.length;
    const tripleEligible = ctx.tripleEligible;
    if (wctx.sessionsTarget) {
      if (checkSessionCountCoherence(list, wctx.sessionsTarget, w.offDays).length) {
        list = enforceSessionCount(list, wctx.sessionsTarget, w.offDays, profile, w.sportType, { tripleEligible });
      }
    } else if (w.maxSessionsPerWeek && count > Number(w.maxSessionsPerWeek)) {
      list = enforceSessionCount(list, Math.max(1, Number(w.maxSessionsPerWeek) - races.length), w.offDays, profile, w.sportType, { tripleEligible });
    }
    list = rebalanceSameDisciplineDoubles(list, w.sportType, w.offDays, w.maxSessionsPerWeek);
    list = enforceMaxSessionsPerDay(list, w.offDays, w.sportType, w.maxSessionsPerWeek, {
      fitnessLevel: w.fitnessLevel, hoursPerWeek: w.hoursPerWeek, trainingExperience: w.trainingExperience,
    });
    list = rebalanceSameDisciplineDoubles(list, w.sportType, w.offDays, w.maxSessionsPerWeek);
    if (!races.length) list = enforceSessionSpread(list, w.offDays);
    list = rebalanceSameDisciplineDoubles(list, w.sportType, w.offDays, w.maxSessionsPerWeek);
    list = enforceThirdSessionLowIntensity(list, profile);
    list = dedupeIdenticalSameDaySessions(list);
    list = enforceBeginnerProgression(list, w.fitnessLevel, phaseForGuards, w.trainingExperience, w.hasExistingTrainingBase);
    list = applyBeginnerFirstPlanRamp(list, w.fitnessLevel, w.trainingExperience, ctx.feedbackHistory, wk, w.hasExistingTrainingBase);
    if (ctx.hasSwim) list = enforceSwimVolumeFloor(list, w.fitnessLevel, w.trainingExperience, phaseForGuards, w.triathlonFormat, w.hoursPerWeek);
    if (ctx.hasSwim) list = enforceSwimQuality(list, { wizardData: w, nat100: profile?.nat100 || ctx.resolvedProfile?.nat100, weekCtx: wctx, weekHours: ctx.weekHours?.[wk] });
    list = enforceLongSessionFloor(list, w.trainingExperience, phaseForGuards, {
      sportType: w.sportType, triathlonFormat: w.triathlonFormat, distance: w.distance, trailKm: w.trailKm,
    });
    list = enforceDoubleThresholdEligibility(list, w.fitnessLevel, w.hoursPerWeek, w.trainingExperience, profile);
    list = enforceDayDurationCaps(list, w.dayCaps);
    list = enforceWeekVolumeCap(list, ctx.weekHours?.[wk], KIND_REASON[kind] || 'volume de la semaine');
    list = applyFatigueAutoRegulation(list, { trendHarder: ctx.trend.direction === 'harder', hrvLow: Boolean(ctx.hrvTrend.low), loadFatigue: ctx.loadFatigue, profile });
    if (!REDUCED_KINDS.includes(kind)) list = applyEasierTrendProgression(list, ctx.trend.direction);
    // Réinsertion des courses : celles écrites par l'IA d'abord, sinon inscription automatique.
    list = list.filter((x) => !raceDays.has(x.day) || x.type !== 'REPOS');
    list = injectRaceEntries([...list, ...aiRaceEntries.filter((x) => raceDays.has(x.day))], races, ctx.sportType, profile);
    out[wk] = sanitizeWeek(list, profile);

    const tests = (testsByWeek[wk] || []).map((t) => t.disc);
    if (tests.length) {
      // L'IA a reçu la consigne de programmer les tests : on ne complète que ceux qu'elle a oubliés.
      const forgotten = tests.filter((d) => !out[wk].some((x) => classifyDiscipline(x.type) === d && /test/i.test(x.title || '')));
      out[wk] = injectPhysioTestSessions(out[wk], forgotten, { bikeTestEquipment: w.bikeTestEquipment });
    }
  });

  const fixed = enforceNoConsecutiveHardDays(out.N, out['N+1'], { expRank: ctx.expRank, profile });
  keys.forEach((wk) => { out[wk] = fixed[wk]; });
  return out;
}

function violationMessages(violations) {
  return [...new Set((violations || []).map((v) => v.message))];
}

function autoNoteSummary(weeks, keys) {
  const count = keys.reduce((s, wk) => s + (weeks[wk] || []).filter((w) => w.autoNote).length, 0);
  return count ? [`${count} séance(s) ajustée(s) automatiquement par les garde-fous — le motif est indiqué dans le détail de chaque séance.`] : [];
}

// ---------------------------------------------------------------------------------------
// Génération d'un plan complet (semaines N et N+1)
// ---------------------------------------------------------------------------------------

export async function generatePlanWithAI({
  wizardData, profile, feedbackHistory, healthHistory, manualPaceZones, manualHrZones = null, injuryLog, raceCalendar, menstrualCycle,
  language = 'fr', provider = 'gemini', clientDate = null, deadline = null, trainingLoad = null, missedSessions = null,
  previousPlan = null, weekHistory = null,
}) {
  const budget = deadline || createDeadline();
  // CORRECTIF (longévité) : refaire le plan pour le MÊME objectif conservait pas la date de
  // début → la périodisation repartait en phase de base. On garde l'ancre si l'objectif
  // (date) est inchangé.
  const keepStart = previousPlan?.startDate && previousPlan?.date && String(previousPlan.date).slice(0, 10) === String(wizardData.targetDate || '').slice(0, 10);
  const ctx = buildAthleteContext({
    wizardData, profile, feedbackHistory, healthHistory, manualPaceZones, manualHrZones, injuryLog, raceCalendar, menstrualCycle, language, clientDate, trainingLoad, missedSessions,
    planStartDate: keepStart ? previousPlan.startDate : null, weekHistory,
  });
  const vctx = buildValidationContext({ wizardData, profile: ctx.resolvedProfile, manualPaceZones, phaseKey: ctx.phaseKey, weekHours: ctx.weekHours, weekCtx: ctx.weekCtx });
  const validate = (weeks) => validatePlan(weeks, vctx);
  const testsN = computeTestPlan(ctx, profile, 'N');

  const { system, prompt } = buildPlanPrompt(ctx, { missingMetrics: testsN });
  const { result: raw, model } = await callAI({ provider, tier: 'plan', system, prompt, schema: PLAN_SCHEMA, deadline: budget, withMeta: true });

  const usedIds = new Set();
  let weeks = {
    N: sanitizeWeek(normalizeAiWeek(raw?.weekN ?? raw?.workouts?.N, 'N', usedIds), ctx.profileForSanitize),
    'N+1': sanitizeWeek(normalizeAiWeek(raw?.weekN1 ?? raw?.workouts?.['N+1'], 'N+1', usedIds), ctx.profileForSanitize),
  };
  const sessionsIn = (list) => list.filter((w) => w.type !== 'REPOS').length;
  if (Number(wizardData.maxSessionsPerWeek) > 0 && (!sessionsIn(weeks.N) || !sessionsIn(weeks['N+1']))) {
    const err = new Error('Réponse IA incomplète : une semaine ne contient aucune séance.');
    err.code = 'PARSE_ERROR';
    throw err;
  }
  const initialViolations = validate(weeks);

  const review = await reviewAndRepair({ weeks, ctx, vctx, provider, deadline: budget, scope: ['N', 'N+1'], validate });
  weeks = review.weeks;

  weeks = runDeterministicGuardrails(weeks, ctx, ['N', 'N+1'], { testsByWeek: { N: testsN } });
  const finalViolations = validate(weeks);

  const trainingPlan = {
    title: raw?.trainingPlan?.title || wizardData.eventName || 'Objectif',
    targetTime: raw?.trainingPlan?.targetTime || '',
    splits: raw?.trainingPlan?.splits || { nat: '—', bike: '—', run: '—' },
    terrain: raw?.trainingPlan?.terrain || '',
    drafting: Boolean(raw?.trainingPlan?.drafting),
    // Déterministes (jamais laissés à l'IA) : date d'objectif, date de début (ancre de la
    // périodisation pour les régénérations suivantes), lundi de la semaine N, mésocycles.
    date: wizardData.targetDate,
    startDate: ctx.planStartIso,
    weekAnchor: toISODateUTC(mondayOf(ctx.today)),
    cycles: phasesToCycles(ctx.phases),
  };

  const resolvedProfile = {
    ...ctx.resolvedProfile,
    targetPhysio: ctx.targetPhysio,
    progressionFactor: getProgressionFactor(ctx.phaseKey),
    physioTestProposedAt: { ...(profile?.physioTestProposedAt || {}) },
  };
  testsN.forEach((t) => { resolvedProfile.physioTestProposedAt[DISCIPLINE_METRIC_KEY[t.disc]] = ctx.today.toISOString(); });
  delete resolvedProfile.paceZones;

  const qualityWarnings = [
    ...violationMessages(finalViolations),
    checkMonotonyWarning(weeks.N, 'N'),
    checkMonotonyWarning(weeks['N+1'], 'N+1'),
    checkTrailElevationWarning(weeks.N, weeks['N+1'], wizardData.sportType, wizardData.runningSubtype),
  ].filter(Boolean);

  const autoFixNotes = [
    ...review.issues.map((i) => `Semaine ${i.week || '?'} : ${i.problem} → corrigé lors de la relecture.`),
    ...autoNoteSummary(weeks, ['N', 'N+1']),
  ];

  return {
    trainingPlan,
    workouts: weeks,
    resolvedProfile,
    qualityWarnings,
    autoFixNotes,
    weekSummary: typeof raw?.weekSummary === 'string' ? raw.weekSummary.trim() : '',
    validation: {
      initialScore: scoreViolations(initialViolations),
      score: scoreViolations(finalViolations),
      errors: countErrors(finalViolations),
      reviewAccepted: review.accepted,
    },
    meta: { provider, model },
  };
}

// ---------------------------------------------------------------------------------------
// Régénération d'UNE semaine (bouton "Forcer la régénération")
// ---------------------------------------------------------------------------------------

export async function regenerateWeekWithAI({
  weekKey = 'N+1', profile, workouts, trainingPlan, constraints, feedbackHistory, healthHistory, manualPaceZones, manualHrZones = null,
  trainingLoad = null, missedSessions = null, weekHistory = null,
  injuryLog, raceCalendar, menstrualCycle, language = 'fr', provider = 'gemini', clientDate = null, deadline = null,
}) {
  if (weekKey !== 'N' && weekKey !== 'N+1') weekKey = 'N+1';
  const otherWeekKey = weekKey === 'N' ? 'N+1' : 'N';
  const budget = deadline || createDeadline();
  const wizardData = { ...(constraints || {}), firstName: constraints?.firstName || profile?.firstName };
  const ctx = buildAthleteContext({
    wizardData, profile, feedbackHistory, healthHistory, manualPaceZones, manualHrZones, injuryLog, raceCalendar, menstrualCycle, language, clientDate, trainingLoad, missedSessions,
    planStartDate: trainingPlan?.startDate, weekHistory,
  });
  const vctx = buildValidationContext({ wizardData, profile: ctx.resolvedProfile, manualPaceZones, phaseKey: ctx.phaseKey, weekHours: ctx.weekHours, weekCtx: ctx.weekCtx });
  const validate = (weeks) => validateSingleWeek(weeks, weekKey, vctx);
  const testsW = computeTestPlan(ctx, profile, weekKey);

  const usedIds = new Set((workouts?.[otherWeekKey] || []).map((w) => w.id));
  const otherWeek = normalizeAiWeek(workouts?.[otherWeekKey] || [], otherWeekKey, new Set());
  const { system, prompt } = buildWeekPrompt(ctx, { weekKey, otherWeekKey, otherWeek, missingMetrics: testsW });
  const { result: raw, model } = await callAI({ provider, tier: 'plan', system, prompt, schema: WEEK_SCHEMA, deadline: budget, withMeta: true });

  const target = sanitizeWeek(normalizeAiWeek(raw?.week ?? raw?.workouts?.[weekKey], weekKey, usedIds), ctx.profileForSanitize);
  if (Number(wizardData.maxSessionsPerWeek) > 0 && !target.some((w) => w.type !== 'REPOS')) {
    const err = new Error('Réponse IA incomplète : la semaine ne contient aucune séance.');
    err.code = 'PARSE_ERROR';
    throw err;
  }
  let weeks = { [otherWeekKey]: workouts?.[otherWeekKey] || [], [weekKey]: target };
  const initialViolations = validate(weeks);

  const review = await reviewAndRepair({ weeks, ctx, vctx, provider, deadline: budget, scope: [weekKey], validate });
  weeks = review.weeks;
  weeks = runDeterministicGuardrails(weeks, ctx, [weekKey], { testsByWeek: { [weekKey]: testsW } });
  const finalViolations = validate(weeks);

  const qualityWarnings = [
    ...violationMessages(finalViolations),
    checkMonotonyWarning(weeks[weekKey], weekKey),
  ].filter(Boolean);

  const resolvedProfile = { ...ctx.resolvedProfile, physioTestProposedAt: { ...(profile?.physioTestProposedAt || {}) } };
  testsW.forEach((t) => { resolvedProfile.physioTestProposedAt[DISCIPLINE_METRIC_KEY[t.disc]] = ctx.today.toISOString(); });
  delete resolvedProfile.paceZones;

  return {
    workouts: { ...workouts, [weekKey]: weeks[weekKey] },
    resolvedProfile,
    qualityWarnings,
    autoFixNotes: [
      ...review.issues.map((i) => `${i.problem} → corrigé lors de la relecture.`),
      ...autoNoteSummary(weeks, [weekKey]),
    ],
    weekSummary: typeof raw?.weekSummary === 'string' ? raw.weekSummary.trim() : '',
    validation: {
      initialScore: scoreViolations(initialViolations),
      score: scoreViolations(finalViolations),
      errors: countErrors(finalViolations),
      reviewAccepted: review.accepted,
    },
    meta: { provider, model },
  };
}

// ---------------------------------------------------------------------------------------
// Chat coach
// ---------------------------------------------------------------------------------------

/**
 * CORRECTIFS : le coach recevait uniquement le dernier message (aucun historique, donc
 * "et jeudi ?" était incompréhensible), ne connaissait pas la date du jour ni les dates
 * des séances ("demain", "mardi prochain"), et ses modifications n'indiquaient jamais la
 * semaine visée (tout tombait sur la semaine N). Le profil était aussi envoyé en JSON brut.
 */
export async function chatWithCoach({
  message, history = [], profile, workouts, trainingPlan, intent, sportType, constraints, feedbackHistory,
  healthHistory, manualPaceZones, manualHrZones = null, injuryLog, raceCalendar, menstrualCycle, language = 'fr', provider = 'gemini',
  clientDate = null, deadline = null, trainingLoad = null, missedSessions = null, weekHistory = null,
}) {
  const wizardData = {
    ...(constraints || {}),
    sportType: sportType || constraints?.sportType,
    firstName: profile?.firstName,
    targetDate: constraints?.targetDate || trainingPlan?.date,
  };
  const ctx = buildAthleteContext({
    wizardData, profile, feedbackHistory, healthHistory, manualPaceZones, manualHrZones, injuryLog, raceCalendar, menstrualCycle, language, clientDate, trainingLoad, missedSessions,
    planStartDate: trainingPlan?.startDate, weekHistory,
  });
  const { system, prompt } = buildChatPrompt(ctx, { message, history, workouts: workouts || {}, intent, constraints });
  const data = await callAI({ provider, tier: 'chat', system, prompt, schema: CHAT_SCHEMA, deadline: deadline || createDeadline(120_000) });

  const patches = (Array.isArray(data?.patches) ? data.patches : [])
    .filter((p) => p && typeof p === 'object')
    .map((p) => ({ ...p, week: p.week === 'N+1' ? 'N+1' : 'N' }));
  return {
    reply: typeof data?.reply === 'string' && data.reply.trim() ? data.reply.trim() : "J'ai bien pris en compte ta demande.",
    patches,
    profileForSanitize: ctx.profileForSanitize,
  };
}

/** Score de validation d'un plan après application de patches de chat (utilisé par la co-génération). */
export function scorePatchedPlan({ workouts, patches, constraints, sportType, profile, manualPaceZones }) {
  const merged = mergeWorkoutPatches(workouts || { N: [], 'N+1': [] }, patches || [], { ...profile, paceZones: manualPaceZones });
  const vctx = buildValidationContext({ wizardData: { ...(constraints || {}), sportType: sportType || constraints?.sportType }, profile, manualPaceZones });
  return scoreViolations(validatePlan(merged, vctx));
}

// --- NUTRITION : conseils basés sur les référentiels scientifiques reconnus
// (position stands ACSM/ISSN, consensus IOC nutrition sportive, littérature ultra-endurance
// récente sur les glucides multi-transportables) — voir lib/nutritionData.js pour les
// cibles numériques pré-calculées par palier d'effort, injectées ici en ancres chiffrées
// (même principe que les zones physio pour les séances d'entraînement).

const NUTRITION_GUARDRAILS = `
Tu es un(e) diététicien(ne) du sport, expert en nutrition d'endurance (triathlon/course à pied/trail).
Base-toi UNIQUEMENT sur des recommandations scientifiquement établies et consensuelles (ISSN/ACSM/IOC).
Ne jamais recommander de jeûne prolongé avant un effort intense, de restriction calorique sévère, de
compléments non réglementés, ou de quantités extrêmes hors des repères fournis.
Réponds en français, de façon concrète, actionnable (exemples précis d'aliments/boissons) et CONCISE :
pas de blabla, pas de rappel méthodologique, va droit au but. Ne mentionne pas explicitement les
référentiels scientifiques dans ta réponse (c'est déjà indiqué ailleurs dans l'interface).
`;

function validateNutritionText(text) {
  const banned = /jeûne prolongé|jeûne total|restriction sévère|sans manger pendant.*jours|compléments non réglementés|substances interdites/i;
  return { valid: !banned.test(text), flaggedDanger: banned.test(text) };
}

/** Compatibilité : texte brut via Gemini (palier "light"). */
export async function callGeminiText(prompt) {
  return callAI({ provider: 'gemini', tier: 'light', prompt, json: false });
}

/**
 * DOUBLE CHECK : génère un conseil nutrition puis le fait re-vérifier/corriger par l'IA
 * si le contrôle scientifique automatisé (garde-fous) échoue, avant de l'afficher.
 * `provider` sélectionne Gemini ou Groq (voir lib/coGeneration.js:coGenerateNutritionAdvice/
 * coAnswerNutritionQuestion, qui appellent cette chaîne deux fois — une par IA — pour le
 * double-check inter-IA, en plus de ce garde-fou intra-IA déjà existant).
 */
async function generateVerifiedAdvice(prompt, provider = 'gemini') {
  let text = await callAIText(prompt, provider, { tier: 'light' });
  let check = validateNutritionText(text);
  if (!check.valid) {
    const fixPrompt = `${NUTRITION_GUARDRAILS}
Ta réponse précédente contient une recommandation dangereuse détectée automatiquement :
"""${text}"""
Corrige et régénère une réponse complète, sûre et conforme, tout aussi concise.`;
    text = await callAIText(fixPrompt, provider, { tier: 'light' });
    check = validateNutritionText(text);
  }
  return { text, verified: check.valid };
}

function buildRaceTargetsBlock(raceProfile, heat = 'mild') {
  const carb = getCarbRange(raceProfile.tier);
  const fluid = getFluidRange(heat);
  const sodium = getSodiumRange(raceProfile.tier, heat);
  const potassium = getPotassiumRange(raceProfile.tier);
  return `Palier d'effort : ${TIER_LABELS[raceProfile.tier]} (${raceProfile.label}, ~${Math.round(raceProfile.durationMin)}min${raceProfile.distanceKm ? `, ~${raceProfile.distanceKm}km` : ''}).
Cibles chiffrées pré-calculées pour CE format (utilise ces valeurs, n'en invente pas d'autres) :
- Glucides : ${carb.min}-${carb.max}g/h ${carb.note ? `(${carb.note})` : ''}
- Liquide : ${fluid.min}-${fluid.max}ml/h
- Sodium : ${sodium.min}-${sodium.max}mg/h
- Potassium : ${potassium.min}-${potassium.max}mg/h`;
}

/**
 * Génère les DEUX blocs courts affichés dans l'onglet Nutrition : conseil "à l'entraînement"
 * (générique, vie quotidienne + séances) et conseil "le jour de la course" (dont le niveau de
 * détail est directement proportionnel au palier d'effort — un 5km n'a pas besoin des mêmes
 * précisions qu'un Ironman ou un ultra-trail).
 */
export async function generateNutritionAdvice({ profile, trainingPlan, sportType, raceProfile, language = 'fr', provider = 'gemini' }) {
  const targetsBlock = buildRaceTargetsBlock(raceProfile);
  const langNote = language !== 'fr' ? `Rédige ta réponse entièrement en ${AI_LANGUAGE_NAMES[language] || 'français'}.\n` : '';

  const trainingPrompt = `${NUTRITION_GUARDRAILS}
${langNote}Profil athlète : poids ${profile?.weight || '?'}kg, discipline : ${sportType === 'duathlon' ? 'duathlon' : sportType === 'triathlon' ? 'triathlon' : 'course à pied'}.
Rédige un conseil COURT (4-5 lignes MAXIMUM) sur l'alimentation/hydratation à adopter au quotidien et
pendant les séances d'entraînement (pas la course elle-même). Reste générique et actionnable.`;

  const raceLengthGuidance = raceProfile.tier === 'flash'
    ? 'Réponse TRÈS courte (2-3 lignes) : ce format ne nécessite quasi aucune stratégie nutritionnelle.'
    : raceProfile.tier === 'court'
      ? 'Réponse courte (3-4 lignes) : stratégie simple, pas de plan complexe.'
      : raceProfile.tier === 'moyen'
        ? 'Réponse de longueur moyenne (4-6 lignes) : donne les cibles glucides/liquide et 1-2 exemples concrets.'
        : raceProfile.tier === 'long'
          ? 'Réponse détaillée (6-8 lignes) : cibles chiffrées, exemples de produits, stratégie de répartition sur la course.'
          : 'Réponse détaillée (8-10 lignes) : cibles chiffrées, mix glucose/fructose, alternance solide/liquide/salé, gestion de la lassitude gustative, sodium renforcé.';

  const racePrompt = `${NUTRITION_GUARDRAILS}
${langNote}Profil athlète : poids ${profile?.weight || '?'}kg.
${targetsBlock}
Rédige le conseil nutrition à appliquer LE JOUR DE LA COURSE (pas l'entraînement). ${raceLengthGuidance}
Utilise les cibles chiffrées ci-dessus dans ta réponse (glucides/h notamment). Cite 1-3 exemples de
produits concrets (gel, boisson, aliment solide) adaptés à ce format.`;

  const [training, race] = await Promise.all([
    generateVerifiedAdvice(trainingPrompt, provider),
    generateVerifiedAdvice(racePrompt, provider),
  ]);

  return {
    trainingAdvice: training.text,
    raceAdvice: race.text,
    verified: training.verified && race.verified,
  };
}

export async function answerNutritionQuestion({ profile, trainingPlan, question, raceProfile, planSummary, language = 'fr', provider = 'gemini' }) {
  const targetsBlock = raceProfile ? buildRaceTargetsBlock(raceProfile) : '';
  const langNote = language !== 'fr' ? `Rédige ta réponse entièrement en ${AI_LANGUAGE_NAMES[language] || 'français'}.\n` : '';
  const prompt = `${NUTRITION_GUARDRAILS}
${langNote}Profil athlète : poids ${profile?.weight || '?'}kg, objectif : ${trainingPlan?.title || '-'}.
${targetsBlock}
${planSummary ? `${planSummary}\n` : ''}Question de l'athlète : "${question}"
Réponds de façon personnalisée, concrète et rassurante (réponse courte, 3-6 lignes sauf si la question
exige clairement plus de détail). Si la question évoque un trouble digestif, une intolérance, ou une
difficulté à consommer un type de produit (ex: gels), propose des alternatives pratiques concrètes
(texture, timing, type de glucide, aliment de substitution) et suggère un avis diététicien/médecin
uniquement si le problème semble persistant ou sérieux.`;
  const { text, verified } = await generateVerifiedAdvice(prompt, provider);
  return { answer: text, verified };
}

// --- ANALYSE D'ACTIVITÉ STRAVA (prévu vs réalisé) -----------------------------
// Appelée automatiquement dès qu'une activité Strava est reçue par le webhook
// (voir pages/api/strava/webhook.js), désormais via coAnalyzeStravaActivity dans
// lib/coGeneration.js pour le double-check Gemini + Groq (demande explicite de
// l'athlète : "mêmes règles que pour la génération des séances"). `plannedWorkout`
// est null si aucune séance du plan n'a pu être associée automatiquement (voir
// lib/stravaMatch.js) : dans ce cas l'IA commente uniquement la séance réalisée,
// sans comparaison.
//
// Réponse JSON stricte (et non plus texte libre) : le champ "verdict" est l'ancre
// déterministe comparée entre les deux IA par coAnalyzeStravaActivity — l'équivalent,
// pour une analyse d'activité, du "type de jour" comparé entre deux séances générées
// (voir compareDay dans lib/coGeneration.js).
function describePlannedLine(w) {
  if (!w) return '';
  return `${w.day || ''} — ${w.type} « ${w.title} » ${w.duration || ''}${w.intensity ? ` · cible ${w.intensity}` : ''}${w.effortZone ? ` (${w.effortZone})` : ''}`.trim();
}

/**
 * RETOUR DE SÉANCE (activité Strava).
 * REFONTE (retour de l'athlète) : le retour comparait une sortie vélo du lundi, sans vélo au
 * programme, au sweet spot du mercredi de la semaine précédente (« 330 W demandés ») et
 * prenait un ton d'animateur (« Salut champion »). Désormais :
 *   - les FAITS (durée, % FTP, zones) sont calculés par l'app (lib/activityFacts.js) ;
 *   - la comparaison ne se fait qu'avec une séance prévue LE MÊME JOUR ; sinon « hors plan »,
 *     avec ce qui était prévu ce jour-là et, au conditionnel, une éventuelle séance déplacée ;
 *   - format court et factuel en 3 lignes : Réalisé / Par rapport au plan / Pour la suite.
 */
export async function analyzeStravaActivity({ activity, plannedWorkout, movedCandidate = null, sameDayPlanned = [], zones = {}, profile, language = 'fr', provider = 'gemini', laps = null, deadline = null }) {
  const langNote = language !== 'fr' ? `Rédige le champ "analysis" entièrement en ${AI_LANGUAGE_NAMES[language] || 'français'} (libellés de ligne compris).\n` : '';
  const facts = describeActivityFacts(activity, profile || {}, zones || {});
  const lapsText = describeLaps(laps, activity.sport_type || activity.type);

  const planBlock = plannedWorkout
    ? `SÉANCE PRÉVUE CE JOUR (référence de comparaison) :\n- ${describePlannedLine(plannedWorkout)}\n- Structure : ${plannedWorkout.structure || '-'}`
    : `AUCUNE séance de cette discipline n'était prévue ce jour-là : c'est une séance HORS PLAN. Ne la compare à AUCUN objectif d'intensité et ne reproche rien.
${sameDayPlanned.length ? `Prévu ce jour-là (autres disciplines) : ${sameDayPlanned.map((w) => `${w.type} « ${w.title} » ${w.duration || ''}`).join(' ; ')}.` : 'Rien d\'autre n\'était prévu ce jour-là.'}
${movedCandidate ? `Piste possible : il s'agit peut-être de la séance « ${movedCandidate.title} » prévue ${movedCandidate.day} (${movedCandidate.duration || ''}, cible ${movedCandidate.intensity || '-'}) faite un autre jour. Mentionne-le UNIQUEMENT au conditionnel, sans en faire un reproche.` : ''}`;

  const prompt = `Tu es TRI COACH. Tu fais le retour d'une séance réalisée par un triathlète.
${langNote}
FAITS (calculés par l'app, à utiliser tels quels ; n'invente AUCUNE autre valeur) :
${facts.map((f) => `- ${f}`).join('\n')}
${lapsText ? `Détail par tour (pré-analysé) :\n${lapsText}\n` : ''}
${planBlock}

FORMAT OBLIGATOIRE du champ "analysis" : exactement 3 lignes, séparées par un retour à la ligne, chacune commençant par son libellé :
Réalisé : ce qui a été fait, avec 2 ou 3 chiffres clés et la zone d'intensité indiquée dans les faits (si des répétitions ressortent du détail par tour, dis combien et à quelle intensité).
Par rapport au plan : ${plannedWorkout ? 'écart chiffré avec la séance prévue (durée, intensité, structure) et verdict en quelques mots' : '« Séance hors plan » puis ce que cela ajoute à la semaine (volume, intensité), et ce qui était prévu ce jour-là s\'il y avait quelque chose'}.
Pour la suite : UNE seule consigne concrète (récupération, adaptation des prochains jours, ou « rien à changer »).

STYLE : factuel et direct, tutoiement. AUCUNE formule d'accroche ni d'encouragement (« Salut », « champion », « bravo », « super »), pas de point d'exclamation, pas de markdown. 70 mots maximum au total.

Réponds STRICTEMENT en JSON : {"verdict": ${plannedWorkout ? '"on_track" (conforme) | "below_target" (nettement en dessous : trop court ou trop facile) | "above_target" (nettement au-dessus)' : '"no_comparison"'}, "analysis": "les 3 lignes"}`;

  const json = await callAIJSON(prompt, provider, { tier: 'chat', schema: ACTIVITY_ANALYSIS_SCHEMA, deadline });
  const text = typeof json?.analysis === 'string' ? json.analysis.trim() : '';
  if (!text) {
    const err = new Error('Réponse IA vide ou invalide pour l\'analyse d\'activité.');
    err.code = 'PARSE_ERROR';
    throw err;
  }
  const validVerdicts = ['on_track', 'below_target', 'above_target', 'no_comparison'];
  // Hors plan : jamais de verdict de comparaison, quoi que réponde le modèle.
  const verdict = !plannedWorkout ? 'no_comparison' : (validVerdicts.includes(json?.verdict) ? json.verdict : 'on_track');

  return { analysis: text, verdict, status: 'ok' };
}

// --- VÉRIFICATION IA DE PLAUSIBILITÉ DES ZONES (double-check Gemini + Groq) ------
// Demande explicite de l'athlète : avant d'enregistrer des bornes de zone éditées à la
// main (basse ET haute désormais indépendantes, voir components/ZoneCharts.js), les
// deux IA du protocole de co-génération (voir coCheckZoneBounds dans lib/coGeneration.js)
// doivent aussi se prononcer sur leur plausibilité PHYSIOLOGIQUE — l'absence de
// chevauchement est déjà garantie de façon déterministe côté client (voir
// findZoneOverlaps, lib/zones.js) AVANT même d'arriver ici ; ce contrôle-ci porte sur
// autre chose : une Z2 "Aérobie" à 250-400 bpm est structurellement valide (zones
// croissantes, pas de chevauchement) mais absurde pour un humain. Réponse JSON stricte,
// jamais de prose libre, pour rester 100% automatisable.
export async function checkZoneBoundsWithAI({ zones, metric, discipline, profile, language = 'fr', provider = 'gemini' }) {
  const langNote = language !== 'fr' ? `Réponds dans le champ "note" en ${AI_LANGUAGE_NAMES[language] || 'français'}.\n` : '';
  const unit = metric === 'hr' ? 'bpm' : metric === 'power' ? 'W' : 'km/h';
  const zonesDesc = (zones || [])
    .map((z) => `${z.zone} (${z.label}) : ${z.min}${Number.isFinite(z.max) ? `–${z.max}` : ' et plus'} ${unit}`)
    .join('\n');
  const profileNote = metric === 'hr'
    ? `FC max déclarée : ${profile?.fcMax || 'non renseignée'} bpm.`
    : metric === 'power'
      ? `FTP déclarée : ${profile?.ftp || 'non renseignée'} W.`
      : `VMA déclarée : ${profile?.vma || 'non renseignée'} km/h.`;
  const prompt = `${langNote}Tu es un coach sportif. Un(e) athlète (discipline : ${discipline === 'bike' ? 'vélo' : 'course à pied'}) vient d'éditer manuellement ses zones d'intensité "${
    metric === 'hr' ? 'fréquence cardiaque' : metric === 'power' ? 'puissance' : 'allure/vitesse'
  }".
${profileNote}
Zones proposées (déjà vérifiées automatiquement : ordre croissant, aucun chevauchement) :
${zonesDesc}

Ces bornes sont-elles PHYSIOLOGIQUEMENT plausibles pour un être humain pratiquant ce sport (débutant comme très entraîné) ? Ne rejette QUE si une borne est manifestement aberrante (ex: FC de zone au-delà de ~230 bpm, valeur négative ou nulle, allure irréaliste type >30 km/h en continu, puissance délirante). Reste permissif sur tout ce qui reste dans le domaine du possible humain, y compris un profil atypique.
Réponds STRICTEMENT en JSON, sans aucun texte autour : {"plausible": true|false, "note": "une phrase courte expliquant ton avis"}`;

  const json = await callAIJSON(prompt, provider, { tier: 'light', schema: ZONE_CHECK_SCHEMA });
  return {
    plausible: json?.plausible !== false,
    note: typeof json?.note === 'string' ? json.note : '',
  };
}

// --- PLANIFICATEUR DE PARCOURS VÉLO (double-check Gemini + Groq) -----------------
// Demande explicite de l'athlète : tracer un parcours vélo depuis un point de départ et
// une distance, en optimisant le vent (dos/face) et en tenant compte des routes
// populaires (Strava + réseau cyclable OSM, voir lib/routePlanning.js). Le CALCUL
// (candidats, score vent, score popularité) est 100% déterministe — voir
// pages/api/plan-route.js — l'IA n'intervient qu'à la toute fin, sur un rôle qu'un calcul
// pur ne peut pas remplir : choisir/valider parmi un TRÈS PETIT nombre de candidats déjà
// classés (jamais generer elle-même une géométrie de route, ce que les LLM font mal) et
// rédiger une note de stratégie course lisible pour l'athlète (ex: "vent de face à
// l'aller, tu rentreras plus vite" — la même valeur ajoutée qu'un coach humain relisant un
// tableau de chiffres). Réponse JSON stricte, comme checkZoneBoundsWithAI ci-dessus.
export async function pickBestRouteWithAI({ candidates, startPlaceName, distanceKm, language = 'fr', provider = 'gemini' }) {
  const langNote = language !== 'fr' ? `Réponds dans les champs "strategyNote" en ${AI_LANGUAGE_NAMES[language] || 'français'}.\n` : '';
  const candidatesDesc = candidates
    .map((c, i) => `Candidat ${i} : ${c.distanceKm.toFixed(1)}km, dénivelé +${c.ascentM ?? '?'}m — vent : ${c.wind.distTailKm}km de dos, ${c.wind.distHeadKm}km de face, ${c.wind.distCrossKm}km de travers (score net vent : ${c.wind.netScore >= 0 ? '+' : ''}${c.wind.netScore}km) — popularité (segments Strava + réseau cyclable) : ${Math.round(c.popularityScore * 100)}% du tracé — score composite : ${c.compositeScore}`)
    .join('\n');

  const prompt = `${langNote}Tu es un coach cycliste. Un(e) athlète veut une sortie vélo d'environ ${distanceKm}km au départ de ${startPlaceName || 'son point de départ'}. Voici ${candidates.length} boucles candidates déjà générées et déjà notées de façon déterministe (distance, vent, popularité) — CE CLASSEMENT N'EST PAS À REMETTRE EN CAUSE dans son principe, ta tâche est de VALIDER le meilleur candidat (ou signaler un cas limite) et de rédiger une note de stratégie course courte et concrète pour CE candidat :
${candidatesDesc}

Le "score composite" ci-dessus classe déjà les candidats du meilleur au pire (vent 60%, popularité 40%, pondération déjà appliquée) — le candidat 0 est donc déjà le mieux classé. Ne choisis un AUTRE candidat que si le candidat 0 présente un défaut manifeste que le score ne capture pas bien (ex: dénivelé disproportionné par rapport aux autres, quasiment 0% de couverture routes populaires alors qu'un autre candidat très proche en score vent en a beaucoup plus).

Réponds STRICTEMENT en JSON, sans aucun texte autour :
{"pickedIndex": 0, "strategyNote": "1-2 phrases concrètes sur la stratégie de vent pour CE parcours (ex: quelle portion est difficile/facile, comment gérer l'effort en conséquence)"}`;

  const json = await callAIJSON(prompt, provider, { tier: 'light', schema: ROUTE_PICK_SCHEMA });
  const pickedIndex = Number.isInteger(json?.pickedIndex) && candidates[json.pickedIndex] ? json.pickedIndex : 0;
  return {
    pickedIndex,
    strategyNote: typeof json?.strategyNote === 'string' ? json.strategyNote : '',
  };
}
