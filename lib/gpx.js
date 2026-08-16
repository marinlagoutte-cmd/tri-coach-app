// lib/gpx.js
// Parsing de fichiers GPX (côté client uniquement, via DOMParser natif du navigateur —
// aucune dépendance supplémentaire nécessaire) et échantillonnage du tracé pour y
// projeter des vecteurs de vent à intervalle régulier.

import { haversineKm, bearingDeg } from './geo';

/**
 * Parse un fichier GPX (contenu texte brut) en tracé exploitable.
 * @param {string} xmlText
 * @returns {{ name: string, points: Array<{lat:number, lon:number, ele:number|null, distKm:number}>, totalDistanceKm: number, elevationGain: number, minEle: number|null, maxEle: number|null }}
 */
export function parseGPX(xmlText) {
  if (typeof window === 'undefined' || !window.DOMParser) {
    throw new Error('La lecture de fichiers GPX nécessite un navigateur.');
  }

  const xml = new window.DOMParser().parseFromString(xmlText, 'application/xml');
  if (xml.getElementsByTagName('parsererror').length) {
    throw new Error("Ce fichier n'est pas un GPX valide.");
  }

  // Trace (trkpt) en priorité, sinon route (rtept) — couvre la grande majorité des exports
  // (Strava, Garmin Connect, Komoot, RideWithGPS...).
  let ptNodes = Array.from(xml.getElementsByTagName('trkpt'));
  if (!ptNodes.length) ptNodes = Array.from(xml.getElementsByTagName('rtept'));
  if (!ptNodes.length) throw new Error('Aucun tracé trouvé dans ce fichier GPX.');

  const rawPoints = ptNodes
    .map((pt) => {
      const eleNode = pt.getElementsByTagName('ele')[0];
      return {
        lat: parseFloat(pt.getAttribute('lat')),
        lon: parseFloat(pt.getAttribute('lon')),
        ele: eleNode ? parseFloat(eleNode.textContent) : null,
      };
    })
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));

  if (!rawPoints.length) throw new Error('Aucun point GPS exploitable dans ce fichier GPX.');

  let cumDist = 0;
  const points = rawPoints.map((p, i) => {
    if (i > 0) cumDist += haversineKm(rawPoints[i - 1], p);
    return { ...p, distKm: cumDist };
  });

  let elevationGain = 0;
  for (let i = 1; i < points.length; i++) {
    if (Number.isFinite(points[i].ele) && Number.isFinite(points[i - 1].ele)) {
      const diff = points[i].ele - points[i - 1].ele;
      if (diff > 0) elevationGain += diff;
    }
  }
  const eles = points.map((p) => p.ele).filter((e) => Number.isFinite(e));

  const nameNode = xml.getElementsByTagName('name')[0];

  return {
    name: nameNode?.textContent?.trim() || 'Parcours importé',
    points,
    totalDistanceKm: cumDist,
    elevationGain: Math.round(elevationGain),
    minEle: eles.length ? Math.min(...eles) : null,
    maxEle: eles.length ? Math.max(...eles) : null,
  };
}

/**
 * Échantillonne un tracé environ tous les `stepKm`, en gardant toujours le premier et
 * le dernier point, et calcule le cap (bearing) local à chaque point échantillonné —
 * c'est ce cap qui sert de référence pour juger vent de face / de dos / de travers.
 */
export function sampleRoute(points, stepKm = 2) {
  if (!points.length) return [];
  const picked = [points[0]];
  let nextTarget = stepKm;
  for (let i = 1; i < points.length - 1; i++) {
    if (points[i].distKm >= nextTarget) {
      picked.push(points[i]);
      nextTarget += stepKm;
    }
  }
  const last = points[points.length - 1];
  if (picked[picked.length - 1] !== last) picked.push(last);

  return picked.map((p, i) => {
    const next = picked[i + 1];
    const prev = picked[i - 1];
    let heading = 0;
    if (next) heading = bearingDeg(p, next);
    else if (prev) heading = bearingDeg(prev, p);
    return { ...p, heading };
  });
}
