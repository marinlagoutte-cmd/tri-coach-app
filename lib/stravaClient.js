// lib/stravaClient.js
//
// Contrepartie CÔTÉ NAVIGATEUR de lib/strava.js — volontairement séparée pour
// ne JAMAIS risquer d'embarquer STRAVA_CLIENT_SECRET (ni aucune autre variable
// serveur) dans le bundle JS envoyé au client. Ce fichier ne touche QUE
// NEXT_PUBLIC_STRAVA_CLIENT_ID, qui est public par design.
const STRAVA_OAUTH_URL = 'https://www.strava.com/oauth/authorize';

export function isStravaClientConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_STRAVA_CLIENT_ID);
}

/**
 * Traduit un `sport_type` Strava (ex: "Run", "TrailRun", "Ride", "VirtualRide",
 * "Swim", "OpenWaterSwim"...) vers un des types canoniques Tri Coach (voir
 * classifyDiscipline dans lib/workouts.js). Fonction pure (aucun secret), donc
 * volontairement ici plutôt que dans lib/strava.js : elle est importée à la
 * fois par des composants client (CalendarView.js via lib/stravaMatch.js) et
 * par les routes serveur (re-exportée par lib/strava.js).
 */
export function stravaSportToDiscipline(sportType) {
  const s = String(sportType || '').toLowerCase();
  if (s.includes('swim')) return 'NATATION';
  if (s.includes('ride') || s.includes('cycl') || s.includes('velomobile') || s.includes('handcycle')) return 'CYCLISME';
  if (s.includes('run') || s.includes('walk') || s.includes('hike')) return 'C.A.P';
  return null; // discipline non reconnue (ex: musculation, ski...) : pas de correspondance auto
}

/**
 * Construit l'URL d'autorisation Strava ouverte par le bouton "Connecter Strava"
 * (voir SettingsModal.js). `state` transporte l'access_token Supabase courant,
 * relu côté serveur dans pages/api/strava/callback.js pour savoir à quel
 * compte Tri Coach rattacher l'autorisation Strava une fois accordée.
 */
export function buildStravaAuthUrl({ redirectUri, state }) {
  const params = new URLSearchParams({
    client_id: process.env.NEXT_PUBLIC_STRAVA_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    approval_prompt: 'auto',
    scope: 'read,activity:read_all',
    state: state || '',
  });
  return `${STRAVA_OAUTH_URL}?${params.toString()}`;
}
