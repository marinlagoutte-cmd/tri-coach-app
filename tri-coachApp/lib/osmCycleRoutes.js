// lib/osmCycleRoutes.js
//
// Réseau cyclable officiel (OpenStreetMap, via Overpass API) — SECONDE source de
// "popularité" en complément des segments Strava (lib/strava.js), demande explicite de
// l'athlète ("cherche quand même mieux si possible, si tu as d'autre idée combine").
//
// Pourquoi cette source en plus de Strava : les segments Strava sont posés par des
// cyclistes pour se CHRONOMÉTRER (souvent des côtes, des lignes droites rapides) — ça ne
// dit rien de si une route est agréable/sûre pour rouler. Le réseau cyclable officiel OSM
// (relations tag route=bicycle, réseaux national/régional/local — "EuroVelo", "véloroutes
// voies vertes" en France) est au contraire un signal de ROUTES RECOMMANDÉES pour le vélo,
// entretenu par la communauté cartographique — complémentaire, pas redondant.
//
// Gratuit, sans clé API (contrairement à Strava/ORS) — endpoint public Overpass.
// Utilisé UNIQUEMENT côté serveur (pages/api/plan-route.js) : pas de raison de l'appeler
// depuis le navigateur, et Overpass impose une limite de débit par IP qu'on préfère
// maîtriser depuis une seule origine serveur.

const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';
// Overpass peut être lent (requêtes géospatiales lourdes côté serveur public partagé) —
// on ne bloque jamais tout le scoring dessus : un timeout dépassé désactive juste CETTE
// composante du score de popularité (voir pages/api/plan-route.js, qui retombe alors sur
// la seule couverture Strava).
const OVERPASS_TIMEOUT_MS = 12_000;

/**
 * Récupère les points constituant le réseau cyclable officiel (relations route=bicycle,
 * tous réseaux confondus : ncn/rcn/lcn = national/régional/local) dans une bbox donnée.
 * @param {[number,number,number,number]} bbox [minLat, minLon, maxLat, maxLon]
 * @returns {Promise<Array<{lat:number, lon:number}>>} points échantillons du réseau (pas les tracés complets — largement suffisant pour un calcul de recouvrement approximatif, voir lib/routePlanning.js:coverageFraction)
 */
export async function fetchOsmCycleNetworkPoints(bbox) {
  const [minLat, minLon, maxLat, maxLon] = bbox;
  // Requête Overpass QL : toutes les relations "route=bicycle" dans la bbox, avec leurs
  // membres "way" en géométrie ("out geom") — on ne demande QUE les nœuds de ces ways,
  // pas les tags complets, pour garder la réponse légère.
  const query = `
    [out:json][timeout:10];
    (
      relation["route"="bicycle"](${minLat},${minLon},${maxLat},${maxLon});
    );
    way(r)->.cycleways;
    .cycleways out geom;
  `.trim();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OVERPASS_TIMEOUT_MS);
  try {
    const res = await fetch(OVERPASS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Overpass API error ${res.status}`);
    const data = await res.json();
    const points = [];
    for (const el of data.elements || []) {
      if (el.type === 'way' && Array.isArray(el.geometry)) {
        for (const g of el.geometry) {
          if (Number.isFinite(g.lat) && Number.isFinite(g.lon)) points.push({ lat: g.lat, lon: g.lon });
        }
      }
    }
    return points;
  } finally {
    clearTimeout(timeoutId);
  }
}
