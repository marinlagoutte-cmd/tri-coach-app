// lib/zones.js
// Zones d'intensité (FC & Puissance), séparément pour vélo et course à pied.
// Réutilise la même taxonomie Z1-Z5 déjà utilisée ailleurs dans l'app (voir
// lib/analytics.js:computeZoneMinutes, workouts.js:effortZone) pour rester cohérent.
// Les bornes par défaut sont calculées depuis le profil (FC max / FTP) mais restent
// 100% éditables manuellement — voir components/ZoneCharts.js.
//
// Depuis l'ajout du réglage Réglages > "Zones d'entraînement" (voir lib/zonesMode.js),
// ces bornes peuvent aussi être calculées AUTOMATIQUEMENT depuis les vraies séances
// Strava synchronisées plutôt que depuis FC max/FTP/VMA saisis à la main — voir
// estimateZonesFromActivities plus bas, qui reste soumis à la même règle que
// lib/physiology.js : jamais de valeur inventée, seulement dérivée d'un effort
// réellement enregistré, sinon `null` explicite.

import { vmaPercentForDistance } from './physiology';

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
export { PACE_PCTS };

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

/**
 * Garde-fou (BUG RÉEL CORRIGÉ) : les zones FC sont en BPM — une valeur plausible tient
 * entre 0 et ~230 bpm (large marge au-dessus du max humain théorique le plus élevé
 * jamais mesuré, pour ne jamais rejeter une vraie FC max atypique). Détecté ici : des
 * zones `tri_hr_zones`/`tri_hr_zones_bike` déjà en localStorage sur cet appareil avec
 * des bornes à 3 chiffres façon 202/274/328/382 — exactement la forme de
 * defaultPowerZones(base) (POWER_PCTS appliqués à un seuil de puissance) au lieu de
 * defaultHrZones (HR_PCTS appliqués à une FC max) : signature d'un ancien bug où les
 * deux jeux de zones (FC et Puissance) avaient fini par partager la même valeur
 * enregistrée. Même logique que isPlausiblePaceZones ci-dessus : on ignore une valeur
 * stockée qui échoue ce test plutôt que de la réafficher indéfiniment comme si
 * c'était une vraie FC (voir components/ZoneCharts.js).
 */
export function isPlausibleHrZones(zones) {
  if (!Array.isArray(zones) || zones.length !== ZONE_META.length) return false;
  return zones.every((z) => Number.isFinite(Number(z?.min)) && Number(z.min) >= 0 && Number(z.min) <= 230);
}

/**
 * Garde-fou symétrique pour les zones de Puissance (watts) — plafond très large
 * (3000 W, largement au-dessus de tout effort humain réel) qui ne sert qu'à détecter
 * l'inverse du bug ci-dessus (une FC en BPM — donc ≤ 230 — enregistrée par erreur sous
 * une clé `tri_power_zones*`, ce qui passerait ce test de vraisemblance FC mais reste
 * un chiffre absurde comme seuil de puissance). Volontairement permissif : contrairement
 * à la FC, il n'existe pas de plafond physiologique universel bas pour la puissance
 * (un sprint ou une poussée vélo peut dépasser 1000 W), donc ce garde-fou ne rejette que
 * l'aberrant, jamais une vraie valeur élevée mais plausible.
 */
export function isPlausiblePowerZones(zones) {
  if (!Array.isArray(zones) || zones.length !== ZONE_META.length) return false;
  return zones.every((z) => Number.isFinite(Number(z?.min)) && Number(z.min) >= 0 && Number(z.min) <= 3000);
}

/**
 * Détermine les zones à afficher AVANT toute validation manuelle par l'athlète
 * (mode 'manual', rien encore enregistré sous la clé localStorage correspondante —
 * voir lib/storage.js:hasStoredValue) : jamais un chiffre choisi au hasard, mais
 * un ordre de priorité à trois niveaux, du plus fiable au plus générique :
 *   1. le seuil physiologique DÉCLARÉ dans le profil (FC max/FTP/VMA saisis par
 *      l'athlète, au wizard ou dans cet onglet) — source la plus explicite ;
 *   2. à défaut, le seuil ESTIMÉ depuis une VRAIE séance Strava synchronisée
 *      (protocole "test de 20 minutes", voir estimateZonesFromActivities plus
 *      bas) — déjà utilisé par le mode 'auto', réutilisé ici comme germe initial
 *      éditable plutôt que réservé à ce seul mode ;
 *   3. seulement si ni l'un ni l'autre n'existe, une valeur générique plausible
 *      (mêmes replis que defaultHrZones/defaultPowerZones/defaultPaceZones —
 *      190 bpm / 200 W / 14 km/h) — assumée comme telle (voir `source` renvoyé)
 *      plutôt que présentée comme une vraie mesure.
 * Renvoie `{ zones, source }` avec `source` parmi 'profile' | 'strava' | 'generic',
 * pour que l'UI (ZoneCharts.js) puisse indiquer à l'athlète d'où vient la valeur
 * tant qu'il ne l'a pas lui-même validée.
 */
export function resolveSeedZones(profileValue, defaultZonesFn, estimatedZones) {
  if (Number(profileValue) > 0) return { zones: defaultZonesFn(profileValue), source: 'profile' };
  if (estimatedZones) return { zones: estimatedZones, source: 'strava' };
  return { zones: defaultZonesFn(undefined), source: 'generic' };
}

/**
 * Retourne la zone (parmi `zones`, triées par min croissant) contenant `value`.
 * Depuis l'ajout de la borne haute indépendante par zone (voir components/ZoneCharts.js
 * et findZoneOverlaps ci-dessous), une zone peut porter un `max` explicite — auquel cas
 * on s'arrête dès qu'on trouve la zone dont [min, max) contient réellement `value`,
 * plutôt que de continuer à avancer sur le seul `min` (comportement historique, toujours
 * utilisé tel quel pour les zones sans `max` explicite — ex: zones "Auto" ou germe
 * resolveSeedZones, où seule `min` existe).
 */
export function zoneForValue(zones, value) {
  if (!Number.isFinite(value) || !zones?.length) return null;
  let found = zones[0];
  for (const z of zones) {
    if (value < z.min) break;
    found = z;
    if (Number.isFinite(z.max) && value < z.max) break;
  }
  return found;
}

/**
 * Vérification déterministe (aucun appel IA) des bornes d'un jeu de zones AVANT
 * validation — demande explicite de l'athlète : la borne haute de chaque zone est
 * maintenant éditable indépendamment de la borne basse de la zone suivante (voir
 * components/ZoneCharts.js), donc un chevauchement (ex: Z2 haute à 150 mais Z3 basse à
 * 140) devient possible et doit être détecté avant tout enregistrement. Ne dépend que
 * de `min` (toujours requis) et `max` (optionnel : si absent sur une zone, on considère
 * qu'elle "s'arrête" exactement là où commence la zone suivante — donc jamais de faux
 * chevauchement détecté sur une zone que l'athlète n'a pas touchée). Renvoie un tableau
 * de messages d'erreur (vide = aucun problème).
 */
export function findZoneOverlaps(zones) {
  const issues = [];
  if (!Array.isArray(zones)) return issues;
  for (let i = 0; i < zones.length; i += 1) {
    const z = zones[i];
    const next = zones[i + 1];
    const effectiveMax = Number.isFinite(z.max) ? z.max : (next ? next.min : Infinity);
    if (!(effectiveMax > z.min)) {
      issues.push(`${z.zone} : la borne haute doit être strictement supérieure à la borne basse.`);
      continue;
    }
    if (next && effectiveMax > next.min) {
      issues.push(`${z.zone} et ${next.zone} se chevauchent.`);
    }
  }
  return issues;
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
    // 'pace' (allure course) : Strava fournit average_speed_ms en m/s (voir la colonne
    // `average_speed_ms` de supabase-schema-strava.sql — c'est le nom du champ tel que
    // stocké/relu depuis Supabase, PAS `average_speed`) — converti en km/h pour rester
    // dans la même unité ascendante que les zones (voir defaultPaceZones ci-dessus).
    // BUG RÉEL CORRIGÉ : ce code lisait `act.average_speed`, un champ qui n'existe pas
    // sur les activités telles que rechargées depuis Supabase (toujours `undefined`) —
    // la répartition par zone d'Allure restait donc systématiquement vide ("Pas assez
    // d'activités... pour calculer une répartition allure"), même avec des dizaines de
    // sorties course synchronisées avec capteur de vitesse/GPS.
    const value = metric === 'hr'
      ? act.average_heartrate
      : metric === 'pace'
        ? (Number.isFinite(act.average_speed_ms) ? act.average_speed_ms * 3.6 : null)
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

// ---------------------------------------------------------------------------------
// Calcul AUTOMATIQUE des seuils physiologiques (FC seuil, FTP, VMA) depuis les VRAIES
// séances Strava synchronisées — utilisé quand Réglages > "Zones d'entraînement" est
// sur "Automatique" (voir lib/zonesMode.js et components/ZoneCharts.js).
//
// Méthode retenue : le "test de 20 minutes", protocole le plus standard et le plus
// documenté en coaching FC/puissance (popularisé par Coggan/TrainingPeaks pour la
// puissance, transposable tel quel à la FC) : on ne dispose pas ici d'un vrai test
// protocolaire, mais on peut s'en approcher avec les séances déjà enregistrées — parmi
// celles dont la durée se situe dans la fenêtre plausible d'un effort quasi-seuil
// (entre THRESHOLD_TEST_MIN_MINUTES et THRESHOLD_TEST_MAX_MINUTES), on retient la
// MEILLEURE (watts ou bpm moyens les plus élevés) et on applique le facteur standard
// du protocole (~95% de la moyenne de l'effort) pour redescendre au seuil réel — un
// effort "à bloc" de 20-60 minutes se tient légèrement au-dessus du seuil réel.
//
// Comme lib/physiology.js (voir sa règle "ne jamais inventer de valeur physiologique"
// en en-tête de ce fichier-là) : si aucune séance ne correspond au protocole, on
// renvoie `null` pour ce seuil plutôt que d'extrapoler — jamais de conversion croisée
// FC <-> puissance non plus (pas de sens physiologique généralisable d'un athlète à
// l'autre).
const THRESHOLD_TEST_FACTOR = 0.95;
const THRESHOLD_TEST_MIN_MINUTES = 18;
const THRESHOLD_TEST_MAX_MINUTES = 70;

function qualifyingEfforts(activities, sports) {
  return (activities || []).filter((act) => {
    if (!sports.includes(act.sport_type)) return false;
    const minutes = (act.moving_time_s || 0) / 60;
    return minutes >= THRESHOLD_TEST_MIN_MINUTES && minutes <= THRESHOLD_TEST_MAX_MINUTES;
  });
}

/** Meilleure puissance de seuil (FTP) détectée parmi les séances réelles, ou `null`. */
export function estimateThresholdPowerFromActivities(activities, sports) {
  const efforts = qualifyingEfforts(activities, sports).filter(
    (a) => Number.isFinite(a.average_watts) && a.average_watts > 0
  );
  if (!efforts.length) return null;
  const best = efforts.reduce((max, a) => (a.average_watts > max.average_watts ? a : max));
  return {
    value: Math.round(best.average_watts * THRESHOLD_TEST_FACTOR),
    basedOn: {
      activityId: best.id,
      date: best.start_date,
      averageWatts: Math.round(best.average_watts),
      durationMin: Math.round(best.moving_time_s / 60),
    },
  };
}

/** Meilleure FC de seuil (LTHR) détectée parmi les séances réelles, ou `null`. */
export function estimateThresholdHrFromActivities(activities, sports) {
  const efforts = qualifyingEfforts(activities, sports).filter(
    (a) => Number.isFinite(a.average_heartrate) && a.average_heartrate > 0
  );
  if (!efforts.length) return null;
  const best = efforts.reduce((max, a) => (a.average_heartrate > max.average_heartrate ? a : max));
  return {
    value: Math.round(best.average_heartrate * THRESHOLD_TEST_FACTOR),
    basedOn: {
      activityId: best.id,
      date: best.start_date,
      averageHr: Math.round(best.average_heartrate),
      durationMin: Math.round(best.moving_time_s / 60),
    },
  };
}

/**
 * VMA estimée depuis la meilleure sortie course réelle dans la fenêtre 18-70min —
 * réutilise EXACTEMENT le même modèle distance -> %VMA que lib/physiology.js
 * (vmaPercentForDistance, déjà utilisé pour dériver la VMA d'un chrono saisi
 * manuellement au wizard), pour que "VMA depuis un chrono" et "VMA depuis Strava"
 * restent cohérentes entre elles plutôt que d'inventer un second modèle.
 */
export function estimateVmaFromActivities(activities, sports) {
  const efforts = qualifyingEfforts(activities, sports).filter(
    (a) => Number.isFinite(a.average_speed_ms) && a.average_speed_ms > 0 && Number.isFinite(a.distance_m) && a.distance_m > 0
  );
  if (!efforts.length) return null;
  const best = efforts.reduce((max, a) => (a.average_speed_ms > max.average_speed_ms ? a : max));
  const distanceKm = best.distance_m / 1000;
  const avgSpeedKmh = best.average_speed_ms * 3.6;
  const pct = vmaPercentForDistance(distanceKm);
  return {
    value: Math.round((avgSpeedKmh / pct) * 10) / 10,
    basedOn: {
      activityId: best.id,
      date: best.start_date,
      distanceKm: Math.round(distanceKm * 10) / 10,
      durationMin: Math.round(best.moving_time_s / 60),
    },
  };
}

/**
 * Point d'entrée unique pour ZoneCharts.js en mode "Automatique" : calcule les trois
 * jeux de zones (FC/Puissance/Allure — Allure uniquement pour la course) pour UNE
 * discipline ('run' | 'bike'), directement utilisables par defaultHrZones/
 * defaultPowerZones/defaultPaceZones. Chaque jeu de zones est `null` si aucune séance
 * qualifiante n'a été trouvée (voir `meta` pour distinguer "pas encore de donnée" de
 * "donnée disponible" côté affichage).
 */
export function estimateZonesFromActivities(activities, discipline) {
  const sports = discipline === 'bike' ? BIKE_SPORTS : RUN_SPORTS;
  const powerEst = estimateThresholdPowerFromActivities(activities, sports);
  const hrEst = estimateThresholdHrFromActivities(activities, sports);
  const vmaEst = discipline === 'run' ? estimateVmaFromActivities(activities, sports) : null;
  return {
    hrZones: hrEst ? defaultHrZones(hrEst.value) : null,
    powerZones: powerEst ? defaultPowerZones(powerEst.value) : null,
    paceZones: vmaEst ? defaultPaceZones(vmaEst.value) : null,
    meta: { powerEst, hrEst, vmaEst },
  };
}
