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
/**
 * Bornes basses (% de VMA, exprimées en vitesse) des 5 zones — mêmes seuils que le
 * référentiel utilisé côté prompt IA (voir lib/gemini.js:computeRunZones) pour que la
 * valeur par défaut affichée ici et celle utilisée pour générer les séances restent
 * cohérentes tant que l'athlète n'a rien édité manuellement.
 */
const PACE_PCTS = [0, 0.70, 0.80, 0.88, 0.95];

export function defaultHrZones(fcMax) {
  const max = Number(fcMax) > 0 ? Number(fcMax) : 190;
  return ZONE_META.map((z, i) => ({ ...z, min: Math.round(max * HR_PCTS[i]) }));
}

export function defaultPowerZones(thresholdWatts) {
  const base = Number(thresholdWatts) > 0 ? Number(thresholdWatts) : 200;
  return ZONE_META.map((z, i) => ({ ...z, min: Math.round(base * POWER_PCTS[i]) }));
}

/**
 * Zones d'allure course à pied par défaut, dérivées de la VMA — exprimées en VITESSE
 * (km/h), pas en allure, pour rester dans la même logique ascendante que defaultHrZones/
 * defaultPowerZones (plus la zone est élevée, plus la borne "min" est élevée). La
 * conversion vitesse → allure (m:ss/km) se fait uniquement à l'affichage/édition, voir
 * components/ZoneCharts.js. 100% éditables manuellement ensuite : une fois éditées, ces
 * zones sont envoyées telles quelles au coach IA (voir pages/index.js, lib/gemini.js) et
 * PRIMENT sur le calcul théorique depuis la VMA — c'est précisément ce qui permet de
 * corriger un écart entre l'allure théorique (% VMA) et l'allure réellement tenable par
 * l'athlète sur le terrain.
 */
export function defaultPaceZones(vma) {
  const speed = Number(vma) > 0 ? Number(vma) : 14;
  return ZONE_META.map((z, i) => ({ ...z, min: Math.round(speed * PACE_PCTS[i] * 100) / 100 }));
}

/**
 * Garde-fou (BUG RÉEL CORRIGÉ) : les zones d'allure course sont stockées en VITESSE
 * (km/h, voir defaultPaceZones ci-dessus) — une valeur plausible tient donc entre ~4
 * et ~25 km/h (jamais un BPM à 3 chiffres du type 117/140/160/174, signature d'un
 * ancien bug où ce champ avait été initialisé avec la formule des zones FC — % de FC
 * max — au lieu de celle des zones VMA). Sert à détecter et migrer silencieusement
 * toute donnée `tri_pace_zones` déjà en localStorage sur un appareil qui a connu ce
 * bug, avant qu'elle ne soit ré-affichée telle quelle (voir components/ZoneCharts.js).
 */
export function isPlausiblePaceZones(zones) {
  if (!Array.isArray(zones) || zones.length !== ZONE_META.length) return false;
  return zones.every((z) => Number.isFinite(Number(z?.min)) && Number(z.min) >= 0 && Number(z.min) <= 26);
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
    // 'pace' (allure course) : Strava fournit average_speed en m/s — converti en km/h pour
    // rester dans la même unité ascendante que les zones (voir defaultPaceZones ci-dessus).
    const value = metric === 'hr'
      ? act.average_heartrate
      : metric === 'pace'
        ? (Number.isFinite(act.average_speed) ? act.average_speed * 3.6 : null)
        : act.average_watts;
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
