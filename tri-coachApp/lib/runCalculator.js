// lib/runCalculator.js
//
// OUTIL « ALLURES & CHRONOS » (course à pied) — prédictions de chronos, allures et FC par
// zone, temps de passage au 100 m. Tout est calculé à partir des valeurs de l'athlète (VMA,
// perf de référence, FC max) : ce sont des ESTIMATIONS, affichées comme telles.
//   - D'après la VMA : % de VMA tenable selon la distance (lib/physiology.js, le même que le
//     coach utilise pour estimer la VMA à partir d'un chrono).
//   - D'après une perf de référence : formule de Riegel, T2 = T1 × (D2 / D1)^1,06 — fiable
//     entre distances voisines, de moins en moins quand l'écart grandit (5 km → marathon).

import { vmaPercentForDistance } from './physiology';

export const RACE_DISTANCES = [
  { id: '1500', label: '1500 m', m: 1500 },
  { id: '3000', label: '3000 m', m: 3000 },
  { id: '5k', label: '5 km', m: 5000 },
  { id: '10k', label: '10 km', m: 10000 },
  { id: 'semi', label: 'Semi-marathon', m: 21097.5 },
  { id: 'marathon', label: 'Marathon', m: 42195 },
];
export const RIEGEL_EXPONENT = 1.06;

/** Chrono (s) sur `meters` à `pct` de la VMA (km/h). */
export function timeAtVmaPct(vmaKmh, meters, pct) {
  if (!(vmaKmh > 0) || !(meters > 0) || !(pct > 0)) return null;
  return meters / ((vmaKmh * pct) / 3.6);
}

/** Chrono prédit (s) d'après la VMA, au % tenable pour la distance. */
export function timeFromVma(vmaKmh, meters) {
  return timeAtVmaPct(vmaKmh, meters, vmaPercentForDistance(meters / 1000));
}

/** Riegel : chrono (s) sur d2 à partir d'un chrono t1 (s) sur d1. */
export function riegel(t1, d1, d2, k = RIEGEL_EXPONENT) {
  if (!(t1 > 0) || !(d1 > 0) || !(d2 > 0)) return null;
  return t1 * (d2 / d1) ** k;
}

/** VMA estimée (km/h) à partir d'une perf réelle. */
export function vmaFromPerformance(meters, seconds) {
  if (!(meters > 0) || !(seconds > 0)) return null;
  const speed = (meters / seconds) * 3.6;
  return Math.round((speed / vmaPercentForDistance(meters / 1000)) * 10) / 10;
}

/** Tableau des prédictions pour toutes les distances. */
export function predictions({ vma = null, refMeters = null, refSeconds = null } = {}) {
  return RACE_DISTANCES.map((d) => {
    const fromVma = vma ? timeFromVma(vma, d.m) : null;
    const fromRef = refMeters && refSeconds ? riegel(refSeconds, refMeters, d.m) : null;
    const main = fromRef ?? fromVma;
    return { ...d, fromVma, fromRef, paceSecPerKm: main ? main / (d.m / 1000) : null };
  });
}

/** Temps de passage (s) tous les `step` m jusqu'à `max` m, à la vitesse donnée (km/h). */
export function splitsTable(speedKmh, step = 100, max = 1500) {
  if (!(speedKmh > 0)) return [];
  const perMeter = 3.6 / speedKmh;
  const out = [];
  for (let m = step; m <= max; m += step) out.push({ m, seconds: m * perMeter });
  return out;
}

/** « h:mm:ss », « m:ss » ou « m:ss.d » (dixièmes pour les passages courts). */
export function formatDuration(seconds, { tenths = false } = {}) {
  if (!(seconds >= 0) || !Number.isFinite(seconds)) return '—';
  if (tenths && seconds < 600) {
    const t = Math.round(seconds * 10) / 10;
    const m = Math.floor(t / 60);
    const sec = (t - m * 60).toFixed(1).padStart(4, '0');
    return m ? `${m}:${sec}` : `${sec.replace(/^0(?=\d\.)/, '')}"`;
  }
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

/** Allure « m:ss /km » depuis une vitesse (km/h). */
export function paceFromSpeed(kmh) {
  if (!(kmh > 0)) return '—';
  return `${formatDuration(3600 / kmh)} /km`;
}
