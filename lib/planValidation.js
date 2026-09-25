// lib/planValidation.js
//
// VALIDATION DÉTERMINISTE D'UN PLAN — sans jamais le modifier.
//
// Changement d'approche par rapport à l'ancien pipeline : avant, chaque règle était une
// fonction `enforce*` qui MODIFIAIT silencieusement la séance (titre "(allégée)", intensité
// réécrite, durée changée) sans toucher à sa description — d'où des séances incohérentes
// ("Endurance fondamentale" en intensité, "10*(45'' côte @VMA)" dans la description).
// Désormais :
//   1. ces validateurs DÉCRIVENT chaque problème, avec un message actionnable ;
//   2. la liste est renvoyée à l'IA dans une passe de relecture/réparation (lib/gemini.js),
//      qui réécrit la séance ENTIÈRE de façon cohérente ;
//   3. les corrections de l'IA ne sont acceptées que si elles ne dégradent pas le score de
//      validation (jamais de régression) ;
//   4. seuls les problèmes structurels encore présents passent par les garde-fous
//      déterministes de lib/workouts.js (filet de sécurité, désormais cohérents eux aussi).
//
// Sévérités : 'error' = contrainte dure (nombre de séances, jour de repos, format, valeur
// aberrante) ; 'warn' = qualité (volume hebdo, enchaînement de séances dures, cohérence
// natation...). Le score (erreurs ×10 + avertissements) sert à comparer deux versions.

import { DAYS_OF_WEEK } from './defaults';
import { classifyDiscipline, sessionWeight, parseDurationMinutes, isHardSession, isTripleDayEligible, sanitizeWorkout } from './workouts';

const EXPERIENCE_RANK = { debutant: 1, novice: 2, intermediaire: 3, confirme: 4, expert: 5 };

// ---------------------------------------------------------------------------------------
// Normalisation d'une semaine renvoyée par l'IA
// ---------------------------------------------------------------------------------------

const REST_DEFAULTS = {
  title: 'Repos',
  duration: '0 min',
  intensity: 'Repos',
  effortZone: 'Repos',
  cardio: '-',
  avgBpm: '-',
  rpe: 'RPE 1/10',
  cadence: '-',
  restTime: '-',
  structure: 'Repos complet : sommeil, hydratation, mobilité légère si besoin.',
  desc: 'Repos complet.',
};

function normalizeDay(day) {
  const strip = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const target = strip(day);
  if (!target) return null;
  return DAYS_OF_WEEK.find((d) => strip(d) === target)
    || DAYS_OF_WEEK.find((d) => target.startsWith(strip(d).slice(0, 3)))
    || null;
}

/**
 * Nettoie une semaine brute : champs texte en chaînes, type/jour canoniques, ids uniques,
 * jours manquants complétés par un REPOS, entrées REPOS complètes, tri chronologique.
 * `usedIds` (Set) est partagé entre les deux semaines pour garantir des ids uniques.
 */
export function normalizeAiWeek(rawWeek, weekKey, usedIds = new Set()) {
  const prefix = weekKey === 'N' ? 'n' : 'm';
  const list = (Array.isArray(rawWeek) ? rawWeek : [])
    .filter((w) => w && typeof w === 'object')
    .map((w, idx) => {
      const out = {};
      Object.entries(w).forEach(([k, v]) => {
        if (v === null || v === undefined) return;
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = v;
        else if (Array.isArray(v)) out[k] = v.map(String).join('\n');
        else if (typeof v === 'object') out[k] = Object.values(v).filter((x) => typeof x !== 'object').join(' ');
      });
      const type = classifyDiscipline(out.type) || 'REPOS';
      const day = normalizeDay(out.day);
      if (!day) return null;
      let id = String(out.id || '').trim();
      if (!id || usedIds.has(id)) id = `${prefix}${idx + 1}-${Math.random().toString(36).slice(2, 6)}`;
      usedIds.add(id);
      const base = { ...out, id, day, type, modified: false };
      delete base.week; delete base.patchMode; delete base.targetId;
      return type === 'REPOS' ? { ...REST_DEFAULTS, ...base, duration: base.duration && parseDurationMinutes(base.duration) === 0 ? base.duration : '0 min' } : base;
    })
    .filter(Boolean);

  const present = new Set(list.map((w) => w.day));
  DAYS_OF_WEEK.forEach((day, i) => {
    if (!present.has(day)) {
      let id = `${prefix}rest-${i}`;
      while (usedIds.has(id)) id = `${id}x`;
      usedIds.add(id);
      list.push({ ...REST_DEFAULTS, id, day, type: 'REPOS', modified: false });
    }
  });

  // Un jour qui contient une vraie séance n'a pas besoin d'une entrée REPOS en plus.
  const cleaned = list.filter((w) => w.type !== 'REPOS' || !list.some((o) => o.day === w.day && o.type !== 'REPOS'));
  // Un seul REPOS par jour.
  const seenRest = new Set();
  const deduped = cleaned.filter((w) => {
    if (w.type !== 'REPOS') return true;
    if (seenRest.has(w.day)) return false;
    seenRest.add(w.day);
    return true;
  });
  return deduped.sort((a, b) => DAYS_OF_WEEK.indexOf(a.day) - DAYS_OF_WEEK.indexOf(b.day));
}

// ---------------------------------------------------------------------------------------
// Natation : lecture des séries pour vérifier le "Total" annoncé
// ---------------------------------------------------------------------------------------

const SWIM_HEADERS = {
  warmup: /(échauffement|echauffement|warm[- ]?up|calentamiento)\s*:/i,
  main: /(corps de s[ée]ance|main set|parte principal|serie principal)\s*:/i,
  total: /total\s*:\s*~?\s*(\d[\d\s.,]*)\s*m\b/i,
};

export function swimHeadersPresent(desc) {
  const text = String(desc || '');
  return SWIM_HEADERS.warmup.test(text) && SWIM_HEADERS.main.test(text) && SWIM_HEADERS.total.test(text);
}

export function parseAnnouncedSwimTotal(desc) {
  const m = String(desc || '').match(SWIM_HEADERS.total);
  return m ? Number(m[1].replace(/[\s.,]/g, '')) || null : null;
}

/** Découpe sur " / " uniquement HORS parenthèses : "2*(200 PULL / 4*50 educ)" reste un bloc. */
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === '(') depth += 1;
    if (c === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && c === '/' && text[i - 1] === ' ' && text[i + 1] === ' ') {
      parts.push(current);
      current = '';
      continue;
    }
    current += c;
  }
  parts.push(current);
  return parts;
}

function segmentMeters(segment) {
  const s = segment.trim();
  if (!s) return 0;
  const nested = s.match(/^(\d{1,2})\s*[*x×]\s*\((.*)\)/);
  if (nested) {
    const inner = splitTopLevel(nested[2]).reduce((sum, part) => sum + segmentMeters(part), 0);
    return Number(nested[1]) * inner;
  }
  const reps = s.match(/^(\d{1,2})\s*[*x×]\s*(\d{2,4})\b/);
  if (reps) return Number(reps[1]) * Number(reps[2]);
  const pyramid = s.match(/^(\d{2,4}(?:\s*-\s*\d{2,4})+)\b/);
  if (pyramid) return pyramid[1].split('-').reduce((sum, n) => sum + Number(n.trim()), 0);
  const single = s.match(/^(\d{2,4})\s*(m\b|nc\b|pull|plaq|souple|educ|éduc|palmes|all\b|crawl|dos\b|brasse|4n\b|z\d|nage|progressif|tech|$)/i);
  if (single) return Number(single[1]);
  return 0;
}

/** Somme des distances lues dans la description (null si rien d'exploitable). */
export function estimateSwimMetersFromDesc(desc) {
  const lines = String(desc || '').split('\n');
  let total = 0;
  lines.forEach((rawLine) => {
    if (SWIM_HEADERS.total.test(rawLine)) return;
    const line = rawLine
      .replace(SWIM_HEADERS.warmup, '')
      .replace(SWIM_HEADERS.main, '')
      .replace(/^[-–—•*\s]+(?=\d)/, '')
      .trim();
    if (!line || line === '---') return;
    total += splitTopLevel(line).reduce((sum, seg) => sum + segmentMeters(seg), 0);
  });
  return total > 0 ? total : null;
}

function cssMinutesPer100(nat100) {
  const m = String(nat100 || '').match(/(\d+):(\d{2})/);
  return m ? Number(m[1]) + Number(m[2]) / 60 : null;
}

// ---------------------------------------------------------------------------------------
// Bornes de plausibilité des valeurs chiffrées
// ---------------------------------------------------------------------------------------

function hasValidPaceZones(zones) {
  return Array.isArray(zones) && zones.length === 5 && zones.every((z) => Number(z?.min) > 0);
}

function runSpeedBoundsKmh(profile) {
  if (hasValidPaceZones(profile?.paceZones)) {
    const speeds = profile.paceZones.map((z) => Number(z.min));
    return [Math.min(...speeds) * 0.7, Math.max(...speeds) * 1.2];
  }
  return profile?.vma ? [profile.vma * 0.5, profile.vma * 1.12] : null;
}

function parseRunPaceMin(str) {
  const m = String(str || '').match(/(\d{1,2}):(\d{2})\s*(?:min)?\s*\/\s*km/i);
  return m ? Number(m[1]) + Number(m[2]) / 60 : null;
}

function parseWatts(str) {
  const m = String(str || '').match(/(\d{2,4})\s*W\b/i);
  return m ? Number(m[1]) : null;
}

function parseSwimPaceMin(str) {
  const m = String(str || '').match(/(\d):(\d{2})\s*\/\s*100/);
  return m ? Number(m[1]) + Number(m[2]) / 60 : null;
}

const isRpe = (s) => /rpe|ressenti|feel|sensaci/i.test(String(s || ''));

// ---------------------------------------------------------------------------------------
// Contexte de validation
// ---------------------------------------------------------------------------------------

/**
 * Construit le contexte à partir des données du questionnaire + profil résolu.
 * `phaseKey` : 'base' | 'build' | 'peak' | 'taper' | 'recovery'.
 */
export function buildValidationContext({ wizardData = {}, profile = {}, manualPaceZones = null, phaseKey = 'base' }) {
  const target = Number(wizardData.maxSessionsPerWeek) || null;
  const tripleEligible = target > 12 && isTripleDayEligible(wizardData.fitnessLevel, wizardData.hoursPerWeek, wizardData.trainingExperience);
  return {
    sportType: wizardData.sportType === 'running' ? 'running' : 'triathlon',
    triathlonFormat: wizardData.triathlonFormat || 'M',
    maxSessionsPerWeek: target,
    offDays: String(wizardData.offDays || '').split(',').map((d) => normalizeDay(d)).filter(Boolean),
    hoursPerWeek: Number(wizardData.hoursPerWeek) || null,
    fitnessLevel: Number(wizardData.fitnessLevel) || 3,
    expRank: EXPERIENCE_RANK[wizardData.trainingExperience] || 3,
    tripleEligible,
    phaseKey,
    profile: { ...profile, paceZones: hasValidPaceZones(manualPaceZones) ? manualPaceZones : profile?.paceZones },
  };
}

export function dayCapFor(ctx, sessionsOfDay) {
  if (sessionsOfDay.some((w) => classifyDiscipline(w.type) === 'ENCHAÎNEMENT')) return 1;
  return ctx.tripleEligible ? 3 : 2;
}

// ---------------------------------------------------------------------------------------
// Validateurs
// ---------------------------------------------------------------------------------------

function v(severity, code, week, message, extra = {}) {
  return { severity, code, week, message, ...extra };
}

function validateSession(w, ctx, week) {
  const out = [];
  if (w.type === 'REPOS') return out;
  const disc = classifyDiscipline(w.type);
  const p = ctx.profile || {};
  const where = `${w.day} « ${w.title} » (id ${w.id})`;
  const intensity = String(w.intensity || '');

  if (disc === 'C.A.P' && !isRpe(intensity)) {
    if (/\d+(?:[.,]\d+)?\s*k\s*m\s*\/?\s*h/i.test(intensity)) {
      out.push(v('error', 'RUN_PACE_UNIT', week, `${where} : allure en km/h — attendu "m:ss /km".`, { id: w.id }));
    } else {
      const pace = parseRunPaceMin(intensity);
      const bounds = runSpeedBoundsKmh(p);
      if (pace && !bounds) out.push(v('error', 'METRIC_WITHOUT_BASE', week, `${where} : allure chiffrée alors que la VMA n'est pas renseignée — utiliser un repère RPE.`, { id: w.id }));
      if (pace && bounds) {
        const speed = 60 / pace;
        if (speed < bounds[0] || speed > bounds[1]) out.push(v('error', 'OUT_OF_RANGE', week, `${where} : allure ${intensity} hors des zones de l'athlète.`, { id: w.id }));
      }
      if (!pace && bounds) out.push(v('warn', 'RUN_PACE_FORMAT', week, `${where} : intensité "${intensity}" sans allure "m:ss /km".`, { id: w.id }));
    }
  }
  if (disc === 'CYCLISME' && !isRpe(intensity)) {
    const watts = parseWatts(intensity);
    if (watts && !p.ftp) out.push(v('error', 'METRIC_WITHOUT_BASE', week, `${where} : puissance chiffrée alors que la FTP n'est pas renseignée — utiliser un repère RPE.`, { id: w.id }));
    if (watts && p.ftp && (watts < p.ftp * 0.3 || watts > p.ftp * 1.6)) out.push(v('error', 'OUT_OF_RANGE', week, `${where} : ${watts}W incohérent avec la FTP (${p.ftp}W).`, { id: w.id }));
    if (!watts && p.ftp) out.push(v('warn', 'BIKE_WATTS_FORMAT', week, `${where} : intensité "${intensity}" sans puissance "NNNW".`, { id: w.id }));
  }
  if (disc === 'NATATION') {
    if (!swimHeadersPresent(w.desc)) {
      out.push(v('error', 'SWIM_FORMAT', week, `${where} : description natation hors format (Échauffement / Corps de séance / "Total : XXXXm").`, { id: w.id }));
    } else {
      const announced = parseAnnouncedSwimTotal(w.desc);
      const parsed = estimateSwimMetersFromDesc(w.desc);
      if (announced && parsed && Math.abs(parsed - announced) / announced > 0.15) {
        out.push(v('warn', 'SWIM_TOTAL_MISMATCH', week, `${where} : "Total : ${announced}m" mais les séries décrites font ~${parsed}m.`, { id: w.id }));
      }
      const css = cssMinutesPer100(p.nat100);
      const dur = parseDurationMinutes(w.duration);
      if (announced && css && dur) {
        const est = (announced / 100) * css * 1.25;
        if (dur < est * 0.7 || dur > est * 1.6) {
          out.push(v('warn', 'SWIM_DURATION', week, `${where} : ${announced}m en ${w.duration} est irréaliste (≈${Math.round(est)} min attendues avec une CSS de ${p.nat100}/100m).`, { id: w.id }));
        }
      }
    }
    const pace = parseSwimPaceMin(intensity);
    if (pace && !p.nat100 && !isRpe(intensity)) out.push(v('error', 'METRIC_WITHOUT_BASE', week, `${where} : allure natation chiffrée alors que la CSS n'est pas renseignée.`, { id: w.id }));
    const css = cssMinutesPer100(p.nat100);
    if (pace && css && (pace < css * 0.75 || pace > css * 1.4)) out.push(v('error', 'OUT_OF_RANGE', week, `${where} : allure ${intensity} incohérente avec la CSS (${p.nat100}/100m).`, { id: w.id }));
  }

  const text = `${w.title || ''} ${w.desc || ''}`;
  const isInterval = /\d+\s*[x×*]\s*\(?\s*\d+/.test(text) && disc !== 'NATATION';
  // La récupération peut être écrite dans la notation elle-même : "N*(effort - récup)".
  const recoveryInNotation = /\d+\s*[x×*]\s*\([^)]*\s[-–]\s[^)]+\)/.test(text);
  if (isInterval && !recoveryInNotation && (!w.restTime || w.restTime === '-')) {
    out.push(v('warn', 'INTERVAL_REST', week, `${where} : séance fractionnée sans récupération précisée (restTime).`, { id: w.id }));
  }
  if (!parseDurationMinutes(w.duration)) {
    out.push(v('error', 'DURATION', week, `${where} : durée absente ou illisible ("${w.duration}").`, { id: w.id }));
  }
  return out;
}

/** Valide UNE semaine. */
export function validateWeek(week, ctx, weekKey) {
  const list = Array.isArray(week) ? week : [];
  const out = [];
  const sessions = list.filter((w) => w.type !== 'REPOS');

  list.forEach((w) => out.push(...validateSession(w, ctx, weekKey)));

  if (ctx.maxSessionsPerWeek) {
    const count = sessions.reduce((s, w) => s + sessionWeight(w), 0);
    if (count !== ctx.maxSessionsPerWeek) {
      out.push(v('error', 'SESSION_COUNT', weekKey, `Semaine ${weekKey} : ${count} séances (enchaînement = 2) au lieu de ${ctx.maxSessionsPerWeek}.`, { actual: count, expected: ctx.maxSessionsPerWeek }));
    }
  }

  ctx.offDays.forEach((day) => {
    const s = sessions.filter((w) => w.day === day);
    if (s.length) out.push(v('error', 'OFF_DAY', weekKey, `Semaine ${weekKey} : ${day} est le jour de repos obligatoire mais contient ${s.map((w) => `« ${w.title} »`).join(', ')}.`, { day }));
  });

  DAYS_OF_WEEK.forEach((day) => {
    const s = sessions.filter((w) => w.day === day);
    if (!s.length) return;
    const cap = dayCapFor(ctx, s);
    if (s.length > cap) {
      out.push(v('error', 'DAY_CAP', weekKey, `Semaine ${weekKey} : ${day} a ${s.length} séances (maximum ${cap}${cap === 1 ? ' : un enchaînement reste seul sur sa journée' : ''}).`, { day }));
    }
    if (ctx.sportType === 'triathlon') {
      const byDisc = {};
      s.forEach((w) => { const d = classifyDiscipline(w.type); byDisc[d] = (byDisc[d] || 0) + 1; });
      Object.entries(byDisc).forEach(([d, n]) => {
        if (n > 1) out.push(v('error', 'SAME_DISCIPLINE_DAY', weekKey, `Semaine ${weekKey} : ${day} contient ${n} séances ${d} — un jour double doit combiner deux disciplines différentes.`, { day }));
      });
    }
    const titles = s.map((w) => `${classifyDiscipline(w.type)}::${String(w.title || '').trim().toLowerCase()}`);
    if (new Set(titles).size !== titles.length) {
      out.push(v('error', 'DUPLICATE', weekKey, `Semaine ${weekKey} : ${day} contient deux fois la même séance.`, { day }));
    }
  });

  if (ctx.hoursPerWeek && ctx.phaseKey !== 'taper' && ctx.phaseKey !== 'recovery') {
    const totalMin = sessions.reduce((s, w) => s + parseDurationMinutes(w.duration), 0);
    const targetMin = ctx.hoursPerWeek * 60;
    if (Math.abs(totalMin - targetMin) / targetMin > 0.15) {
      out.push(v('warn', 'VOLUME', weekKey, `Semaine ${weekKey} : volume ${formatH(totalMin)} pour ${formatH(targetMin)} déclarées (tolérance ±15 %).`, { actual: totalMin, expected: targetMin }));
    }
  }

  return out;
}

function formatH(min) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${h}h${String(m).padStart(2, '0')}`;
}

/**
 * Enchaînement de séances dures sur deux jours consécutifs (N puis N+1, frontière incluse).
 * Règle adaptée au niveau :
 *   - expérience ≤ intermédiaire : deux jours durs consécutifs, quelle que soit la discipline ;
 *   - confirmé/expert : même discipline deux jours de suite (hors natation, sans impact), ou
 *     course à pied dure deux jours de suite (impact) — une qualité natation le lendemain d'une qualité vélo est
 *     une organisation classique chez un triathlète entraîné, pas une erreur.
 */
export function findConsecutiveHardIssues(weekN, weekN1, ctx) {
  const out = [];
  const seq = [
    ...DAYS_OF_WEEK.map((day) => ({ week: 'N', day, list: weekN })),
    ...DAYS_OF_WEEK.map((day) => ({ week: 'N+1', day, list: weekN1 })),
  ];
  const hardOf = (e) => (e.list || []).filter((w) => w.day === e.day && w.type !== 'REPOS' && isHardSession(w));
  for (let i = 1; i < seq.length; i += 1) {
    const prev = hardOf(seq[i - 1]);
    const cur = hardOf(seq[i]);
    if (!prev.length || !cur.length) continue;
    let conflict = null;
    if (ctx.expRank <= 3) {
      conflict = cur[0];
    } else {
      conflict = cur.find((c) => prev.some((p) => (classifyDiscipline(p.type) === classifyDiscipline(c.type) && classifyDiscipline(c.type) !== 'NATATION')
        || (classifyDiscipline(c.type) === 'C.A.P' && ['C.A.P', 'ENCHAÎNEMENT'].includes(classifyDiscipline(p.type)))));
    }
    if (conflict) {
      out.push(v('warn', 'CONSECUTIVE_HARD', seq[i].week, `Semaine ${seq[i].week} : « ${conflict.title} » (${seq[i].day}) suit une séance dure la veille (${seq[i - 1].day}) — récupération insuffisante pour ce profil.`, { id: conflict.id, day: seq[i].day }));
    }
  }
  return out;
}

function weekSignature(week) {
  return (week || [])
    .filter((w) => w.type !== 'REPOS')
    .map((w) => `${w.day}|${classifyDiscipline(w.type)}|${parseDurationMinutes(w.duration)}|${String(w.title).toLowerCase()}`)
    .sort()
    .join(';');
}

/** Valide le plan complet (les deux semaines + règles transverses). */
export function validatePlan(weeks, ctx) {
  const out = [
    ...validateWeek(weeks.N, ctx, 'N'),
    ...validateWeek(weeks['N+1'], ctx, 'N+1'),
    ...findConsecutiveHardIssues(weeks.N, weeks['N+1'], ctx),
  ];
  if (weeks.N?.length && weeks['N+1']?.length && weekSignature(weeks.N) === weekSignature(weeks['N+1'])) {
    out.push(v('warn', 'SAME_WEEKS', 'N+1', 'Les semaines N et N+1 sont identiques : aucune progression ni variation.'));
  }
  return out;
}

/** Valide une seule semaine avec l'autre en contexte (régénération ciblée). */
export function validateSingleWeek(weeks, weekKey, ctx) {
  return [
    ...validateWeek(weeks[weekKey], ctx, weekKey),
    ...findConsecutiveHardIssues(weeks.N, weeks['N+1'], ctx).filter((i) => i.week === weekKey),
  ];
}

export function scoreViolations(violations) {
  return (violations || []).reduce((s, x) => s + (x.severity === 'error' ? 10 : 1), 0);
}

export function countErrors(violations) {
  return (violations || []).filter((x) => x.severity === 'error').length;
}

/** Applique sanitizeWorkout à toute une semaine (enrichissement déterministe des champs). */
export function sanitizeWeek(week, profile) {
  return (week || []).map((w) => sanitizeWorkout(w, profile));
}
