// lib/geo.js
// Utilitaires géométriques partagés par le parseur GPX et le module vent.

export function toRad(deg) {
  return (deg * Math.PI) / 180;
}

export function toDeg(rad) {
  return (rad * 180) / Math.PI;
}

/**
 * Distance orthodromique (Haversine) entre deux points {lat, lon}, en km.
 */
export function haversineKm(a, b) {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * Cap initial (bearing) de a vers b, en degrés [0, 360[, 0 = Nord, sens horaire.
 */
export function bearingDeg(a, b) {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLon = toRad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  const brng = toDeg(Math.atan2(y, x));
  return (brng + 360) % 360;
}

/**
 * Différence angulaire signée la plus courte entre deux caps (en degrés), dans [-180, 180].
 */
export function angleDiff(a, b) {
  let d = (b - a) % 360;
  if (d < -180) d += 360;
  if (d > 180) d -= 360;
  return d;
}
