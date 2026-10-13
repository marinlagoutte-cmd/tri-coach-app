// lib/seasonImport.js
//
// PLAN DE SAISON COMPLET IMPORTÉ (demande de l'athlète) : toutes les séances de la saison sont
// écrites à l'avance (fichier JSON, voir scripts/season-plan/) et importées dans l'app. Les
// semaines N et N+1 sont alors REMPLIES DEPUIS LE PLAN — à l'import, à chaque bascule de
// semaine et par le bouton « Générer cette semaine » — sans appel à une IA. Les IA internes
// ne servent plus qu'aux retours de séance (activités Strava) et aux ajustements demandés au
// coach (chat, régénération explicite d'une semaine).
//
// Format (version 1) :
// {
//   "format": "tri-coach-season-plan", "version": 1,
//   "meta": { "title", "targetDate", "startDate", "generatedAt", "athlete", "assumptions": [] },
//   "constraints": { … champs du questionnaire, facultatif … },
//   "weeks": [ { "weekStart": "2026-10-12", "phase": "Base", "kind": "decharge",
//                "label": "Décharge", "plannedHours": 14, "sessions": [ { day, type, title,
//                duration, intensity, effortZone, cardio, rpe, cadence, restTime, structure,
//                desc } … ] } … ]
// }

import { DAYS_OF_WEEK } from './defaults';

export const SEASON_PLAN_FORMAT = 'tri-coach-season-plan';
export const SEASON_PLAN_VERSION = 1;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

function isMonday(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 1;
}

export function addDaysIso(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

export function mondayOfIso(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  const offset = (t.getUTCDay() + 6) % 7;
  return addDaysIso(iso, -offset);
}

/**
 * Lit et vérifie un plan de saison. Renvoie { meta, constraints, weeks } normalisé, ou lève
 * une Error au message lisible par l'athlète.
 */
export function parseSeasonPlan(input) {
  let data = input;
  if (typeof input === 'string') {
    try { data = JSON.parse(input); } catch { throw new Error("Ce fichier n'est pas un JSON valide."); }
  }
  if (!data || data.format !== SEASON_PLAN_FORMAT) throw new Error('Ce fichier n\'est pas un plan TRI COACH (format inconnu).');
  if (Number(data.version) !== SEASON_PLAN_VERSION) throw new Error(`Version de plan non prise en charge (${data.version}).`);
  if (!Array.isArray(data.weeks) || data.weeks.length === 0) throw new Error('Le plan ne contient aucune semaine.');

  const seen = new Set();
  const weeks = data.weeks.map((w, wi) => {
    if (!ISO.test(String(w.weekStart || '')) || !isMonday(w.weekStart)) {
      throw new Error(`Semaine ${wi + 1} : « weekStart » doit être un lundi au format AAAA-MM-JJ.`);
    }
    if (seen.has(w.weekStart)) throw new Error(`Semaine du ${w.weekStart} présente deux fois.`);
    seen.add(w.weekStart);
    if (!Array.isArray(w.sessions)) throw new Error(`Semaine du ${w.weekStart} : aucune liste de séances.`);
    const sessions = w.sessions.map((s, si) => {
      if (!DAYS_OF_WEEK.includes(s.day)) throw new Error(`Semaine du ${w.weekStart}, séance ${si + 1} : jour « ${s.day} » inconnu.`);
      if (!s.type || !s.title) throw new Error(`Semaine du ${w.weekStart}, séance ${si + 1} : type et titre obligatoires.`);
      return {
        intensity: '', effortZone: '', cardio: '', rpe: '', cadence: '', restTime: '', structure: '', desc: '',
        ...s,
        duration: s.duration || '0 min',
        id: s.id || `p${w.weekStart.replace(/-/g, '')}-${si + 1}`,
        modified: false,
        fromSeasonPlan: true,
      };
    });
    // Jours sans séance → entrée « Repos » (le calendrier affiche les 7 jours).
    DAYS_OF_WEEK.forEach((day) => {
      if (!sessions.some((s) => s.day === day)) {
        sessions.push({ id: `p${w.weekStart.replace(/-/g, '')}-r${day.slice(0, 2)}`, day, type: 'REPOS', title: 'Repos complet', duration: '0 min', desc: 'Repos complet : sommeil, hydratation, mobilité légère si l\'envie est là.', modified: false, fromSeasonPlan: true });
      }
    });
    sessions.sort((a, b) => DAYS_OF_WEEK.indexOf(a.day) - DAYS_OF_WEEK.indexOf(b.day));
    return { weekStart: w.weekStart, phase: w.phase || '', kind: w.kind || '', label: w.label || '', plannedHours: w.plannedHours ?? null, sessions };
  }).sort((a, b) => a.weekStart.localeCompare(b.weekStart));

  return {
    meta: { title: 'Plan de saison', ...(data.meta || {}), weeksCount: weeks.length, firstWeek: weeks[0].weekStart, lastWeek: weeks[weeks.length - 1].weekStart },
    constraints: data.constraints || null,
    weeks,
  };
}

/** Séances de la semaine commençant le lundi `mondayIso` (copie), ou null si hors plan. */
export function seasonWeek(season, mondayIso) {
  const w = season?.weeks?.find((x) => x.weekStart === mondayIso);
  return w ? w.sessions.map((s) => ({ ...s })) : null;
}

/** Métadonnées (phase, nature, heures) de la semaine, ou null. */
export function seasonWeekInfo(season, mondayIso) {
  const w = season?.weeks?.find((x) => x.weekStart === mondayIso);
  return w ? { phase: w.phase, kind: w.kind, label: w.label, plannedHours: w.plannedHours } : null;
}

/**
 * Remplit N et N+1 depuis le plan pour la semaine dont le lundi est `anchorMonday`.
 * `onlyEmpty` : ne remplace pas une semaine qui contient déjà des séances (ajustements
 * conservés) — utilisé à la bascule de semaine.
 */
export function fillWeeksFromSeason(workouts, season, anchorMonday, { onlyEmpty = true } = {}) {
  const out = { N: workouts?.N || [], 'N+1': workouts?.['N+1'] || [] };
  const hasSessions = (list) => (list || []).some((w) => w.type !== 'REPOS');
  const n = seasonWeek(season, anchorMonday);
  const n1 = seasonWeek(season, addDaysIso(anchorMonday, 7));
  if (n && (!onlyEmpty || !hasSessions(out.N))) out.N = n;
  if (n1 && (!onlyEmpty || !hasSessions(out['N+1']))) out['N+1'] = n1;
  return out;
}
