// lib/stravaMatch.js
//
// Fait correspondre une activité Strava à une séance prévue du plan Tri Coach.
//
// CONTRAINTE IMPORTANTE (voir CHANGELOG) : le calendrier Tri Coach n'a PAS de
// vraies dates par séance — seulement un jour de semaine ('Lundi'...'Dimanche')
// dans 'Semaine N' (en cours) ou 'Semaine N+1' (suivante). La correspondance
// automatique part donc de l'hypothèse que "Semaine N" = la semaine calendaire
// réelle en cours (lundi-dimanche) : une activité Strava du mardi est comparée
// au jour "Mardi" de workouts.N. Si l'athlète a pris de l'avance/du retard sur
// son plan réel, cette hypothèse peut être fausse — d'où la correction manuelle
// toujours possible (voir pages/api/strava/match.js et ActivityDetail.js).
import { DAYS_OF_WEEK } from './defaults';
import { shortLabel } from './workouts';
import { stravaSportToDiscipline } from './stravaClient';

/** Jour de semaine réel (français, forme canonique de l'app) d'une date ISO. */
export function isoDateToDayName(isoDateStr) {
  const d = new Date(isoDateStr);
  if (Number.isNaN(d.getTime())) return null;
  // getDay() : 0=dimanche...6=samedi. DAYS_OF_WEEK commence à Lundi.
  const idx = (d.getDay() + 6) % 7;
  return DAYS_OF_WEEK[idx];
}

/**
 * Cherche, dans workouts.N (uniquement — voir doc en tête de fichier), la
 * séance dont le jour correspond au jour réel de l'activité ET dont la
 * discipline correspond au sport Strava. Retourne null si rien ne correspond
 * (pas d'erreur : c'est un cas normal, ex. séance de muscu, jour non planifié).
 */
export function findAutoMatch(activity, workouts) {
  const dayName = isoDateToDayName(activity.start_date_local || activity.start_date);
  const discipline = stravaSportToDiscipline(activity.sport_type || activity.type);
  if (!dayName || !discipline) return { weekKey: null, workoutId: null };

  const weekWorkouts = workouts?.N || [];
  const sportShort = shortLabel(discipline);
  const candidate = weekWorkouts.find(
    (w) => w.day?.toLowerCase() === dayName.toLowerCase() && w.type !== 'REPOS' && shortLabel(w.type) === sportShort
  );
  return candidate ? { weekKey: 'N', workoutId: candidate.id } : { weekKey: null, workoutId: null };
}

/** mm:ss ou h:mm:ss à partir d'un nombre de secondes. */
export function formatDurationFromSeconds(totalSeconds) {
  const s = Math.round(totalSeconds || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/** Allure min/km à partir d'une vitesse en m/s (course/marche). */
export function formatPaceFromSpeedMs(speedMs) {
  if (!speedMs) return '-';
  const minPerKm = 1000 / speedMs / 60;
  const min = Math.floor(minPerKm);
  const sec = Math.round((minPerKm - min) * 60);
  return `${min}:${String(sec).padStart(2, '0')} /km`;
}

/** km à partir de mètres, 1 décimale. */
export function formatKm(distanceM) {
  return `${(Number(distanceM || 0) / 1000).toFixed(1)} km`;
}

/**
 * true si `isoDateStr` tombe dans la semaine calendaire réelle en cours
 * (lundi 00:00 → dimanche 23:59, semaine contenant "aujourd'hui") — c'est la
 * fenêtre utilisée pour afficher la ligne "activités réalisées" du calendrier,
 * cohérente avec l'hypothèse "Semaine N = semaine réelle en cours" (voir
 * findAutoMatch ci-dessus).
 */
export function isInCurrentCalendarWeek(isoDateStr) {
  const d = new Date(isoDateStr);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  const mondayOffset = (now.getDay() + 6) % 7; // jours écoulés depuis lundi
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(now.getDate() - mondayOffset);
  const nextMonday = new Date(monday);
  nextMonday.setDate(monday.getDate() + 7);
  return d >= monday && d < nextMonday;
}

/**
 * Epoch Unix (secondes) du lundi 00:00:00 — heure locale de qui exécute ce code — de la
 * semaine calendaire courante, ou `weeksAgo` semaines plus tôt (0 = semaine en cours,
 * 1 = semaine précédente...). Utilisée pour borner l'import manuel Strava (voir
 * handleStravaSync dans SettingsModal.js) à la semaine en cours + la précédente plutôt
 * que tout l'historique. Calculée volontairement CÔTÉ CLIENT (le navigateur connaît le
 * vrai fuseau horaire de l'athlète, contrairement au serveur Vercel qui tourne en UTC) —
 * voir pages/api/strava/sync.js qui reçoit ce repère déjà calculé plutôt que de le
 * recalculer lui-même.
 */
export function getCalendarWeekStartEpochSec(weeksAgo = 0) {
  const now = new Date();
  const mondayOffset = (now.getDay() + 6) % 7; // jours écoulés depuis lundi
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(now.getDate() - mondayOffset - weeksAgo * 7);
  return Math.floor(monday.getTime() / 1000);
}

/**
 * Epoch Unix (secondes) de minuit — heure locale de qui exécute ce code — il y a
 * `daysAgo` jours (0 = aujourd'hui minuit). Même principe que
 * getCalendarWeekStartEpochSec ci-dessus (calculé CÔTÉ CLIENT pour le vrai fuseau
 * horaire de l'athlète) mais en fenêtre glissante plutôt que calée sur le lundi —
 * utilisée pour borner l'import manuel Strava à "le dernier mois" (voir
 * handleStravaSync dans SettingsModal.js et pages/api/strava/sync.js), pour que
 * l'onglet Profil (graphes de tendance, métriques auto-détectées) ait assez
 * d'historique même pour un athlète qui vient de lier son compte.
 */
export function getLocalDayStartEpochSec(daysAgo = 0) {
  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  dayStart.setDate(now.getDate() - daysAgo);
  return Math.floor(dayStart.getTime() / 1000);
}

/** Regroupe une liste d'activités Strava par jour de semaine réel, restreint
 * à la semaine calendaire en cours (voir isInCurrentCalendarWeek). */
export function groupActivitiesByDayThisWeek(activities) {
  const byDay = {};
  (activities || []).forEach((a) => {
    const dateStr = a.start_date_local || a.start_date;
    if (!isInCurrentCalendarWeek(dateStr)) return;
    const dayName = isoDateToDayName(dateStr);
    if (!dayName) return;
    if (!byDay[dayName]) byDay[dayName] = [];
    byDay[dayName].push(a);
  });
  return byDay;
}
