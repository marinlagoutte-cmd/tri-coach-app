// lib/windMap.js
// Données de vent horaires (Open-Meteo, sans clé API) pour la carte radar/vent, et
// logique d'impact du vent sur un cycliste selon son cap de déplacement.

import { angleDiff } from './geo';

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
// Open-Meteo accepte plusieurs positions séparées par des virgules dans un seul appel
// (latitude=lat1,lat2,...&longitude=lon1,lon2,...) — on regroupe donc toute une grille
// ou tout un parcours GPX en un minimum de requêtes réseau.
const MAX_BATCH_POINTS = 40;

// Demande explicite : ne garder que la fenêtre 24h (avant c'était 48h glissantes).
// On continue à demander 2 jours à Open-Meteo (forecast_days), car l'API renvoie les
// heures depuis minuit local — en fin de journée il ne resterait sinon pas 24h de
// données futures dans le jour courant seul. On découpe ensuite nous-mêmes, à partir
// de l'heure actuelle, exactement les 24 prochaines heures (voir sliceNext24h).
const HOURS_WINDOW = 24;

/**
 * Récupère vent (vitesse/direction/rafales) + précipitations horaires pour un
 * ensemble de points {lat, lon}, déjà réduites aux 24 prochaines heures.
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
    results.push(...arr.map((r) => ({ ...r, hourly: sliceNext24h(r.hourly) })));
  }
  return results;
}

/** Réduit un objet `hourly` Open-Meteo aux `HOURS_WINDOW` (24) prochaines heures à partir de maintenant. */
export function sliceNext24h(hourly) {
  if (!hourly?.time?.length) return hourly;
  const nowTs = Date.now();
  let startIdx = hourly.time.findIndex((t) => new Date(t).getTime() >= nowTs);
  if (startIdx === -1) startIdx = 0;
  const endIdx = Math.min(hourly.time.length, startIdx + HOURS_WINDOW);
  const sliced = {};
  for (const key of Object.keys(hourly)) {
    sliced[key] = Array.isArray(hourly[key]) ? hourly[key].slice(startIdx, endIdx) : hourly[key];
  }
  return sliced;
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

/**
 * Icône Leaflet (divIcon) flèche de vent — orientée vers `angleTowards` (direction VERS
 * laquelle le vent souffle, pas d'où il vient, voir windBlowingTowards ci-dessus), colorée
 * selon l'impact/la vitesse. Partagée entre components/WeatherRadarMap.js (grille de vent +
 * vent le long d'un GPX importé) et components/RoutePlannerMap.js (vent le long d'un
 * parcours généré) pour un rendu visuel identique dans les deux cas — factorisée ici plutôt
 * que dupliquée, `L` (le module Leaflet, chargé dynamiquement côté client par l'appelant)
 * est passé en paramètre pour que ce fichier reste utilisable côté serveur sans Leaflet.
 * @param {object} L module Leaflet déjà chargé par l'appelant
 * @param {{angleTowards:number, color:string, size?:number, ring?:boolean, rain?:boolean}} opts
 */
export function windArrowDivIcon(L, { angleTowards, color, size = 22, ring = false, rain = false }) {
  // Le badge pluie est placé dans un conteneur EXTÉRIEUR non tourné, sinon il tournerait
  // avec la flèche et se retrouverait à un endroit différent à chaque point du tracé.
  const dropBadge = rain
    ? `<div style="position:absolute;top:-3px;right:-3px;width:11px;height:11px;border-radius:50%;background:#38BDF8;border:1.5px solid rgba(8,6,20,0.9);display:flex;align-items:center;justify-content:center;font-size:8px;line-height:1;">💧</div>`
    : '';
  const html = `<div style="position:relative;width:${size}px;height:${size}px;">
    <div style="width:${size}px;height:${size}px;transform:rotate(${angleTowards}deg);display:flex;align-items:center;justify-content:center;${
    ring ? 'filter:drop-shadow(0 0 4px rgba(131,88,255,0.9));' : ''
  }">
      <svg width="${size}" height="${size}" viewBox="0 0 24 24">
        <path d="M12 1.5 L19 15 L12 11 L5 15 Z" fill="${color}" stroke="rgba(8,6,20,0.85)" stroke-width="1"/>
      </svg>
    </div>
    ${dropBadge}
  </div>`;
  return L.divIcon({ html, className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
}
