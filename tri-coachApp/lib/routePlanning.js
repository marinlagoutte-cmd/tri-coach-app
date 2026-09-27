// lib/routePlanning.js
//
// Score des parcours vélo candidats (générés par lib/routing.js) sur deux critères
// indépendants, chacun 100% déterministe (aucune IA n'intervient dans le calcul lui-même —
// voir lib/coGeneration.js:coPickRoute pour le rôle de l'IA, purement narratif/arbitrage) :
//
//   1. VENT — même méthodologie que le calcul déjà affiché à l'athlète pour un parcours
//      GPX importé (voir components/WeatherRadarMap.js:computeRouteWind) : on échantillonne
//      le tracé, on interroge le vent horaire (lib/windMap.js, Open-Meteo) au moment estimé
//      de passage sur chaque tronçon, on classe chaque tronçon vent de dos/face/travers
//      (lib/windMap.js:classifyWindImpact) et on cumule les distances par catégorie.
//      SCORE RETENU : distTailKm - distHeadKm (km "nets" favorables) — c'est exactement le
//      double objectif demandé par l'athlète ("optimiser le vent de dos ET/OU minimiser le
//      vent de face"), qui converge naturellement vers un seul chiffre à maximiser.
//
//   2. POPULARITÉ — combine DEUX sources (demande explicite : "si tu as d'autre idée
//      combine") car ni l'une ni l'autre ne couvre tout, à elle seule :
//      a) Segments Strava (lib/strava.js:exploreSegments/fetchSegmentDetail) — signal
//         RÉEL de fréquentation par des cyclistes (effort_count = nombre de fois où le
//         segment a été parcouru), mais couverture inégale (surtout des segments "chrono",
//         cols/portions rapides — un segment existe parce que des gens veulent se
//         chronométrer dessus, pas nécessairement parce que c'est une route agréable/sûre).
//      b) Réseau cyclable officiel OSM (lib/osmCycleRoutes.js, Overpass — gratuit, sans
//         clé) — routes/voies signalées comme itinéraires cyclables reconnus (véloroutes
//         nationales/régionales/locales), un signal de qualité/sécurité complémentaire que
//         Strava ne capture pas (une route peut être un itinéraire cyclable officiel très
//         agréable sans qu'aucun segment Strava n'y soit posé).
//      Les deux sont normalisés indépendamment puis moyennés à poids égal.

import { sampleRoute } from './gpx';
import { fetchWindForPoints, classifyWindImpact, nearestHourIndex } from './windMap';
import { haversineKm } from './geo';

/**
 * Calcule l'impact vent d'un tracé — reprend exactement la logique de
 * components/WeatherRadarMap.js:computeRouteWind (mêmes seuils, même méthode
 * d'échantillonnage) pour que le récap "vent" d'un parcours généré ici soit directement
 * comparable à celui affiché pour un GPX importé dans l'onglet Météo.
 * @param {Array<{lat:number, lon:number, distKm:number}>} points tracé complet (dense)
 * @param {number} avgSpeedKmh vitesse moyenne estimée (pour convertir distance -> heure de passage)
 * @param {Date} departureDate heure de départ estimée
 * @returns {Promise<{distTailKm:number, distHeadKm:number, distCrossKm:number, netScore:number, samples:Array}>}
 */
export async function scoreRouteWind(points, avgSpeedKmh, departureDate) {
  if (!points?.length) return { distTailKm: 0, distHeadKm: 0, distCrossKm: 0, netScore: 0, samples: [] };

  const totalDistanceKm = points[points.length - 1].distKm;
  // Même règle d'échantillonnage que WeatherRadarMap (~35 flèches sur tout le tracé, jamais
  // moins d'une tous les 300m) : assez dense pour ne pas rater un changement de cap notable
  // sans multiplier inutilement les appels à l'API vent (déjà groupés par lots de 40 points,
  // voir lib/windMap.js:fetchWindForPoints).
  const stepKm = Math.max(0.3, totalDistanceKm / 35);
  const samples = sampleRoute(points, stepKm);
  const windResults = await fetchWindForPoints(samples.map((s) => ({ lat: s.lat, lon: s.lon })));

  let distTailKm = 0;
  let distHeadKm = 0;
  let distCrossKm = 0;

  const enriched = samples.map((s, i) => {
    const hourly = windResults[i]?.hourly;
    const etaHours = s.distKm / Math.max(5, avgSpeedKmh);
    const etaDate = new Date(departureDate.getTime() + etaHours * 3600 * 1000);
    const hIdx = hourly?.time ? nearestHourIndex(hourly.time, etaDate) : 0;
    const windSpeed = hourly?.wind_speed_10m?.[hIdx];
    const windDir = hourly?.wind_direction_10m?.[hIdx];
    const impact = Number.isFinite(windSpeed) && Number.isFinite(windDir)
      ? classifyWindImpact(windDir, windSpeed, s.heading)
      : null;

    const next = samples[i + 1];
    const segKm = next ? next.distKm - s.distKm : 0;
    if (impact) {
      if (impact.type === 'tail') distTailKm += segKm;
      else if (impact.type === 'head') distHeadKm += segKm;
      else distCrossKm += segKm;
    }
    return { ...s, eta: etaDate, windSpeed, windDir, impact };
  });

  return {
    distTailKm: Math.round(distTailKm * 10) / 10,
    distHeadKm: Math.round(distHeadKm * 10) / 10,
    distCrossKm: Math.round(distCrossKm * 10) / 10,
    // Score net = ce qu'on cherche à maximiser (double objectif de l'athlète ramené à un
    // seul chiffre) : plus de vent dans le dos ET moins de vent de face vont dans le même
    // sens ici, jamais en conflit l'un avec l'autre pour ce score.
    netScore: Math.round((distTailKm - distHeadKm) * 10) / 10,
    samples: enriched,
  };
}

/** Boîte englobante (bbox) [minLat, minLon, maxLat, maxLon] d'un ensemble de points, avec marge. */
export function routeBoundingBox(points, marginDeg = 0.01) {
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  return [
    Math.min(...lats) - marginDeg,
    Math.min(...lons) - marginDeg,
    Math.max(...lats) + marginDeg,
    Math.max(...lons) + marginDeg,
  ];
}

/**
 * Fraction de la distance totale du tracé passant à moins de `thresholdKm` d'au moins un
 * point de référence donné (segments Strava échantillonnés, ou points du réseau cyclable
 * OSM) — mesure simple et rapide de recouvrement, suffisante pour classer des candidats
 * entre eux (pas besoin d'une projection point-sur-segment plus précise pour ce cas d'usage).
 * @param {Array<{lat:number, lon:number, distKm:number}>} routeSamples tracé échantillonné (sampleRoute)
 * @param {Array<{lat:number, lon:number}>} referencePoints points de référence (segments/réseau)
 */
export function coverageFraction(routeSamples, referencePoints, thresholdKm = 0.08) {
  if (!routeSamples?.length || !referencePoints?.length) return 0;
  let coveredKm = 0;
  for (let i = 0; i < routeSamples.length; i++) {
    const s = routeSamples[i];
    const next = routeSamples[i + 1];
    const segKm = next ? next.distKm - s.distKm : 0;
    const near = referencePoints.some((r) => haversineKm(s, r) <= thresholdKm);
    if (near) coveredKm += segKm;
  }
  const totalKm = routeSamples[routeSamples.length - 1]?.distKm || 1;
  return Math.min(1, coveredKm / totalKm);
}

/**
 * Score de popularité combiné [0, 1] — moyenne à poids égal de la couverture Strava
 * (segments pondérés par leur fréquentation réelle, voir lib/strava.js) et de la
 * couverture réseau cyclable OSM (lib/osmCycleRoutes.js). Les deux composantes sont
 * indépendamment déjà normalisées en [0, 1] avant d'arriver ici.
 */
export function combinePopularityScore(stravaCoverage, osmCoverage) {
  const a = Number.isFinite(stravaCoverage) ? stravaCoverage : 0;
  const b = Number.isFinite(osmCoverage) ? osmCoverage : 0;
  return Math.round(((a + b) / 2) * 1000) / 1000;
}

/**
 * Score composite final [candidats triés du meilleur au pire] — normalise le score vent
 * (netScore, en km, borné par la distance du parcours) et le score popularité (déjà en
 * [0,1]) sur la même échelle avant de les combiner, pour qu'aucun des deux ne domine
 * artificiellement l'autre à cause d'unités différentes.
 * Pondération 60% vent / 40% popularité : le vent reste le critère PRINCIPAL demandé par
 * l'athlète, la popularité un critère secondaire ("en fonction des routes les plus
 * populaires" — vient en second dans sa demande).
 */
export function rankCandidates(candidatesWithScores) {
  const maxAbsWind = Math.max(1, ...candidatesWithScores.map((c) => Math.abs(c.wind.netScore)));
  return candidatesWithScores
    .map((c) => {
      const windNorm = c.wind.netScore / maxAbsWind; // dans [-1, 1]
      const composite = 0.6 * windNorm + 0.4 * (c.popularityScore * 2 - 1); // popularité recentrée sur [-1,1] pour rester comparable à windNorm
      return { ...c, compositeScore: Math.round(composite * 1000) / 1000 };
    })
    .sort((a, b) => b.compositeScore - a.compositeScore);
}
