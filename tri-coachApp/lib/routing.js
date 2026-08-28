// lib/routing.js
//
// Génération de parcours vélo via OpenRouteService (ORS) — moteur de routage externe
// nécessaire car Strava ne permet PAS de générer un tracé via son API publique (lecture
// seule sur les routes existantes depuis 2019). Gratuit (2000 requêtes/jour, pas de CB),
// cohérent avec le choix déjà fait dans le reste de l'app d'éviter les APIs payantes
// (Open-Meteo pour météo/vent/géocodage — voir lib/weather.js, lib/windMap.js).
//
// UTILISÉ UNIQUEMENT CÔTÉ SERVEUR (pages/api/plan-route.js) : la clé ORS_API_KEY ne doit
// jamais atteindre le navigateur, même principe que STRAVA_CLIENT_SECRET (voir lib/strava.js).
//
// Variable d'environnement requise : ORS_API_KEY (voir openrouteservice.org/dev, plan
// Standard gratuit).
//
// PRINCIPE "round_trip" ORS : on donne un point de départ + une longueur cible + une
// graine (seed) — ORS renvoie une boucle qui revient au point de départ, en suivant le
// réseau routier réel (contrairement à une simple boucle géométrique). Des graines
// différentes produisent des boucles géométriquement différentes pour la MÊME distance —
// c'est ce qu'on exploite pour générer plusieurs candidats à comparer ensuite sur le vent
// (lib/routePlanning.js) et la popularité (lib/strava.js + lib/osmCycleRoutes.js).

const ORS_BASE = 'https://api.openrouteservice.org/v2/directions';

export function isOrsConfigured() {
  return Boolean(process.env.ORS_API_KEY);
}

/**
 * Profil ORS à utiliser selon le type de sortie déclaré par l'athlète. 'cycling-road' cible
 * déjà par défaut les routes praticables à vélo de route (évite les sentiers/singletracks
 * que 'cycling-regular' peut inclure) — le choix le plus proche d'une "sortie route" classique.
 */
const ORS_PROFILE = 'cycling-road';

/**
 * Génère UNE boucle candidate (round-trip) depuis un point de départ.
 * @param {{lat:number, lon:number}} start
 * @param {number} distanceKm distance cible de la boucle
 * @param {number} seed graine ORS (entier) — une graine différente produit une géométrie
 *   différente pour la même distance ; c'est le seul levier ORS pour varier les candidats
 *   sur un round-trip (pas de contrôle direct de la direction/du cap de sortie).
 * @returns {Promise<{points: Array<{lat:number, lon:number, distKm:number}>, distanceKm:number, elevationGain:number|null, ascentM:number|null, raw:object}>}
 */
export async function fetchRoundTripRoute(start, distanceKm, seed) {
  if (!isOrsConfigured()) {
    const err = new Error('Clé API OpenRouteService manquante. Définis ORS_API_KEY dans Vercel → Settings → Environment Variables (voir openrouteservice.org/dev).');
    err.code = 'NO_KEY';
    throw err;
  }
  if (!Number.isFinite(start?.lat) || !Number.isFinite(start?.lon)) {
    throw new Error('Point de départ invalide.');
  }
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) {
    throw new Error('Distance invalide.');
  }

  const body = {
    coordinates: [[start.lon, start.lat]],
    // 'length' est en MÈTRES côté ORS.
    options: {
      round_trip: {
        length: Math.round(distanceKm * 1000),
        points: 5, // nb de points de passage internes générés par ORS pour façonner la boucle — valeur recommandée par leur doc pour un bon compromis forme/fiabilité
        seed: Number.isFinite(seed) ? Math.round(seed) : 0,
      },
    },
    elevation: true,
    instructions: false,
  };

  const res = await fetch(`${ORS_BASE}/${ORS_PROFILE}/geojson`, {
    method: 'POST',
    headers: {
      Authorization: process.env.ORS_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* réponse non-JSON */ }

  if (!res.ok) {
    const message = data?.error?.message || data?.error || `Erreur OpenRouteService (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    err.code = res.status === 401 || res.status === 403 ? 'AUTH' : res.status === 429 ? 'QUOTA' : 'UNKNOWN';
    throw err;
  }

  const feature = data?.features?.[0];
  const coords = feature?.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) {
    throw new Error("OpenRouteService n'a pas réussi à générer de boucle à cette distance depuis ce point de départ.");
  }

  // GeoJSON = [lon, lat, ele?] — on reconstruit une distance cumulée nous-mêmes plutôt que
  // de faire confiance à un éventuel champ agrégé, pour rester cohérent avec le format
  // {lat, lon, distKm} déjà utilisé partout ailleurs (voir lib/gpx.js:parseGPX).
  let cumKm = 0;
  const points = coords.map((c, i) => {
    const point = { lat: c[1], lon: c[0], ele: Number.isFinite(c[2]) ? c[2] : null };
    if (i > 0) {
      const prev = coords[i - 1];
      cumKm += haversineKmLocal({ lat: prev[1], lon: prev[0] }, point);
    }
    return { ...point, distKm: cumKm };
  });

  const summary = feature?.properties?.summary;
  const ascentM = feature?.properties?.ascent;

  return {
    points,
    distanceKm: Number.isFinite(summary?.distance) ? summary.distance / 1000 : cumKm,
    ascentM: Number.isFinite(ascentM) ? Math.round(ascentM) : null,
    raw: data,
  };
}

/**
 * Génère `count` boucles candidates avec des graines différentes, en parallèle. Une
 * boucle qui échoue (ORS ne trouve parfois pas de round-trip viable pour une graine
 * donnée, surtout en zone peu dense) est simplement écartée plutôt que de faire échouer
 * tout le lot — voir pages/api/plan-route.js, qui exige au moins 1 candidat valide.
 */
export async function fetchRoundTripCandidates(start, distanceKm, count = 4) {
  const seeds = Array.from({ length: count }, (_, i) => i * 977 + 13); // graines arbitraires mais fixes/reproductibles, espacées pour maximiser la diversité géométrique
  const settled = await Promise.allSettled(seeds.map((seed) => fetchRoundTripRoute(start, distanceKm, seed)));
  const candidates = [];
  const errors = [];
  const errorCodes = [];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') candidates.push({ ...r.value, seed: seeds[i] });
    else {
      errors.push(r.reason?.message || String(r.reason));
      errorCodes.push(r.reason?.code);
    }
  });
  if (candidates.length === 0) {
    const err = new Error(`Aucune boucle générée par OpenRouteService. Détails : ${errors[0] || 'inconnu'}`);
    // CORRIGÉ : on lit directement le code déjà posé par fetchRoundTripRoute (fiable, basé
    // sur le statut HTTP réel de la réponse ORS) plutôt qu'une regex sur le texte du message
    // — celle-ci ratait la plupart des vraies erreurs 401/403/429 d'ORS, dont le message ne
    // contient pas forcément littéralement "401"/"unauthorized"/"clé".
    err.code = errorCodes.includes('AUTH') ? 'AUTH' : errorCodes.includes('QUOTA') ? 'QUOTA' : 'UNKNOWN';
    throw err;
  }
  return { candidates, errors };
}

// Copie locale minimale de haversineKm (lib/geo.js) pour éviter une dépendance circulaire
// inutile ici — lib/geo.js reste la source de vérité utilisée partout ailleurs dans l'app
// (lib/gpx.js, lib/windMap.js) ; cette fonction ne sert qu'au calcul interne de distKm
// juste après réception de la réponse ORS, ci-dessus.
function haversineKmLocal(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
