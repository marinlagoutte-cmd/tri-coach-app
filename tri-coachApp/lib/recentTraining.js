// lib/recentTraining.js
//
// CE QUE L'ATHLÈTE A RÉELLEMENT FAIT — calculé à partir des activités Strava synchronisées,
// pour deux usages :
//   1. `summarizeRecentTraining` : résumé compact (3 semaines) envoyé à l'IA avec chaque
//      génération / chat. Avant, le coach IA ne recevait que les ressentis déclarés : il
//      ignorait le volume réellement réalisé, les séances sautées et la fatigue accumulée.
//      Uniquement des chiffres calculés (aucun nom d'activité, aucun texte libre).
//   2. `findPastUnconfirmedSessions` : séances passées de la semaine en cours, classées
//      "faite" / "manquée" / "à confirmer" (écran Aujourd'hui).
//
// Aucune valeur n'est estimée en silence : la charge d'une activité sans FC ni puissance
// est comptée en Z2 par computeActivityLoad (lib/analytics.js), et ce nombre d'activités
// estimées est transmis avec le résumé.

import { computeActivityLoad, computeTrainingLoadSeries, describeTsb, activityIntensityZone } from './analytics';
import { stravaSportToDiscipline } from './stravaClient';
import { classifyDiscipline } from './workouts';
import { DAYS_OF_WEEK } from './defaults';

const DAY_MS = 86_400_000;

function localDayIso(dateLike) {
  // start_date_local de Strava = heure locale de l'activité écrite en "Z" : les 10 premiers
  // caractères donnent directement le jour local, sans conversion de fuseau.
  const s = String(dateLike || '');
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

function isoToUTC(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function isoFromUTC(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function mondayIso(iso) {
  const t = isoToUTC(iso);
  const dow = (new Date(t).getUTCDay() + 6) % 7;
  return isoFromUTC(t - dow * DAY_MS);
}

const round1 = (x) => Math.round(x * 10) / 10;

/**
 * @param {object} p
 * @param {Array}  p.activities  activités Strava (table strava_activities)
 * @param {object} p.profile     profil (FTP, FC max… pour la zone d'intensité)
 * @param {string} p.todayIso    date locale "YYYY-MM-DD"
 * @param {number} [p.weeks=3]   semaines complètes + semaine en cours
 * @returns {object|null} null si aucune activité récente (Strava non connecté ou inactif)
 */
export function summarizeRecentTraining({ activities, profile, todayIso, weeks = 3 }) {
  const list = (activities || []).filter((a) => localDayIso(a.start_date_local || a.start_date));
  const currentMonday = mondayIso(todayIso);
  const fromIso = isoFromUTC(isoToUTC(currentMonday) - weeks * 7 * DAY_MS);
  const recent = list.filter((a) => {
    const d = localDayIso(a.start_date_local || a.start_date);
    return d >= fromIso && d <= todayIso;
  });
  if (!recent.length) return null;

  const weekRows = [];
  for (let i = weeks; i >= 0; i -= 1) {
    const start = isoFromUTC(isoToUTC(currentMonday) - i * 7 * DAY_MS);
    const end = isoFromUTC(isoToUTC(start) + 6 * DAY_MS);
    const acts = recent.filter((a) => {
      const d = localDayIso(a.start_date_local || a.start_date);
      return d >= start && d <= end;
    });
    const row = {
      weekStart: start,
      current: i === 0,
      sessions: acts.length,
      hours: { swim: 0, bike: 0, run: 0, other: 0 },
      km: { swim: 0, bike: 0, run: 0 },
      hardSessions: 0,
      load: 0,
    };
    acts.forEach((a) => {
      const h = (a.moving_time_s || 0) / 3600;
      const km = (a.distance_m || 0) / 1000;
      const disc = stravaSportToDiscipline(a.sport_type);
      const key = disc === 'NATATION' ? 'swim' : disc === 'CYCLISME' ? 'bike' : disc === 'C.A.P' ? 'run' : 'other';
      row.hours[key] += h;
      if (key !== 'other') row.km[key] += km;
      const zone = activityIntensityZone(a, profile);
      if (zone && Number(String(zone).replace(/\D/g, '')) >= 4) row.hardSessions += 1;
      row.load += computeActivityLoad(a, profile).load;
    });
    // Moyenne calculée sur les valeurs EXACTES (arrondir avant de moyenner décalait le résultat).
    row.exactHours = Object.values(row.hours).reduce((s, x) => s + x, 0);
    Object.keys(row.hours).forEach((k) => { row.hours[k] = round1(row.hours[k]); });
    Object.keys(row.km).forEach((k) => { row.km[k] = round1(row.km[k]); });
    row.totalHours = round1(Object.values(row.hours).reduce((s, x) => s + x, 0));
    weekRows.push(row);
  }

  // CTL/ATL/TSB sur tout l'historique disponible (plus fiable qu'une fenêtre courte).
  const series = computeTrainingLoadSeries(list.filter((a) => localDayIso(a.start_date_local || a.start_date) <= todayIso), profile);
  const cur = series.current;
  const tsbInfo = cur ? describeTsb(cur.tsb) : null;
  const complete = weekRows.filter((w) => !w.current && w.totalHours > 0);
  const avgHours = complete.length ? round1(complete.reduce((s, w) => s + w.exactHours, 0) / complete.length) : null;
  weekRows.forEach((w) => { delete w.exactHours; });

  return {
    weeks: weekRows,
    avgCompletedWeekHours: avgHours,
    load: cur ? { ctl: cur.ctl, atl: cur.atl, tsb: cur.tsb, label: tsbInfo?.label || null } : null,
    dataQuality: { activities: series.totalCount, estimatedLoad: series.estimatedCount, historyDays: series.spanDays },
  };
}

/**
 * Séances passées (avant aujourd'hui) de la semaine N, avec leur statut :
 *  - 'done'      : validée (ressenti enregistré) ou activité Strava associée / même discipline le même jour ;
 *  - 'missed'    : déclarée non faite par l'athlète, OU Strava actif (activité dans les 7 derniers
 *                  jours) sans aucune activité correspondante ;
 *  - 'unknown'   : impossible de savoir (pas de Strava récent, pas de validation) → à confirmer.
 * Les séances marquées 'skipped' (ignorées volontairement) sont exclues.
 */
export function findPastUnconfirmedSessions({ workoutsN, activities, feedbackHistory, sessionStatus = {}, todayIso, weekStartIso }) {
  const todayIdx = Math.round((isoToUTC(todayIso) - isoToUTC(weekStartIso)) / DAY_MS);
  if (todayIdx <= 0) return [];
  const validated = new Set((feedbackHistory || []).map((f) => f.workoutId));
  const acts = activities || [];
  const recentFrom = isoFromUTC(isoToUTC(todayIso) - 7 * DAY_MS);
  const stravaActive = acts.some((a) => localDayIso(a.start_date_local || a.start_date) >= recentFrom);

  return (workoutsN || [])
    .filter((w) => w && w.type !== 'REPOS')
    .map((w) => {
      const dayIdx = DAYS_OF_WEEK.indexOf(w.day);
      if (dayIdx < 0 || dayIdx >= Math.min(todayIdx, 7)) return null;
      const dayIso = isoFromUTC(isoToUTC(weekStartIso) + dayIdx * DAY_MS);
      const disc = classifyDiscipline(w.type);
      const matched = acts.some((a) => a.matched_workout_id === w.id
        || (localDayIso(a.start_date_local || a.start_date) === dayIso
          && (stravaSportToDiscipline(a.sport_type) === disc || (disc === 'ENCHAÎNEMENT' && ['CYCLISME', 'C.A.P'].includes(stravaSportToDiscipline(a.sport_type))))));
      const declared = sessionStatus[w.id];
      if (declared === 'skipped') return null;
      let status = 'unknown';
      if (validated.has(w.id) || matched || declared === 'done') status = 'done';
      else if (declared === 'missed' || stravaActive) status = 'missed';
      return { workout: w, dayIso, status };
    })
    .filter(Boolean);
}

/** Libellés courts des séances manquées pour l'IA (aucun texte libre). */
export function describeMissedForAI(past) {
  return (past || [])
    .filter((p) => p.status === 'missed')
    .map((p) => ({ day: p.workout.day, date: p.dayIso, type: p.workout.type, title: String(p.workout.title || '').slice(0, 60), duration: p.workout.duration }));
}
