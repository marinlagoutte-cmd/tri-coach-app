// lib/windMap.js
// Données de vent horaires (Open-Meteo, sans clé API) pour la carte radar/vent, et
// logique d'impact du vent sur un cycliste selon son cap de déplacement.

import { angleDiff } from './geo';

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
// Open-Meteo accepte plusieurs positions séparées par des virgules dans un seul appel
// (latitude=lat1,lat2,...&longitude=lon1,lon2,...) — on regroupe donc toute une grille
// ou tout un parcours GPX en un minimum de requêtes réseau.
const MAX_BATCH_POINTS = 40;

/**
 * Récupère vent (vitesse/direction/rafales) + précipitations horaires pour un
 * ensemble de points {lat, lon}, sur 48h glissantes.
 * @returns {Promise<Array<object>>} un résultat Open-Meteo par point, dans l'ordre fourni.
 */
export async function fetchWindForPoints(points) {
  if (!points.length) return [];
  const chunks = [];
  for (let i = 0; i < points.length; i += MAX_BATCH_POINTS) {
    chunks.push(points.slice(i, i + MAX_BATCH_POINTS));
  }

  const results = [];
  for (const chunk of chunks) {
    const latitude = chunk.map((p) => p.lat.toFixed(4)).join(',');
    const longitude = chunk.map((p) => p.lon.toFixed(4)).join(',');
    const params = new URLSearchParams({
      latitude,
      longitude,
      hourly: 'wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation,precipitation_probability',
      wind_speed_unit: 'kmh',
      timezone: 'auto',
      forecast_days: '2',
    });
    const res = await fetch(`${FORECAST_URL}?${params.toString()}`);
    if (!res.ok) throw new Error('Impossible de récupérer les données de vent.');
    const data = await res.json();
    // Open-Meteo renvoie un tableau quand plusieurs positions sont passées, un objet sinon.
    const arr = Array.isArray(data) ? data : [data];
    results.push(...arr);
  }
  return results;
}

/** Direction météo (winddirection = d'où VIENT le vent) -> direction vers laquelle il SOUFFLE. */
export function windBlowingTowards(windDirectionFrom) {
  return (windDirectionFrom + 180) % 360;
}

/**
 * Classe l'impact du vent par rapport à un cap de déplacement (heading, en degrés).
 * @returns {{ type: 'tail'|'head'|'cross', component: number, angleFromBehind: number }}
 *   component > 0 = vent qui aide (poussée dans le dos), < 0 = vent qui freine.
 */
export function classifyWindImpact(windDirectionFrom, windSpeedKmh, heading) {
  const towards = windBlowingTowards(windDirectionFrom);
  const diff = angleDiff(heading, towards); // 0 = vent plein dos, ±180 = vent plein face
  const component = windSpeedKmh * Math.cos((diff * Math.PI) / 180);

  let type = 'cross';
  if (Math.abs(diff) <= 45) type = 'tail';
  else if (Math.abs(diff) >= 135) type = 'head';

  return { type, component: Math.round(component * 10) / 10, angleFromBehind: diff };
}

/** Index de l'heure la plus proche d'une date cible dans un tableau hourly.time Open-Meteo. */
export function nearestHourIndex(hourlyTimeArr, targetDate) {
  if (!hourlyTimeArr?.length) return 0;
  let best = 0;
  let bestDiff = Infinity;
  const targetTs = targetDate.getTime();
  for (let i = 0; i < hourlyTimeArr.length; i++) {
    const diff = Math.abs(new Date(hourlyTimeArr[i]).getTime() - targetTs);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  }
  return best;
}

/** Couleur (échelle volt/flare cohérente avec le design system) selon la vitesse du vent. */
export function speedColor(kmh) {
  if (kmh < 10) return '#67E8F9'; // cyan-300 — brise légère
  if (kmh < 20) return '#9A78FF'; // volt-400 — modéré
  if (kmh < 35) return '#FBBF24'; // amber-400 — soutenu, vigilance vélo
  return '#FF4D80'; // flare-500 — fort, prudence
}

/** Couleur selon le type d'impact vent pour un cycliste (dos/face/travers). */
export function impactColor(type) {
  if (type === 'tail') return '#34D399'; // emerald-400 — favorable
  if (type === 'head') return '#FF4D80'; // flare-500 — défavorable
  return '#FBBF24'; // amber-400 — travers
}

export const IMPACT_LABEL = {
  tail: 'Vent de dos',
  head: 'Vent de face',
  cross: 'Vent de travers',
};
