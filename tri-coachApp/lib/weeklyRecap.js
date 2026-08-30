// lib/weeklyRecap.js
//
// Calcule la fenêtre "semaine calendaire en cours" dans le fuseau Europe/Paris
// (lundi 00:00 → maintenant) et construit le texte de la notification "Récap
// de la semaine" à partir des VRAIES activités Strava importées (table
// strava_activities), pas d'une estimation — cohérent avec la règle "toujours
// vérifier les chiffres Strava avant de les afficher" appliquée dans tout le reste
// de l'app.
//
// Utilisé uniquement CÔTÉ SERVEUR (pages/api/notifications/weekly-recap.js), qui
// tourne en UTC sur Vercel : toutes les fonctions ci-dessous convertissent donc
// explicitement vers/depuis Europe/Paris au lieu de supposer le fuseau du serveur.
import { stravaSportToDiscipline } from './stravaClient';

/** Décalage Paris ↔ UTC (en minutes) au moment `date` donné — 60 en hiver (CET),
 * 120 en été (CEST). Calculé via Intl (fiable face au changement d'heure),
 * jamais codé en dur. */
export function getParisOffsetMinutes(date = new Date()) {
  const part = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Paris',
    timeZoneName: 'shortOffset',
  })
    .formatToParts(date)
    .find((p) => p.type === 'timeZoneName')?.value; // ex: "GMT+1" / "GMT+2"
  const match = /GMT([+-]\d+)(?::(\d+))?/.exec(part || '');
  if (!match) return 60; // repli raisonnable (CET) si l'environnement ne supporte pas shortOffset
  const hours = parseInt(match[1], 10);
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  return hours * 60 + (hours < 0 ? -minutes : minutes);
}

/** Heure locale Paris (0-23) au moment `date` — utilisé par le cron pour ne
 * déclencher l'envoi qu'à 19h heure de Paris, quel que soit l'horaire UTC
 * auquel Vercel a réellement invoqué la fonction (voir vercel.json : deux
 * horaires UTC couvrent hiver/été, un seul des deux correspond à 19h Paris). */
export function getParisLocalHour(date = new Date()) {
  return Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Paris',
      hour: '2-digit',
      hour12: false,
    }).format(date)
  );
}

/** Date du jour (YYYY-MM-DD) à Paris — utilisé comme clé de dédoublonnage
 * (weekly_recap_log) pour ne jamais envoyer deux fois le récap de la même
 * semaine si les deux horaires cron de vercel.json tombaient à 19h Paris. */
export function getParisDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * Instant UTC correspondant à lundi 00:00:00 (heure de Paris) de la semaine
 * calendaire contenant `now`. Principe : on "décale" `now` de l'offset Paris
 * courant pour obtenir un Date dont les getters UTC lisent directement l'heure
 * locale de Paris (astuce classique, sans dépendance externe type date-fns-tz),
 * on descend au lundi 00:00 dans ce référentiel décalé, puis on annule le
 * décalage pour revenir à un vrai instant UTC.
 * Limite connue et acceptée : à cheval EXACTEMENT sur le week-end du changement
 * d'heure (dernier dimanche de mars/octobre), l'offset utilisé est celui de
 * `now` et non celui, potentiellement différent, du lundi précédent — écart
 * d'au plus 1h sur la borne de la semaine, sans impact pratique sur un récap
 * hebdomadaire.
 */
export function getCurrentParisWeekStartUTC(now = new Date()) {
  const offsetMin = getParisOffsetMinutes(now);
  const shifted = new Date(now.getTime() + offsetMin * 60000);
  const parisDow = shifted.getUTCDay(); // 0=dimanche...6=samedi, dans le référentiel décalé
  const daysSinceMonday = (parisDow + 6) % 7;
  const mondayShifted = new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate() - daysSinceMonday, 0, 0, 0)
  );
  return new Date(mondayShifted.getTime() - offsetMin * 60000);
}

const DISCIPLINE_ORDER = ['NATATION', 'CYCLISME', 'C.A.P', 'AUTRE'];

const DISCIPLINE_ICONS = { NATATION: '🏊', CYCLISME: '🚴', 'C.A.P': '🏃', AUTRE: '⚡' };

const DISCIPLINE_LABELS = {
  fr: { NATATION: 'Natation', CYCLISME: 'Vélo', 'C.A.P': 'Course', AUTRE: 'Autre' },
  en: { NATATION: 'Swim', CYCLISME: 'Bike', 'C.A.P': 'Run', AUTRE: 'Other' },
  es: { NATATION: 'Natación', CYCLISME: 'Bici', 'C.A.P': 'Carrera', AUTRE: 'Otro' },
};

const STRINGS = {
  fr: {
    title: '📊 Ton récap de la semaine',
    empty: 'Aucune séance importée depuis Strava cette semaine — repos complet, ou pense à synchroniser.',
    plannedProgress: (done, planned) => `${done}/${planned} séance${planned > 1 ? 's' : ''} prévue${planned > 1 ? 's' : ''}`,
    totalDuration: (label) => `${label} au total`,
  },
  en: {
    title: '📊 Your weekly recap',
    empty: 'No session imported from Strava this week — full rest, or remember to sync.',
    plannedProgress: (done, planned) => `${done}/${planned} planned session${planned > 1 ? 's' : ''}`,
    totalDuration: (label) => `${label} total`,
  },
  es: {
    title: '📊 Tu resumen semanal',
    empty: 'Ninguna sesión importada de Strava esta semana — descanso total, o recuerda sincronizar.',
    plannedProgress: (done, planned) => `${done}/${planned} sesión${planned > 1 ? 'es' : ''} prevista${planned > 1 ? 's' : ''}`,
    totalDuration: (label) => `${label} en total`,
  },
};

function formatDurationLabel(totalSeconds) {
  const totalMinutes = Math.round((totalSeconds || 0) / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}`;
  return `${m} min`;
}

/**
 * Construit { title, body } pour la notification, à partir des lignes
 * strava_activities (Supabase) de la semaine et du nombre de séances prévues
 * dans workouts.N (voir lib/athleteContext.js:loadAthleteContext).
 */
export function buildWeeklyRecap({ activities = [], plannedCount = 0, lang = 'fr' }) {
  const strings = STRINGS[lang] || STRINGS.fr;
  const labels = DISCIPLINE_LABELS[lang] || DISCIPLINE_LABELS.fr;

  if (!activities.length) {
    return { title: strings.title, body: strings.empty };
  }

  const byDiscipline = {};
  let totalDurationS = 0;
  activities.forEach((a) => {
    const discipline = stravaSportToDiscipline(a.sport_type) || 'AUTRE';
    if (!byDiscipline[discipline]) byDiscipline[discipline] = { count: 0, distanceM: 0, durationS: 0 };
    byDiscipline[discipline].count += 1;
    byDiscipline[discipline].distanceM += Number(a.distance_m || 0);
    byDiscipline[discipline].durationS += Number(a.moving_time_s || 0);
    totalDurationS += Number(a.moving_time_s || 0);
  });

  const disciplineParts = DISCIPLINE_ORDER.filter((k) => byDiscipline[k]?.count).map((k) => {
    const { count, distanceM, durationS } = byDiscipline[k];
    const metric = distanceM > 0 ? `${(distanceM / 1000).toFixed(1)} km` : formatDurationLabel(durationS);
    return `${DISCIPLINE_ICONS[k]} ${labels[k]} ${count}× ${metric}`;
  });

  const segments = [];
  if (plannedCount > 0) segments.push(strings.plannedProgress(activities.length, plannedCount));
  segments.push(strings.totalDuration(formatDurationLabel(totalDurationS)));
  segments.push(disciplineParts.join(' · '));

  return { title: strings.title, body: segments.filter(Boolean).join(' — ') };
}
