// lib/coachDossier.js
//
// SUIVI PAR CLAUDE (demande de l'athlète) : les IA internes gèrent le quotidien (retours de
// séance, petits ajustements) ; Claude garde la main sur le long terme. Pour cela :
//   1. l'app tient un JOURNAL de tout ce qui modifie ou commente le plan (ajustements du
//      coach IA, semaines générées par l'IA, validations et statuts de séance, imports) ;
//   2. l'athlète EXPORTE ponctuellement un « dossier » (un seul fichier JSON) qu'il téléverse à
//      Claude ;
//   3. Claude vérifie et renvoie un plan ajusté (format tri-coach-season-plan,
//      lib/seasonImport.js), que l'athlète réimporte dans l'app.

export const JOURNAL_MAX = 3000;
export const DOSSIER_FORMAT = 'tri-coach-dossier';
export const DOSSIER_VERSION = 1;

// Champs d'une séance utiles pour juger un changement (sans les identifiants techniques).
const SESSION_FIELDS = ['day', 'type', 'title', 'duration', 'intensity', 'effortZone', 'rpe', 'structure', 'desc'];
const pick = (w) => (w ? Object.fromEntries(SESSION_FIELDS.filter((k) => w[k] !== undefined && w[k] !== '').map((k) => [k, w[k]])) : null);

/**
 * Différences entre deux versions d'une liste de séances : séances ajoutées, supprimées ou
 * modifiées (avec l'avant et l'après des champs qui ont changé). Les jours de repos sont
 * ignorés.
 */
export function diffSessions(before = [], after = []) {
  const real = (list) => (list || []).filter((w) => w && w.type !== 'REPOS');
  const b = new Map(real(before).map((w) => [w.id, w]));
  const a = new Map(real(after).map((w) => [w.id, w]));
  const out = [];
  a.forEach((w, id) => {
    const old = b.get(id);
    if (!old) { out.push({ id, change: 'ajoutée', after: pick(w) }); return; }
    const changed = SESSION_FIELDS.filter((k) => String(old[k] ?? '') !== String(w[k] ?? ''));
    if (changed.length) {
      out.push({
        id, change: 'modifiée', fields: changed,
        before: Object.fromEntries(changed.map((k) => [k, old[k] ?? ''])),
        after: Object.fromEntries(changed.map((k) => [k, w[k] ?? ''])),
      });
    }
  });
  b.forEach((w, id) => { if (!a.has(id)) out.push({ id, change: 'supprimée', before: pick(w) }); });
  return out;
}

/** Ajoute un événement daté au journal (borné aux JOURNAL_MAX derniers). */
export function appendJournal(journal, type, data = {}, now = new Date()) {
  const list = Array.isArray(journal) ? journal : [];
  const next = [...list, { at: now.toISOString(), type, ...data }];
  return next.length > JOURNAL_MAX ? next.slice(next.length - JOURNAL_MAX) : next;
}

/** Retire les données lourdes ou inutiles à l'analyse (photos encodées, flux GPS). */
function lighten(value) {
  if (Array.isArray(value)) return value.map(lighten);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([k, v]) => !(typeof v === 'string' && v.startsWith('data:')) && !['photo', 'photoUrl', 'avatar', 'streams', 'summary_polyline'].includes(k))
      .map(([k, v]) => [k, lighten(v)]));
  }
  return value;
}

/**
 * Construit le dossier à téléverser à Claude. Tout ce qui est fourni est inclus tel quel
 * (allégé des photos) : rien n'est résumé ni estimé ici, Claude travaille sur les données brutes.
 */
export function buildCoachDossier({
  profile = {}, constraints = null, seasonPlan = null, trainingPlan = null, workouts = {}, weekAnchor = null,
  weekHistory = [], feedbackHistory = [], sessionStatus = {}, healthHistory = [], injuryLog = [], raceCalendar = [],
  chat = [], journal = [], stravaActivities = [], zones = {}, exportedAt = new Date(),
} = {}) {
  return lighten({
    format: DOSSIER_FORMAT,
    version: DOSSIER_VERSION,
    exportedAt: exportedAt.toISOString(),
    athlete: profile,
    zones,
    questionnaire: constraints,
    plan: {
      title: trainingPlan?.title || null,
      targetDate: trainingPlan?.date || null,
      source: trainingPlan?.source || null,
      seasonPlan: seasonPlan ? { ...seasonPlan.meta, weeks: undefined } : null,
    },
    currentWeeks: { weekStart: weekAnchor, N: workouts?.N || [], 'N+1': workouts?.['N+1'] || [] },
    weekHistory,
    sessionFeedback: feedbackHistory,
    sessionStatus,
    health: healthHistory,
    injuries: injuryLog,
    races: raceCalendar,
    coachChat: (chat || []).slice(-300),
    journal,
    stravaActivities,
  });
}

/** Nom de fichier du dossier : tri-coach-dossier-AAAA-MM-JJ.json */
export function dossierFileName(date = new Date()) {
  return `tri-coach-dossier-${date.toISOString().slice(0, 10)}.json`;
}
