// lib/trainingCycle.js
//
// CYCLE CHARGE / DÉCHARGE et BASCULE AUTOMATIQUE DE SEMAINE.
//
// 1. Cycle de charge : l'athlète déclare un rythme (ex. 3 semaines de charge + 1 de
//    décharge) et la position de la semaine en cours dans ce cycle. On enregistre une
//    ANCRE (le lundi de la 1re semaine de charge du cycle en cours) : la nature de n'importe
//    quelle semaine future s'en déduit sans rien stocker d'autre. Avant, l'app demandait
//    systématiquement le même volume pour N et N+1, même quand l'athlète était en décharge.
//
// 2. Bascule de semaine : `trainingPlan.weekAnchor` = lundi de la semaine N au moment de la
//    génération. Quand une nouvelle semaine calendaire commence, l'ancienne N+1 devient N
//    et N+1 reste à générer. Avant, l'app continuait d'afficher les séances de la semaine
//    passée comme « semaine en cours » (et l'association Strava, qui suppose N = semaine
//    réelle, se trompait).
//
// Toutes les dates sont manipulées en chaînes ISO "YYYY-MM-DD" interprétées en UTC, pour
// ne dépendre d'aucun fuseau horaire (navigateur ou serveur Vercel).

const DAY_MS = 86_400_000;

export const LOAD_PATTERNS = {
  none: { charge: 0, decharge: 0, label: 'Aucun cycle' },
  '1:1': { charge: 1, decharge: 1, label: '1 semaine de charge + 1 de décharge' },
  '2:1': { charge: 2, decharge: 1, label: '2 semaines de charge + 1 de décharge' },
  '3:1': { charge: 3, decharge: 1, label: '3 semaines de charge + 1 de décharge' },
};

// Volume d'une semaine de décharge par rapport au volume déclaré (repère courant : -25 à
// -40 %). 70 % correspond aussi à ce que l'athlète pratiquait déjà (≈14 h pour ≈20 h).
export const DECHARGE_VOLUME_RATIO = 0.7;

export function parseIsoUTC(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

export function isoFromUTC(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Lundi (ISO) de la semaine contenant la date ISO donnée. */
export function mondayIso(iso) {
  const t = parseIsoUTC(iso);
  if (t === null) return null;
  const dow = (new Date(t).getUTCDay() + 6) % 7; // 0 = lundi
  return isoFromUTC(t - dow * DAY_MS);
}

export function addWeeksIso(iso, n) {
  const t = parseIsoUTC(iso);
  return t === null ? null : isoFromUTC(t + n * 7 * DAY_MS);
}

function weeksBetween(fromIso, toIso) {
  const a = parseIsoUTC(mondayIso(fromIso));
  const b = parseIsoUTC(mondayIso(toIso));
  if (a === null || b === null) return null;
  return Math.round((b - a) / (7 * DAY_MS));
}

/**
 * Crée la configuration de cycle à partir du rythme et de la position de la semaine en
 * cours (1 = 1re semaine de charge ; charge+1 = semaine de décharge).
 */
export function buildLoadCycle(pattern, currentWeekIndex, todayIso) {
  const conf = LOAD_PATTERNS[pattern];
  if (!conf || pattern === 'none') return { pattern: 'none' };
  const length = conf.charge + conf.decharge;
  const idx = Math.min(Math.max(1, Number(currentWeekIndex) || 1), length);
  return { pattern, anchor: addWeeksIso(mondayIso(todayIso), -(idx - 1)) };
}

/**
 * Nature d'une semaine (identifiée par n'importe quelle date de cette semaine).
 * @returns {{kind:'charge'|'decharge', index:number, length:number, label:string}|null}
 */
export function weekLoadInfo(loadCycle, dateIso) {
  const conf = LOAD_PATTERNS[loadCycle?.pattern];
  if (!conf || loadCycle.pattern === 'none' || !loadCycle.anchor) return null;
  const length = conf.charge + conf.decharge;
  const diff = weeksBetween(loadCycle.anchor, dateIso);
  if (diff === null) return null;
  const index = (((diff % length) + length) % length) + 1; // 1..length
  const kind = index <= conf.charge ? 'charge' : 'decharge';
  const label = kind === 'charge'
    ? `semaine de CHARGE ${index}/${conf.charge}`
    : 'semaine de DÉCHARGE';
  return { kind, index, length, label };
}

/** Volume cible (heures) d'une semaine selon sa nature. */
export function weekHoursTarget(hoursPerWeek, info) {
  const h = Number(hoursPerWeek) || 0;
  if (!h) return null;
  return info?.kind === 'decharge' ? Math.round(h * DECHARGE_VOLUME_RATIO * 10) / 10 : h;
}

/**
 * Bascule de semaine. `weekAnchor` = lundi (ISO) de la semaine N enregistrée.
 * - même semaine → rien ne change ;
 * - 1 semaine plus tard → N+1 devient N, N+1 vide (à générer) ;
 * - 2 semaines ou plus → les deux semaines sont périmées, N et N+1 vides.
 * Un plan sans ancre (généré avant cette fonctionnalité) reçoit l'ancre de la semaine en
 * cours, sans décalage : on suppose que N correspond à la semaine affichée aujourd'hui.
 */
export function rolloverWorkouts(workouts, weekAnchor, todayIso) {
  const currentMonday = mondayIso(todayIso);
  const safe = { N: workouts?.N || [], 'N+1': workouts?.['N+1'] || [] };
  if (!weekAnchor || parseIsoUTC(weekAnchor) === null) {
    return { workouts: safe, weekAnchor: currentMonday, shifted: 0 };
  }
  const diff = weeksBetween(weekAnchor, currentMonday);
  if (diff === null || diff <= 0) return { workouts: safe, weekAnchor, shifted: 0 };
  if (diff === 1) return { workouts: { N: safe['N+1'], 'N+1': [] }, weekAnchor: currentMonday, shifted: 1 };
  return { workouts: { N: [], 'N+1': [] }, weekAnchor: currentMonday, shifted: diff };
}

// --- Priorités de l'athlète -------------------------------------------------------------

export const FOCUS_AREAS = [
  { id: 'transitions', label: 'Transitions T1/T2', prompt: 'transitions T1/T2 (intégrer des répétitions de transition dans les enchaînements, routine casque/dossard/chaussures)' },
  { id: 'drafting', label: 'Course en peloton', prompt: 'course avec aspiration (relances, changements de rythme, efforts au-dessus du seuil répétés à vélo)' },
  { id: 'polarisation', label: 'Sortir de la zone grise', prompt: 'polarisation (vraies séances faciles en Z1-Z2, vraies séances dures courtes ; éviter la Z3 continue)' },
  { id: 'vitesse', label: 'Vitesse course (VMA courte)', prompt: 'vitesse pure en course à pied (VMA courte 200-600 m, progressive pour les tendons)' },
  { id: 'seuil', label: 'Seuil', prompt: 'capacité au seuil (blocs longs au seuil en vélo et en course)' },
  { id: 'natation_tech', label: 'Technique natation', prompt: 'technique de nage (éducatifs, glisse, fréquence de bras)' },
  { id: 'eau_libre', label: 'Eau libre', prompt: 'natation en eau libre (orientation, départs groupés, nage en contact)' },
  { id: 'force', label: 'Force / côtes', prompt: 'force spécifique (côtes, vélo en force basse cadence)' },
  { id: 'endurance', label: 'Endurance / volume', prompt: 'endurance de base (volume en Z2, sorties longues)' },
];

export function describeFocusAreas(ids) {
  const list = (Array.isArray(ids) ? ids : []).map((id) => FOCUS_AREAS.find((f) => f.id === id)).filter(Boolean);
  return list.map((f) => f.prompt);
}
