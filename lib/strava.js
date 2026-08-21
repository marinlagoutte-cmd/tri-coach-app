// lib/strava.js
//
// Wrapper léger autour de l'API Strava (OAuth + endpoints activités), utilisé
// UNIQUEMENT côté serveur (pages/api/strava/*.js) — le client_secret et les
// tokens ne doivent jamais atteindre le navigateur.
//
// Variables d'environnement requises (voir STRAVA_SETUP.md) :
//   NEXT_PUBLIC_STRAVA_CLIENT_ID  (public : utilisé aussi côté navigateur pour
//                                  construire l'URL de connexion)
//   STRAVA_CLIENT_SECRET          (privé, serveur uniquement)
//   STRAVA_WEBHOOK_VERIFY_TOKEN   (privé, chaîne arbitraire choisie par toi,
//                                  utilisée pour valider l'abonnement webhook)

const STRAVA_TOKEN_URL = 'https://www.strava.com/oauth/token';
const STRAVA_API_BASE = 'https://www.strava.com/api/v3';

export function isStravaConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_STRAVA_CLIENT_ID && process.env.STRAVA_CLIENT_SECRET);
}

// La construction de l'URL d'autorisation elle-même ne touche à aucun secret
// serveur : elle vit dans lib/stravaClient.js (importable aussi bien depuis un
// composant client que depuis une route API), pour n'avoir qu'une seule
// implémentation. Re-exportée ici pour les routes serveur qui en ont besoin.
export { buildStravaAuthUrl } from './stravaClient';

async function stravaFetch(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* réponse non-JSON */ }
  if (!res.ok) {
    const err = new Error(data?.message || `Strava API error ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/** Échange le `code` OAuth initial contre les jetons access/refresh. */
export async function exchangeStravaCode(code) {
  const body = new URLSearchParams({
    client_id: process.env.NEXT_PUBLIC_STRAVA_CLIENT_ID,
    client_secret: process.env.STRAVA_CLIENT_SECRET,
    code,
    grant_type: 'authorization_code',
  });
  return stravaFetch(STRAVA_TOKEN_URL, { method: 'POST', body });
}

/** Rafraîchit un access_token expiré à partir du refresh_token stocké. */
export async function refreshStravaToken(refreshToken) {
  const body = new URLSearchParams({
    client_id: process.env.NEXT_PUBLIC_STRAVA_CLIENT_ID,
    client_secret: process.env.STRAVA_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  return stravaFetch(STRAVA_TOKEN_URL, { method: 'POST', body });
}

/**
 * Retourne un access_token valide pour ce jeu de jetons stocké, en le
 * rafraîchissant d'abord si besoin (Strava expire l'access_token toutes les
 * 6h). Retourne aussi les nouveaux jetons si un refresh a eu lieu, pour que
 * l'appelant les persiste en base.
 */
export async function ensureValidStravaToken({ accessToken, refreshToken, expiresAt }) {
  const nowSec = Math.floor(Date.now() / 1000);
  // Marge de 5 min avant l'expiration réelle, pour éviter un 401 en plein appel.
  if (expiresAt && expiresAt - nowSec > 300) {
    return { accessToken, refreshToken, expiresAt, refreshed: false };
  }
  const data = await refreshStravaToken(refreshToken);
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_at,
    refreshed: true,
  };
}

export async function revokeStravaToken(accessToken) {
  const body = new URLSearchParams({ access_token: accessToken });
  return stravaFetch('https://www.strava.com/oauth/deauthorize', { method: 'POST', body });
}

export async function fetchStravaAthlete(accessToken) {
  return stravaFetch(`${STRAVA_API_BASE}/athlete`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function fetchStravaActivity(accessToken, activityId) {
  return stravaFetch(`${STRAVA_API_BASE}/activities/${activityId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

/**
 * Liste les activités de l'athlète (endpoint /athlete/activities, résumés "SummaryActivity" —
 * contient déjà tous les champs utilisés par toActivityRow ci-dessous, pas besoin d'un fetch
 * détaillé par activité comme pour un événement webhook unique). Utilisée UNIQUEMENT par
 * l'import manuel en masse (pages/api/strava/sync.js) — le webhook temps réel continue d'utiliser
 * fetchStravaActivity (une activité à la fois, sur événement).
 * `perPage` max autorisé par Strava : 200.
 */
export async function fetchStravaActivities(accessToken, { page = 1, perPage = 200, afterEpochSec } = {}) {
  const params = new URLSearchParams({ page: String(page), per_page: String(perPage) });
  if (afterEpochSec) params.set('after', String(afterEpochSec));
  return stravaFetch(`${STRAVA_API_BASE}/athlete/activities?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

/**
 * Met en forme une activité Strava brute (webhook OU liste) au format de la table
 * `strava_activities`. Partagée entre le webhook temps réel et l'import manuel en masse pour
 * n'avoir qu'une seule implémentation (auparavant dupliquée dans pages/api/strava/webhook.js).
 */
export function toActivityRow(raw, userId) {
  return {
    id: raw.id,
    user_id: userId,
    sport_type: raw.sport_type || raw.type || null,
    name: raw.name || null,
    start_date: raw.start_date,
    start_date_local: raw.start_date_local,
    timezone: raw.timezone || null,
    distance_m: raw.distance ?? null,
    moving_time_s: raw.moving_time ?? null,
    elapsed_time_s: raw.elapsed_time ?? null,
    total_elevation_m: raw.total_elevation_gain ?? null,
    average_speed_ms: raw.average_speed ?? null,
    max_speed_ms: raw.max_speed ?? null,
    average_heartrate: raw.average_heartrate ?? null,
    max_heartrate: raw.max_heartrate ?? null,
    average_watts: raw.average_watts ?? null,
    max_watts: raw.max_watts ?? null,
    summary_polyline: raw.map?.summary_polyline || null,
  };
}

const STREAM_KEYS = ['time', 'latlng', 'distance', 'altitude', 'heartrate', 'watts', 'velocity_smooth', 'cadence'];

export async function fetchStravaActivityStreams(accessToken, activityId) {
  const params = new URLSearchParams({ keys: STREAM_KEYS.join(','), key_by_type: 'true' });
  return stravaFetch(`${STRAVA_API_BASE}/activities/${activityId}/streams?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// Re-exportée pour les routes serveur qui importent déjà lib/strava.js — voir
// lib/stravaClient.js pour l'implémentation (fonction pure, sans secret).
export { stravaSportToDiscipline } from './stravaClient';
