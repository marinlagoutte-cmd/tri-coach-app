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

// BUG CORRIGÉ (athlète : "demandé 60km, parcours de 90-100km") : le round_trip
// d'OpenRouteService SURESTIME systématiquement la distance réellement parcourue par
// rapport à la `length` demandée — comportement documenté par l'éditeur lui-même
// ("Usually the returned trips are a bit longer which can be regulated by lowering the
// input distance", blog HeiGIT) et confirmé par de nombreux retours utilisateurs sur le
// forum ORS (ex. 21km demandés -> 38km obtenus, un facteur de +80% à peu près comparable
// à notre cas +50/+67%). Le seul levier documenté est de demander une longueur RÉDUITE en
// entrée. On corrige donc en deux temps :
//   1. Un facteur de compensation appliqué dès le premier appel (calibré sur les retours
//      ci-dessus, à affiner si les distances réelles dérivent encore après coup).
//   2. Une seconde passe corrective PROPORTIONNELLE à l'écart réellement observé sur le
//      premier essai (le facteur d'overshoot n'est pas constant, il dépend du terrain/de la
//      densité du réseau routier local) si le résultat sort encore de la tolérance — on
//      garde alors le meilleur des deux essais.
const OVERSHOOT_INITIAL_FACTOR = 0.62;
const DISTANCE_TOLERANCE = 0.15; // ±15% autour de la distance cible, sinon 2e passe corrective

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
 * Génère UNE boucle candidate en compensant l'overshoot systématique d'ORS (voir
 * OVERSHOOT_INITIAL_FACTOR ci-dessus) : demande une longueur réduite, puis corrige une
 * seconde fois si le résultat réel s'écarte encore de plus de DISTANCE_TOLERANCE par
 * rapport à `targetDistanceKm` — en se basant sur le ratio réel/demandé observé sur le
 * premier essai (spécifique à CE point de départ/cette graine, donc plus fiable qu'un
 * facteur fixe unique pour compenser une 2e fois). Garde le meilleur des deux essais si la
 * 2e passe ne suffit toujours pas.
 * @param {{lat:number, lon:number}} start
 * @param {number} targetDistanceKm distance RÉELLEMENT visée par l'athlète
 * @param {number} seed
 */
async function fetchCalibratedRoundTripRoute(start, targetDistanceKm, seed) {
  const firstRequestKm = targetDistanceKm * OVERSHOOT_INITIAL_FACTOR;
  const first = await fetchRoundTripRoute(start, firstRequestKm, seed);
  const firstRatio = first.distanceKm / targetDistanceKm;
  if (Math.abs(firstRatio - 1) <= DISTANCE_TOLERANCE) return first;

  // Écart encore trop grand : on corrige la longueur demandée proportionnellement à
  // l'erreur réellement constatée sur ce premier essai (ex. si on a demandé 37km et obtenu
  // 60km pour une cible de 60km, ratio 60/60=1 déjà bon ; si on obtient 75km pour une
  // cible de 60km, ratio 1.25 -> on redemande 37 / 1.25 pour la 2e passe).
  const secondRequestKm = Math.max(1, firstRequestKm / firstRatio);
  try {
    const second = await fetchRoundTripRoute(start, secondRequestKm, seed);
    const secondRatio = second.distanceKm / targetDistanceKm;
    return Math.abs(secondRatio - 1) <= Math.abs(firstRatio - 1) ? second : first;
  } catch {
    // La 2e passe peut échouer (ex. longueur corrigée trop courte pour trouver une boucle
    // viable) — on garde alors le premier essai plutôt que de perdre tout le candidat.
    return first;
  }
}

/**
 * Génère `count` boucles candidates avec des graines différentes, en parallèle. Une
 * boucle qui échoue (ORS ne trouve parfois pas de round-trip viable pour une graine
 * donnée, surtout en zone peu dense) est simplement écartée plutôt que de faire échouer
 * tout le lot — voir pages/api/plan-route.js, qui exige au moins 1 candidat valide.
 */
export async function fetchRoundTripCandidates(start, distanceKm, count = 4) {
  const seeds = Array.from({ length: count }, (_, i) => i * 977 + 13); // graines arbitraires mais fixes/reproductibles, espacées pour maximiser la diversité géométrique
  const settled = await Promise.allSettled(seeds.map((seed) => fetchCalibratedRoundTripRoute(start, distanceKm, seed)));
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
