// lib/analytics.js
//
// RÈGLE (identique à lib/physiology.js) : on ne calcule QUE à partir de données
// réellement présentes dans l'app — le plan actuel (semaines N / N+1, les deux
// seules conservées en mémoire), l'historique de ressenti (feedbackHistory, réel et
// daté) et l'historique santé (healthHistory, réel et daté). Pas de génération d'un
// faux historique de plusieurs semaines qui n'existe pas côté données.
import { classifyDiscipline, parseDurationMinutes } from './workouts';
import { vmaPercentForDistance } from './physiology';
import { defaultHrZones, defaultPowerZones, zoneForValue } from './zones';
import { stravaSportToDiscipline } from './stravaClient';

const DISCIPLINE_COLOR = { NATATION: '#22D3EE', CYCLISME: '#60A5FA', 'C.A.P': '#FB923C' };

/** Volume (en heures) par discipline, pour chaque semaine réellement en mémoire (N, N+1). */
export function computeWeeklyDurationByDiscipline(workouts) {
  const weekKeys = Object.keys(workouts || {}).filter((k) => Array.isArray(workouts[k]));
  // Ordre stable : N avant N+1 avant N+2...
  weekKeys.sort((a, b) => {
    const na = a === 'N' ? 0 : Number(String(a).replace('N+', '')) || 0;
    const nb = b === 'N' ? 0 : Number(String(b).replace('N+', '')) || 0;
    return na - nb;
  });

  const disciplines = ['NATATION', 'CYCLISME', 'C.A.P'];
  const series = Object.fromEntries(disciplines.map((d) => [d, []]));

  weekKeys.forEach((key) => {
    const totals = Object.fromEntries(disciplines.map((d) => [d, 0]));
    (workouts[key] || []).forEach((w) => {
      const disc = classifyDiscipline(w.type);
      if (disc && totals[disc] !== undefined) totals[disc] += parseDurationMinutes(w.duration);
    });
    disciplines.forEach((d) => series[d].push(Math.round((totals[d] / 60) * 10) / 10));
  });

  return {
    labels: weekKeys.map((k) => (k === 'N' ? 'Semaine en cours' : `Semaine ${k}`)),
    disciplines: disciplines.map((d) => ({ key: d, label: d === 'C.A.P' ? 'Course' : d === 'CYCLISME' ? 'Vélo' : 'Natation', color: DISCIPLINE_COLOR[d] })),
    series,
  };
}

const ZONE_META = [
  { zone: 'Z1', label: 'Récupération', color: '#6B7280' },
  { zone: 'Z2', label: 'Aérobie', color: '#34D399' },
  { zone: 'Z3', label: 'Tempo', color: '#FBBF24' },
  { zone: 'Z4', label: 'Seuil', color: '#FB923C' },
  { zone: 'Z5', label: 'VO2 Max', color: '#F87171' },
];

/**
 * Répartition du temps (minutes) par zone d'intensité pour une semaine donnée
 * (tableau de séances), déduite du champ `cardio` de chaque séance ("Z2",
 * "Z3-Z4", "< 55 bpm"...). Si une séance couvre 2 zones, son temps est réparti
 * à parts égales entre les zones concernées (on ne devine pas laquelle domine).
 */
export function computeZoneMinutes(weekWorkouts) {
  const minutesByZone = { Z1: 0, Z2: 0, Z3: 0, Z4: 0, Z5: 0 };
  (weekWorkouts || []).forEach((w) => {
    if (classifyDiscipline(w.type) === 'REPOS') return;
    const duration = parseDurationMinutes(w.duration);
    if (!duration) return;
    const match = String(w.cardio || '').match(/Z\s*([1-5])(?:\s*-\s*Z?\s*([1-5]))?/i);
    if (!match) {
      // Pas de zone identifiable (ex: "< 55 bpm" sur une séance de repos actif) :
      // on ne devine pas — cette séance n'est simplement pas comptée dans la
      // répartition plutôt que de lui affecter une zone arbitraire.
      return;
    }
    const z1 = Number(match[1]);
    const z2 = match[2] ? Number(match[2]) : z1;
    const [lo, hi] = z1 <= z2 ? [z1, z2] : [z2, z1];
    const span = hi - lo + 1;
    for (let z = lo; z <= hi; z += 1) {
      minutesByZone[`Z${z}`] += duration / span;
    }
  });

  const total = Object.values(minutesByZone).reduce((a, b) => a + b, 0);
  return ZONE_META.map((meta) => ({
    ...meta,
    minutes: Math.round(minutesByZone[meta.zone]),
    pct: total > 0 ? Math.round((minutesByZone[meta.zone] / total) * 100) : 0,
  }));
}

/**
 * Série "charge & forme ressenties" à partir de feedbackHistory (réel, daté,
 * rempli par l'athlète après chaque séance validée). C'est l'équivalent honnête
 * d'une charge d'entraînement : l'app n'a pas accès à un TSS/CTL/ATL calculé sur
 * données capteur (puissance/FC réelles), donc on affiche ce qu'on a vraiment —
 * la difficulté et la forme perçues, dans le temps.
 */
export function computeFeedbackTrendSeries(feedbackHistory) {
  const sorted = [...(feedbackHistory || [])]
    .filter((f) => f && f.timestamp)
    .sort((a, b) => a.timestamp - b.timestamp);
  return {
    labels: sorted.map((f) => new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short' }).format(new Date(f.timestamp))),
    difficulty: sorted.map((f) => f.difficulty ?? null),
    capacity: sorted.map((f) => f.capacity ?? null),
  };
}

function lastTwoValues(healthHistory, metricKey) {
  const points = (healthHistory || [])
    .filter((h) => h.metric === metricKey)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  const latest = points[points.length - 1]?.value ?? null;
  const previous = points[points.length - 2]?.value ?? null;
  return { latest, previous, delta: latest !== null && previous !== null ? Math.round((latest - previous) * 100) / 100 : null };
}

function formatPaceMinPerKm(kmh) {
  if (!kmh || kmh <= 0) return null;
  const minPerKm = 60 / kmh;
  const min = Math.floor(minPerKm);
  const sec = Math.round((minPerKm - min) * 60);
  return `${min}'${String(sec).padStart(2, '0')}"/km`;
}

/**
 * Métriques clés du profil + delta réel vs la mesure précédente (healthHistory).
 * VO2max et allure seuil sont des estimations dérivées d'une valeur réellement
 * mesurée (VMA) — même logique que lib/physiology.js — jamais inventées ex nihilo :
 * si la VMA n'est pas renseignée, ces deux lignes sont simplement omises.
 */
export function computeKeyMetrics(profile, healthHistory, sportType = 'triathlon') {
  const rows = [];

  if (sportType !== 'running' && profile.ftp) {
    const { delta } = lastTwoValues(healthHistory, 'ftp');
    rows.push({ label: 'FTP vélo', value: `${profile.ftp} W`, delta: delta ? `${delta > 0 ? '+' : ''}${delta} W` : null, positive: delta > 0 });
  }

  if (profile.vma) {
    const thresholdKmh = profile.vma * vmaPercentForDistance(10);
    const pace = formatPaceMinPerKm(thresholdKmh);
    const { delta } = lastTwoValues(healthHistory, 'vma');
    const deltaPace = delta ? formatPaceMinPerKm((profile.vma - delta) * vmaPercentForDistance(10)) : null;
    rows.push({
      label: 'Allure seuil course (estimée depuis la VMA)',
      value: pace,
      delta: delta && pace && deltaPace ? (thresholdKmh > (profile.vma - delta) * vmaPercentForDistance(10) ? 'plus rapide' : 'plus lent') : null,
      positive: delta > 0,
    });

    const vo2max = Math.round(profile.vma * 3.5 * 10) / 10;
    rows.push({
      label: 'VO2max estimé (depuis la VMA)',
      value: `${vo2max} mL/kg/min`,
      delta: delta ? `${delta > 0 ? '+' : ''}${Math.round(delta * 3.5 * 10) / 10}` : null,
      positive: delta > 0,
    });
  }

  if (sportType !== 'running' && profile.nat100) {
    rows.push({ label: 'Vitesse critique natation (déclarée)', value: `${profile.nat100} /100m`, delta: null });
  }

  if (profile.fcMax) {
    const { delta } = lastTwoValues(healthHistory, 'fcMax');
    rows.push({ label: 'FC maximale', value: `${profile.fcMax} bpm`, delta: delta ? `${delta > 0 ? '+' : ''}${delta} bpm` : 'stable', positive: delta < 0 });
  }

  if (profile.weight) {
    const { delta } = lastTwoValues(healthHistory, 'weight');
    rows.push({ label: 'Poids de forme', value: `${profile.weight} kg`, delta: delta ? `${delta > 0 ? '+' : ''}${delta} kg` : null, positive: delta < 0 });
  }

  return rows;
}

// ─────────────────────────────────────────────────────────────────────────
// CHARGE D'ENTRAÎNEMENT (CTL / ATL / TSB) — point 1 de la comparaison marché.
//
// Contrairement au commentaire ci-dessus sur computeFeedbackTrendSeries (écrit
// avant la synchronisation Strava), l'app a maintenant accès à des données
// RÉELLES par séance (FC moyenne / puissance moyenne / durée, table
// strava_activities) : on peut donc calculer un vrai indicateur de charge dans
// le temps, pas seulement le ressenti déclaré. On reste toutefois fidèles à la
// règle "jamais de valeur physio inventée" : la formule ci-dessous est un choix
// délibérément simple et documenté (pas un TSS propriétaire type TrainingPeaks),
// et toute séance sans FC/puissance moyenne exploitable est comptée à part
// (voir `estimatedCount`) plutôt que silencieusement mélangée aux vraies mesures.
const LOAD_ZONE_FACTOR = { Z1: 0.55, Z2: 0.7, Z3: 0.85, Z4: 1, Z5: 1.15 };
const CTL_WINDOW_DAYS = 42; // "Fitness" — moyenne glissante longue, standard du marché
const ATL_WINDOW_DAYS = 7; // "Fatigue" — moyenne glissante courte

function isoDayUTC(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function parseDayToUTCms(day) {
  const [y, m, d] = String(day).split('-').map(Number);
  if (!y || !m || !d) return null;
  return Date.UTC(y, m - 1, d);
}

/**
 * Zone d'intensité (Z1-Z5) d'une activité Strava, déduite de sa FC moyenne ou
 * de sa puissance moyenne (vélo), avec les mêmes bornes que components/ZoneCharts.js
 * (defaultHrZones/defaultPowerZones) — cohérence avec ce que l'athlète voit déjà
 * ailleurs dans l'app. Puissance utilisée en priorité pour le vélo (mesure directe
 * de l'effort), FC en repli pour toutes les disciplines. Retourne null si aucune
 * des deux n'est exploitable (séance sans capteur associé).
 */
function activityIntensityZone(act, profile) {
  const discipline = stravaSportToDiscipline(act.sport_type || act.type);
  if (discipline === 'CYCLISME' && Number(profile?.ftp) > 0 && Number.isFinite(act.average_watts) && act.average_watts > 0) {
    const z = zoneForValue(defaultPowerZones(profile.ftp), act.average_watts);
    if (z) return z.zone;
  }
  if (Number(profile?.fcMax) > 0 && Number.isFinite(act.average_heartrate) && act.average_heartrate > 0) {
    const z = zoneForValue(defaultHrZones(profile.fcMax), act.average_heartrate);
    if (z) return z.zone;
  }
  return null;
}

/**
 * Charge d'une activité = durée (min) × facteur de la zone d'intensité atteinte.
 * Si aucune zone n'est déterminable (pas de FC/puissance moyenne sur cette séance),
 * on retombe sur le facteur Z2 (zone la plus fréquente en volume chez un triathlète)
 * à titre d'estimation par défaut — jamais silencieuse : `estimated: true` le signale.
 */
export function computeActivityLoad(act, profile) {
  const durationMin = (act?.moving_time_s || 0) / 60;
  if (durationMin <= 0) return { load: 0, zone: null, estimated: false };
  const zone = activityIntensityZone(act, profile);
  if (zone) return { load: Math.round(durationMin * LOAD_ZONE_FACTOR[zone]), zone, estimated: false };
  return { load: Math.round(durationMin * LOAD_ZONE_FACTOR.Z2), zone: null, estimated: true };
}

/**
 * Série CTL (Fitness, moy. glissante 42j) / ATL (Fatigue, moy. glissante 7j) /
 * TSB (Forme = CTL − ATL) jour par jour, calculée UNIQUEMENT sur les activités
 * Strava réellement synchronisées (`activities`) — aucun jour sans activité
 * n'est inventé avec une charge fictive, il compte simplement pour 0.
 *
 * Moyennes glissantes calculées par lissage exponentiel (méthode standard
 * TrainingPeaks/Coggan : alpha = 1 − e^(−1/N)), pas une moyenne simple, pour
 * qu'une séance récente pèse plus qu'une séance ancienne dans chaque indicateur.
 */
export function computeTrainingLoadSeries(activities, profile) {
  const empty = { labels: [], ctl: [], atl: [], tsb: [], current: null, spanDays: 0, estimatedCount: 0, totalCount: 0 };
  const dated = (activities || [])
    .map((act) => ({ act, dayMs: parseDayToUTCms((act.start_date_local || act.start_date || '').slice(0, 10)) }))
    .filter((d) => d.dayMs !== null);
  if (dated.length === 0) return empty;

  const loadByDay = {};
  let estimatedCount = 0;
  dated.forEach(({ act, dayMs }) => {
    const { load, estimated } = computeActivityLoad(act, profile);
    const key = isoDayUTC(dayMs);
    loadByDay[key] = (loadByDay[key] || 0) + load;
    if (estimated) estimatedCount += 1;
  });

  const dayKeys = Object.keys(loadByDay).sort();
  const firstMs = parseDayToUTCms(dayKeys[0]);
  const lastMs = parseDayToUTCms(dayKeys[dayKeys.length - 1]);
  const DAY_MS = 24 * 60 * 60 * 1000;
  const allDayKeys = [];
  for (let ms = firstMs; ms <= lastMs; ms += DAY_MS) allDayKeys.push(isoDayUTC(ms));

  const ctlAlpha = 1 - Math.exp(-1 / CTL_WINDOW_DAYS);
  const atlAlpha = 1 - Math.exp(-1 / ATL_WINDOW_DAYS);
  let ctl = 0;
  let atl = 0;
  const ctlSeries = [];
  const atlSeries = [];
  const tsbSeries = [];
  allDayKeys.forEach((key) => {
    const load = loadByDay[key] || 0;
    ctl += (load - ctl) * ctlAlpha;
    atl += (load - atl) * atlAlpha;
    ctlSeries.push(Math.round(ctl * 10) / 10);
    atlSeries.push(Math.round(atl * 10) / 10);
    tsbSeries.push(Math.round((ctl - atl) * 10) / 10);
  });

  return {
    labels: allDayKeys.map((key) => new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', timeZone: 'UTC' }).format(new Date(`${key}T00:00:00Z`))),
    ctl: ctlSeries,
    atl: atlSeries,
    tsb: tsbSeries,
    current: { ctl: ctlSeries[ctlSeries.length - 1], atl: atlSeries[atlSeries.length - 1], tsb: tsbSeries[tsbSeries.length - 1] },
    spanDays: allDayKeys.length,
    estimatedCount,
    totalCount: dated.length,
  };
}

/**
 * Lecture qualitative du TSB courant, pour affichage direct (badge) sans dupliquer
 * les seuils partout. Seuils indicatifs classiques (pas une garantie médicale) :
 * TSB très négatif = fatigue accumulée, TSB très positif et prolongé = désentraînement possible.
 */
export function describeTsb(tsb) {
  if (tsb === null || tsb === undefined || Number.isNaN(tsb)) return null;
  if (tsb <= -20) return { label: 'Fatigue marquée', color: '#F87171' };
  if (tsb < -10) return { label: 'Charge en cours', color: '#FBBF24' };
  if (tsb <= 5) return { label: 'Équilibré', color: '#34D399' };
  if (tsb <= 20) return { label: 'Frais', color: '#22D3EE' };
  return { label: 'Très frais / désentraînement possible', color: '#FBBF24' };
}
