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
    // 'force' (pas 'auto') : avec 'auto', si l'athlète a déjà autorisé l'app une première
    // fois, Strava saute l'écran de permissions et renvoie directement l'ANCIEN scope déjà
    // accordé, sans jamais proposer les nouveaux scopes demandés ici — c'est précisément ce
    // qui empêchait le bouton "Reconnecter Strava" (SettingsModal.js) de corriger l'absence
    // de profile:read_all : cliquer dessus relançait bien le flux OAuth, mais Strava
    // renvoyait le même token/scope qu'avant sans jamais demander confirmation. 'force'
    // réaffiche systématiquement l'écran de consentement (léger coût UX au tout premier
    // lien aussi, mais sans lui aucune reconnexion pour ajouter un scope ne peut fonctionner).
    approval_prompt: 'force',
    // profile:read_all est INDISPENSABLE pour que Strava renvoie athlete.bikes/athlete.shoes
    // (voir lib/equipment.js:extractStravaGear) — sans lui, /athlete renvoie une fiche
    // "résumée" sans matériel, quel que soit le kilométrage réel côté Strava.
    scope: 'read,activity:read_all,profile:read_all',
    state: state || '',
  });
  return `${STRAVA_OAUTH_URL}?${params.toString()}`;
}
