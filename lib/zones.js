// lib/zones.js
// Zones d'intensité (FC & Puissance), séparément pour vélo et course à pied.
// Réutilise la même taxonomie Z1-Z5 déjà utilisée ailleurs dans l'app (voir
// lib/analytics.js:computeZoneMinutes, workouts.js:effortZone) pour rester cohérent.
// Les bornes par défaut sont calculées depuis le profil (FC max / FTP) mais restent
// 100% éditables manuellement — voir components/ZoneCharts.js.

export const ZONE_META = [
  { zone: 'Z1', label: 'Récupération', color: '#6B7280' },
  { zone: 'Z2', label: 'Aérobie', color: '#34D399' },
  { zone: 'Z3', label: 'Tempo', color: '#FBBF24' },
  { zone: 'Z4', label: 'Seuil', color: '#FB923C' },
  { zone: 'Z5', label: 'VO2 Max', color: '#F87171' },
];

// Types Strava regroupés par discipline (voir stravaSportToDiscipline dans stravaClient.js
// pour la logique équivalente utilisée ailleurs dans l'app).
export const BIKE_SPORTS = ['Ride', 'VirtualRide', 'GravelRide', 'MountainBikeRide', 'EBikeRide', 'Handcycle'];
export const RUN_SPORTS = ['Run', 'VirtualRun', 'TrailRun'];

/** Bornes basses (% de FC max) des 5 zones — modèle classique 5 zones. */
const HR_PCTS = [0, 0.6, 0.72, 0.82, 0.89];
/** Bornes basses (% de FTP / puissance de seuil) des 5 zones. */
const POWER_PCTS = [0, 0.56, 0.76, 0.91, 1.06];

export function defaultHrZones(fcMax) {
  const max = Number(fcMax) > 0 ? Number(fcMax) : 190;
  return ZONE_META.map((z, i) => ({ ...z, min: Math.round(max * HR_PCTS[i]) }));
}

export function defaultPowerZones(thresholdWatts) {
  const base = Number(thresholdWatts) > 0 ? Number(thresholdWatts) : 200;
  return ZONE_META.map((z, i) => ({ ...z, min: Math.round(base * POWER_PCTS[i]) }));
}

/** Retourne la zone (parmi `zones`, triées par min croissant) contenant `value`. */
export function zoneForValue(zones, value) {
  if (!Number.isFinite(value) || !zones?.length) return null;
  let found = zones[0];
  for (const z of zones) {
    if (value >= z.min) found = z;
    else break;
  }
  return found;
}

/**
 * Répartition du temps par zone, calculée à partir des activités Strava synchronisées.
 * Approximation assumée : on ne dispose ici que des moyennes par séance
 * (average_heartrate / average_watts, déjà en cache côté client), pas des courbes
 * seconde-par-seconde (celles-ci ne sont chargées qu'à la demande, voir
 * pages/api/strava/streams.js, pour ménager le quota Strava). Chaque séance est donc
 * classée dans UNE zone (celle de sa moyenne) et sa durée totale y est comptée — une
 * distribution correcte à l'échelle de plusieurs semaines, moins précise qu'un vrai
 * calcul seconde-par-seconde sur un effort qui varie beaucoup au sein d'une même sortie.
 */
export function computeZoneDistributionFromActivities(activities, zones, { metric, sports }) {
  const safeZones = zones && zones.length ? zones : ZONE_META.map((z) => ({ ...z, min: 0 }));
  const minutesByZone = Object.fromEntries(safeZones.map((z) => [z.zone, 0]));
  let countedActivities = 0;

  for (const act of activities || []) {
    if (!sports.includes(act.sport_type)) continue;
    const value = metric === 'hr' ? act.average_heartrate : act.average_watts;
    if (!Number.isFinite(value) || value <= 0) continue;
    const z = zoneForValue(safeZones, value);
    if (!z) continue;
    minutesByZone[z.zone] += (act.moving_time_s || 0) / 60;
    countedActivities += 1;
  }

  const total = Object.values(minutesByZone).reduce((a, b) => a + b, 0);
  return {
    countedActivities,
    totalMinutes: Math.round(total),
    zones: safeZones.map((z) => ({
      ...z,
      minutes: Math.round(minutesByZone[z.zone]),
      pct: total > 0 ? Math.round((minutesByZone[z.zone] / total) * 100) : 0,
    })),
  };
}
