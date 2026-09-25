// CO-GÉNÉRATION Gemini + Groq (double-check gratuit) — demande explicite de l'athlète :
// chaque plan/semaine/ajustement de chat est généré par 2 IA indépendantes à partir du même
// prompt et de la même chaîne de garde-fous, comparé de façon 100 % déterministe (aucun 3e
// appel IA pour arbitrer), avec convergence garantie en 2 rounds maximum.
//
// Règles de convergence (décidées avec l'athlète) — inchangées sauf mention :
//   1. Même prompt + mêmes garde-fous pour les deux IA.
//   2. Comparaison déterministe : pour chaque jour, mêmes disciplines ; même discipline →
//      durée à ±25 %, volume natation ("Total") à ±30 %.
//      CORRECTIF : la comparaison se faisait par POSITION dans le tableau (index i) : dès
//      qu'un jour double décalait les index, tout paraissait en désaccord → round 2 inutile.
//      Elle se fait maintenant par JOUR puis par DISCIPLINE.
//   3. Accord → version Gemini.
//   4. Désaccord → un 2e round complet (sauf si le budget temps restant ne le permet plus :
//      on passe alors directement à l'étape 5 plutôt que de faire échouer la requête).
//   5. Désaccord persistant → compromis déterministe. DEUX modes (variable d'environnement
//      CO_GEN_COMPROMISE) :
//      - "best" (défaut) : on garde le plan ENTIER de l'IA dont le score de validation
//        (lib/planValidation.js) est le meilleur ; égalité → Gemini. Un plan reste ainsi
//        cohérent d'un bout à l'autre.
//      - "average" (règle d'origine) : moyenne des durées / volumes jour par jour. ATTENTION :
//        la moyenne crée une durée ou un "Total" qu'aucune des deux IA n'a écrit, sans
//        réécrire la feuille de séance correspondante → séances incohérentes. Conservé
//        uniquement pour pouvoir revenir à la règle initiale.
//      CORRECTIF (mode average) : quand Groq avait plus d'entrées que Gemini, les séances
//      "en trop" de Groq étaient ajoutées (→ nombre de séances faux). Plus maintenant.
//   6. Une seule IA disponible → elle prend le relais seule, avec une note transparente.

import { generatePlanWithAI, regenerateWeekWithAI, chatWithCoach, generateNutritionAdvice, answerNutritionQuestion, checkZoneBoundsWithAI, pickBestRouteWithAI, analyzeStravaActivity, scorePatchedPlan } from './gemini';
import { parseDurationMinutes, classifyDiscipline } from './workouts';
import { createDeadline } from './aiConfig';
import { DAYS_OF_WEEK } from './defaults';

const DURATION_TOLERANCE = 0.25;
const SWIM_VOLUME_TOLERANCE = 0.30;
const ROUND2_MIN_BUDGET_MS = 140_000;

export function getCompromiseMode() {
  return String(process.env.CO_GEN_COMPROMISE || 'best').toLowerCase() === 'average' ? 'average' : 'best';
}

function extractSwimTotalMeters(desc) {
  const match = String(desc || '').match(/Total\s*:\s*~?\s*(\d+)\s*m/i);
  return match ? Number(match[1]) : null;
}

function withinTolerance(a, b, tolerance) {
  if (a === b) return true;
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0 || b === 0) return a === b;
  return Math.abs(a - b) / Math.max(a, b) <= tolerance;
}

function sessionsByDay(week) {
  const map = {};
  (week || []).forEach((w) => {
    if (!w || w.type === 'REPOS') return;
    (map[w.day] = map[w.day] || []).push(w);
  });
  Object.values(map).forEach((list) => list.sort((a, b) => String(classifyDiscipline(a.type)).localeCompare(String(classifyDiscipline(b.type)))));
  return map;
}

/** Compare deux séances de même discipline. */
export function compareSession(a, b) {
  if (!a || !b) return { agree: false, reason: 'séance absente chez une des deux IA' };
  if (classifyDiscipline(a.type) !== classifyDiscipline(b.type)) {
    return { agree: false, reason: `discipline différente (${a.type} vs ${b.type})` };
  }
  const durA = parseDurationMinutes(a.duration);
  const durB = parseDurationMinutes(b.duration);
  if (!withinTolerance(durA, durB, DURATION_TOLERANCE)) return { agree: false, reason: `durée trop différente (${durA} vs ${durB} min)` };
  const swimA = extractSwimTotalMeters(a.desc);
  const swimB = extractSwimTotalMeters(b.desc);
  if (swimA !== null && swimB !== null && !withinTolerance(swimA, swimB, SWIM_VOLUME_TOLERANCE)) {
    return { agree: false, reason: `volume natation trop différent (${swimA} vs ${swimB} m)` };
  }
  return { agree: true };
}

/** Compare deux semaines jour par jour (et discipline par discipline dans un jour). */
export function compareWeek(weekA, weekB) {
  const a = sessionsByDay(weekA);
  const b = sessionsByDay(weekB);
  const disagreements = [];
  DAYS_OF_WEEK.forEach((day) => {
    const la = a[day] || [];
    const lb = b[day] || [];
    const discA = la.map((w) => classifyDiscipline(w.type)).join('+') || 'REPOS';
    const discB = lb.map((w) => classifyDiscipline(w.type)).join('+') || 'REPOS';
    if (discA !== discB) {
      disagreements.push({ day, reason: `contenu du jour différent (${discA} vs ${discB})` });
      return;
    }
    for (let i = 0; i < la.length; i += 1) {
      const r = compareSession(la[i], lb[i]);
      if (!r.agree) { disagreements.push({ day, reason: r.reason }); return; }
    }
  });
  return disagreements;
}

/** Mode "average" : moyenne durée/volume jour par jour, structure Gemini conservée. */
function averageWeek(weekGemini, weekGroq) {
  const groqByDay = sessionsByDay(weekGroq);
  return (weekGemini || []).map((g) => {
    if (!g || g.type === 'REPOS') return g;
    const counterpart = (groqByDay[g.day] || []).find((x) => classifyDiscipline(x.type) === classifyDiscipline(g.type));
    if (!counterpart) return g;
    const avgDur = Math.round((parseDurationMinutes(g.duration) + parseDurationMinutes(counterpart.duration)) / 2);
    const out = { ...g, duration: `${avgDur} min` };
    const swimA = extractSwimTotalMeters(g.desc);
    const swimB = extractSwimTotalMeters(counterpart.desc);
    if (swimA !== null && swimB !== null) out.desc = String(g.desc || '').replace(/Total\s*:\s*~?\s*\d+\s*m/i, `Total : ${Math.round((swimA + swimB) / 2)}m`);
    return out;
  });
}

function pickBest(geminiResult, groqResult) {
  const sg = geminiResult?.validation?.score ?? 0;
  const sq = groqResult?.validation?.score ?? 0;
  return sq < sg ? { picked: groqResult, winner: 'groq', sg, sq } : { picked: geminiResult, winner: 'gemini', sg, sq };
}

async function runBothProviders(genFn, args) {
  const [geminiResult, groqResult] = await Promise.allSettled([
    genFn({ ...args, provider: 'gemini' }),
    genFn({ ...args, provider: 'groq' }),
  ]);
  const geminiOk = geminiResult.status === 'fulfilled';
  const groqOk = groqResult.status === 'fulfilled';
  if (!geminiOk && !groqOk) throw geminiResult.reason;
  if (!geminiOk) return { solo: 'groq', result: groqResult.value, failedProvider: 'gemini', failureReason: geminiResult.reason?.message };
  if (!groqOk) return { solo: 'gemini', result: geminiResult.value, failedProvider: 'groq', failureReason: groqResult.reason?.message };
  return { solo: null, gemini: geminiResult.value, groq: groqResult.value };
}

function soloNote(failedProvider, failureReason, subject = 'contenu généré') {
  const label = failedProvider === 'gemini' ? 'Gemini' : 'Groq';
  return `Double-check indisponible cette fois (${label} injoignable : ${failureReason || 'erreur inconnue'}) — ${subject} par une seule IA, à vérifier avec un peu plus d'attention.`;
}

function withNote(result, key, note) {
  return { ...result, [key]: [...(result[key] || []), note] };
}

/**
 * Co-génère un plan complet (N et N+1). Signature et forme de retour identiques à
 * generatePlanWithAI (+ autoFixNotes enrichi du statut du double-check).
 */
export async function coGeneratePlan(args) {
  const deadline = args.deadline || createDeadline();
  const run = () => runBothProviders(generatePlanWithAI, { ...args, deadline });
  const round1 = await run();
  if (round1.solo) return withNote(round1.result, 'autoFixNotes', soloNote(round1.failedProvider, round1.failureReason, 'plan généré'));

  const diff1 = [...compareWeek(round1.gemini.workouts.N, round1.groq.workouts.N), ...compareWeek(round1.gemini.workouts['N+1'], round1.groq.workouts['N+1'])];
  if (diff1.length === 0) return withNote(round1.gemini, 'autoFixNotes', 'Double-check Gemini + Groq : accord dès le 1er essai.');

  let final = round1;
  let rounds = 1;
  if (deadline.remainingMs() >= ROUND2_MIN_BUDGET_MS) {
    const round2 = await run();
    rounds = 2;
    if (round2.solo) return withNote(round2.result, 'autoFixNotes', soloNote(round2.failedProvider, round2.failureReason, 'plan généré'));
    const diff2 = [...compareWeek(round2.gemini.workouts.N, round2.groq.workouts.N), ...compareWeek(round2.gemini.workouts['N+1'], round2.groq.workouts['N+1'])];
    if (diff2.length === 0) return withNote(round2.gemini, 'autoFixNotes', 'Double-check Gemini + Groq : accord trouvé au 2e essai.');
    final = round2;
  }

  if (getCompromiseMode() === 'average') {
    return withNote({
      ...final.gemini,
      workouts: { N: averageWeek(final.gemini.workouts.N, final.groq.workouts.N), 'N+1': averageWeek(final.gemini.workouts['N+1'], final.groq.workouts['N+1']) },
    }, 'autoFixNotes', `Double-check Gemini + Groq : désaccord après ${rounds} essai(s) → compromis par moyenne des durées/volumes.`);
  }
  const { picked, winner, sg, sq } = pickBest(final.gemini, final.groq);
  return withNote(picked, 'autoFixNotes', `Double-check Gemini + Groq : désaccord après ${rounds} essai(s) → plan ${winner === 'gemini' ? 'Gemini' : 'Groq'} retenu (meilleur score de validation : ${Math.min(sg, sq)} contre ${Math.max(sg, sq)}).`);
}

/** Même logique pour la régénération d'une seule semaine. */
export async function coRegenerateWeek(args) {
  const { weekKey = 'N+1' } = args;
  const deadline = args.deadline || createDeadline();
  const run = () => runBothProviders(regenerateWeekWithAI, { ...args, deadline });
  const round1 = await run();
  if (round1.solo) return withNote(round1.result, 'qualityWarnings', soloNote(round1.failedProvider, round1.failureReason, 'semaine générée'));
  if (compareWeek(round1.gemini.workouts[weekKey], round1.groq.workouts[weekKey]).length === 0) return round1.gemini;

  let final = round1;
  let rounds = 1;
  if (deadline.remainingMs() >= ROUND2_MIN_BUDGET_MS) {
    const round2 = await run();
    rounds = 2;
    if (round2.solo) return withNote(round2.result, 'qualityWarnings', soloNote(round2.failedProvider, round2.failureReason, 'semaine générée'));
    if (compareWeek(round2.gemini.workouts[weekKey], round2.groq.workouts[weekKey]).length === 0) return round2.gemini;
    final = round2;
  }
  if (getCompromiseMode() === 'average') {
    return { ...final.gemini, workouts: { ...final.gemini.workouts, [weekKey]: averageWeek(final.gemini.workouts[weekKey], final.groq.workouts[weekKey]) } };
  }
  const { picked, winner } = pickBest(final.gemini, final.groq);
  console.info(`[coRegenerateWeek] désaccord après ${rounds} essai(s) → version ${winner} retenue.`);
  return picked;
}

// --- Chat ------------------------------------------------------------------------------

function patchKey(p) {
  return `${p.week || 'N'}|${p.patchMode || 'modify'}|${p.day || ''}|${classifyDiscipline(p.type) || ''}`;
}

export function comparePatches(patchesA, patchesB) {
  const a = [...(patchesA || [])].sort((x, y) => patchKey(x).localeCompare(patchKey(y)));
  const b = [...(patchesB || [])].sort((x, y) => patchKey(x).localeCompare(patchKey(y)));
  if (a.length !== b.length) return { agree: false, reason: `nombre de modifications différent (${a.length} vs ${b.length})` };
  for (let i = 0; i < a.length; i += 1) {
    if (patchKey(a[i]) !== patchKey(b[i])) return { agree: false, reason: 'séances visées différentes' };
    if (a[i].patchMode !== 'remove') {
      const r = compareSession(a[i], b[i]);
      if (!r.agree) return r;
    }
  }
  return { agree: true };
}

/**
 * Chat : même protocole. En cas de désaccord persistant, mode "best" : on garde la réponse
 * (texte + modifications) de l'IA dont les modifications donnent le plan le mieux validé —
 * le texte décrit donc toujours exactement ce qui a été modifié.
 */
export async function coChatWithCoach(args) {
  const deadline = args.deadline || createDeadline(150_000);
  const run = () => runBothProviders(chatWithCoach, { ...args, deadline });
  const round1 = await run();
  if (round1.solo) {
    console.warn('[coChatWithCoach]', soloNote(round1.failedProvider, round1.failureReason, 'réponse générée'));
    return round1.result;
  }
  if (comparePatches(round1.gemini.patches, round1.groq.patches).agree) return round1.gemini;

  let final = round1;
  if (deadline.remainingMs() >= 60_000) {
    const round2 = await run();
    if (round2.solo) return round2.result;
    if (comparePatches(round2.gemini.patches, round2.groq.patches).agree) return round2.gemini;
    final = round2;
  }
  if (getCompromiseMode() === 'average') {
    const groqByKey = new Map((final.groq.patches || []).map((p) => [patchKey(p), p]));
    return {
      ...final.gemini,
      patches: (final.gemini.patches || []).map((p) => {
        const q = groqByKey.get(patchKey(p));
        if (!q || p.patchMode === 'remove') return p;
        return { ...p, duration: `${Math.round((parseDurationMinutes(p.duration) + parseDurationMinutes(q.duration)) / 2)} min` };
      }),
    };
  }
  const score = (r) => scorePatchedPlan({ workouts: args.workouts, patches: r.patches, constraints: args.constraints, sportType: args.sportType, profile: args.profile, manualPaceZones: args.manualPaceZones });
  const sg = score(final.gemini);
  const sq = score(final.groq);
  return sq < sg ? final.groq : final.gemini;
}

// Choix déterministe entre deux réponses texte (nutrition) — pas de "compromis" possible
// sur de la prose (contrairement à une durée ou un volume numérique), donc la règle de
// convergence ici est : la réponse qui a passé le garde-fou scientifique automatisé
// (validateNutritionText, voir lib/gemini.js) l'emporte ; à garde-fou égal, Gemini est
// gardée par défaut (même tie-break arbitraire mais fixe que pour les séances).
function pickVerifiedResult(geminiRes, groqRes) {
  if (geminiRes.verified && groqRes.verified) return { picked: geminiRes, status: 'both-verified' };
  if (geminiRes.verified) return { picked: geminiRes, status: 'gemini-only-verified' };
  if (groqRes.verified) return { picked: groqRes, status: 'groq-only-verified' };
  return { picked: geminiRes, status: 'neither-verified' };
}

function doubleCheckNoteFor(status) {
  switch (status) {
    case 'both-verified':
      return 'Double-check Gemini + Groq : conseil validé par les deux IA.';
    case 'gemini-only-verified':
      return "Double-check Gemini + Groq : réponse Groq écartée (garde-fou nutrition non validé), réponse Gemini retenue.";
    case 'groq-only-verified':
      return "Double-check Gemini + Groq : réponse Gemini écartée (garde-fou nutrition non validé), réponse Groq retenue.";
    default:
      return "Double-check Gemini + Groq : aucune des deux IA n'a pleinement validé ce conseil automatiquement — vérifie-le avec un peu plus d'attention.";
  }
}

/**
 * Co-génère les conseils nutrition (entraînement + course, voir generateNutritionAdvice
 * dans lib/gemini.js) avec Gemini + Groq — demande explicite de l'athlète : l'onglet
 * Nutrition doit suivre le même protocole double-IA que la génération de plan, pas
 * seulement interroger Gemini. Pas de relance/compromis numérique ici (voir
 * pickVerifiedResult ci-dessus) : la prose ne se "moyenne" pas comme une durée.
 */
export async function coGenerateNutritionAdvice(args) {
  const round = await runBothProviders(generateNutritionAdvice, args);
  if (round.solo) {
    const note = soloNote(round.failedProvider, round.failureReason, 'conseil nutrition généré');
    return { ...round.result, doubleCheckNote: note };
  }
  const { picked, status } = pickVerifiedResult(round.gemini, round.groq);
  return { ...picked, doubleCheckNote: doubleCheckNoteFor(status) };
}

/**
 * Vérifie la plausibilité physiologique de bornes de zone éditées manuellement, avec
 * les DEUX IA du protocole — demande explicite de l'athlète ("les deux IA doivent
 * s'accorder", "vérifier que c'est possible") appliquée à l'édition indépendante des
 * bornes basse/haute (voir components/ZoneCharts.js). S'ajoute, côté serveur, au
 * contrôle déterministe de non-chevauchement déjà fait AVANT cet appel (voir
 * findZoneOverlaps dans lib/zones.js, revérifié aussi dans pages/api/validate-zones.js).
 * Règle de convergence (volontairement prudente — pas de "compromis" possible sur un
 * jugement booléen comme pour une durée/un volume) : si UNE SEULE des deux IA juge les
 * bornes aberrantes, elles sont traitées comme aberrantes dans l'ensemble — mieux vaut
 * redemander confirmation à l'athlète qu'enregistrer une zone absurde qu'une IA sur deux
 * a repérée. Si une seule IA est disponible, son seul avis fait foi (note transparente)
 * plutôt qu'un blocage total tant qu'au moins une IA répond.
 */
export async function coCheckZoneBounds(args) {
  const round = await runBothProviders(checkZoneBoundsWithAI, args);

  if (round.solo) {
    const label = round.failedProvider === 'gemini' ? 'Gemini' : 'Groq';
    return {
      plausible: round.result.plausible,
      note: round.result.note,
      doubleCheckNote: `Double-check indisponible cette fois (${label} injoignable${round.failureReason ? ` : ${round.failureReason}` : ''}) — avis d'une seule IA, à vérifier avec un peu plus d'attention.`,
    };
  }

  const { gemini, groq } = round;
  const bothPlausible = gemini.plausible && groq.plausible;
  const notes = [gemini.note, groq.note].filter(Boolean);

  return {
    plausible: bothPlausible,
    note: notes.join(' '),
    doubleCheckNote: bothPlausible
      ? 'Double-check Gemini + Groq : bornes jugées plausibles par les deux IA.'
      : `Double-check Gemini + Groq : ${
          !gemini.plausible && !groq.plausible
            ? 'les deux IA jugent ces bornes peu plausibles'
            : `une des deux IA (${!gemini.plausible ? 'Gemini' : 'Groq'}) juge ces bornes peu plausibles`
        }.`,
  };
}

/**
 * Même logique que coGenerateNutritionAdvice, pour une question libre posée dans l'onglet
 * Nutrition (voir answerNutritionQuestion dans lib/gemini.js).
 */
export async function coAnswerNutritionQuestion(args) {
  const round = await runBothProviders(answerNutritionQuestion, args);
  if (round.solo) {
    const note = soloNote(round.failedProvider, round.failureReason, 'réponse générée');
    return { ...round.result, doubleCheckNote: note };
  }
  const { picked, status } = pickVerifiedResult(round.gemini, round.groq);
  return { ...picked, doubleCheckNote: doubleCheckNoteFor(status) };
}

/**
 * Choisit le meilleur parcours vélo candidat parmi ceux déjà générés et scorés de façon
 * déterministe (voir pages/api/plan-route.js + lib/routePlanning.js) — demande explicite
 * de l'athlète : générer un parcours en optimisant le vent et la popularité des routes.
 * Règle de convergence, adaptée du protocole établi pour les séances (voir en-tête de ce
 * fichier) à un choix DISCRET (index parmi N candidats) plutôt qu'un contenu à comparer
 * champ par champ :
 *   - Les deux IA reçoivent le même prompt (mêmes candidats, mêmes scores déjà calculés,
 *     voir pickBestRouteWithAI dans lib/gemini.js) — aucune ne génère de géométrie, elles
 *     ne font que VALIDER un candidat déjà classé et rédiger une stratégie course.
 *   - Accord (même pickedIndex) -> ce candidat gagne, les deux notes de stratégie sont
 *     fusionnées (les deux perspectives se complètent rarement à l'identique).
 *   - Désaccord -> PAS de round 2 ni de 3e appel d'arbitrage ici (contrairement au plan
 *     d'entraînement) : le score composite déterministe déjà calculé tranche directement
 *     (le candidat le mieux classé l'emporte) — il a déjà arbitré objectivement entre vent
 *     et popularité, un désaccord entre deux IA sur ce choix n'apporte pas d'information
 *     supplémentaire qu'un round 2 identique ferait réapparaître. Convergence immédiate,
 *     toujours en 1 aller-retour.
 *   - Une seule IA disponible -> son choix fait foi, note transparente (même principe que
 *     coCheckZoneBounds).
 */
export async function coPickRoute(args) {
  const round = await runBothProviders(pickBestRouteWithAI, args);

  if (round.solo) {
    const label = round.failedProvider === 'gemini' ? 'Gemini' : 'Groq';
    return {
      pickedIndex: round.result.pickedIndex,
      strategyNote: round.result.strategyNote,
      doubleCheckNote: `Double-check indisponible cette fois (${label} injoignable${round.failureReason ? ` : ${round.failureReason}` : ''}) — choix d'une seule IA, à vérifier avec un peu plus d'attention.`,
    };
  }

  const { gemini, groq } = round;
  if (gemini.pickedIndex === groq.pickedIndex) {
    const notes = [gemini.strategyNote, groq.strategyNote].filter(Boolean);
    return {
      pickedIndex: gemini.pickedIndex,
      strategyNote: notes.join(' '),
      doubleCheckNote: 'Double-check Gemini + Groq : les deux IA valident le même parcours.',
    };
  }

  // Désaccord : le score composite déterministe (déjà calculé AVANT cet appel, voir
  // args.candidates) tranche — jamais de 3e appel IA pour arbitrer (même philosophie que
  // le reste du protocole, voir en-tête de fichier).
  return {
    pickedIndex: 0, // args.candidates est déjà trié par compositeScore décroissant (voir lib/routePlanning.js:rankCandidates)
    strategyNote: gemini.strategyNote || groq.strategyNote || '',
    doubleCheckNote: `Double-check Gemini + Groq : désaccord entre les deux IA (candidat ${gemini.pickedIndex} vs ${groq.pickedIndex}) — le score déterministe vent+popularité a tranché en faveur du candidat le mieux classé.`,
  };
}

/**
 * Co-génère l'analyse IA d'une activité Strava (prévu vs réalisé, voir
 * analyzeStravaActivity dans lib/gemini.js) avec Gemini + Groq — demande explicite de
 * l'athlète : "les mêmes règles que pour la génération des séances" (voir coGeneratePlan
 * en tête de fichier, les 6 mêmes règles de convergence), transposées ici à une analyse
 * textuelle courte plutôt qu'à un plan structuré :
 *   1. Les deux IA reçoivent exactement le même prompt (voir provider dans
 *      analyzeStravaActivity).
 *   2. Comparaison déterministe sur le champ "verdict" (on_track / below_target /
 *      above_target / no_comparison) — l'équivalent, pour une analyse d'activité, du
 *      "type de jour" comparé entre deux séances générées (voir compareDay ci-dessus).
 *   3. Accord -> version Gemini retenue (même tie-break arbitraire mais fixe que pour un
 *      plan/une semaine).
 *   4. Désaccord -> UN round complet est relancé (les deux régénèrent entièrement).
 *   5. Désaccord encore présent après le 2e essai -> pas de "moyenne" possible sur de la
 *      prose (contrairement à une durée/un volume numérique) : la version Gemini est
 *      conservée, exactement la même règle que pour une divergence de structure non
 *      fusionnable entre deux séances (voir compromiseDay ci-dessus). Convergence
 *      garantie en 2 rounds maximum, jamais de 3e appel IA pour arbitrer.
 *   6. Une seule IA disponible -> elle prend le relais seule, avec une note transparente
 *      (loggée côté serveur uniquement, jamais affichée à l'athlète — même convention que
 *      le reste du protocole, voir doubleCheckNote ailleurs dans ce fichier).
 */
export async function coAnalyzeStravaActivity(args) {
  const round1 = await runBothProviders(analyzeStravaActivity, args);

  if (round1.solo) {
    console.warn('[coAnalyzeStravaActivity]', soloNote(round1.failedProvider, round1.failureReason, "analyse d'activité générée"));
    return round1.result;
  }

  if (round1.gemini.verdict === round1.groq.verdict) {
    return round1.gemini;
  }

  // Désaccord -> round 2 : les deux IA régénèrent ENTIÈREMENT l'analyse.
  const round2 = await runBothProviders(analyzeStravaActivity, args);

  if (round2.solo) {
    console.warn('[coAnalyzeStravaActivity]', soloNote(round2.failedProvider, round2.failureReason, "analyse d'activité générée"));
    return round2.result;
  }

  if (round2.gemini.verdict === round2.groq.verdict) {
    return round2.gemini;
  }

  // Toujours en désaccord après 2 essais complets -> version Gemini conservée (non
  // fusionnable, voir règle 5 ci-dessus) ; point de convergence garanti, jamais de 3e round.
  console.warn(
    `[coAnalyzeStravaActivity] Double-check Gemini + Groq : désaccord persistant après 2 essais complets (verdicts "${round2.gemini.verdict}" vs "${round2.groq.verdict}") -> analyse Gemini conservée.`
  );
  return round2.gemini;
}
