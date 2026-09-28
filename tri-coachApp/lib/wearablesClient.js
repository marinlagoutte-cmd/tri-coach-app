// lib/wearablesClient.js
//
// Contrepartie CÔTÉ NAVIGATEUR de lib/wearablesServer.js — volontairement séparée pour ne
// JAMAIS risquer d'embarquer un client_secret dans le bundle JS (même raisonnement que
// lib/stravaClient.js vs lib/strava.js). Ne touche QUE les variables NEXT_PUBLIC_*, qui
// sont publiques par design.
//
// Un seul objet connecté à la fois par utilisateur (Whoop OU Oura) : la récupération
// (HRV/sommeil) est un signal unique par athlète, pas la peine de gérer un merge entre deux
// sources concurrentes pour la V1 de cette fonctionnalité.
export const WEARABLE_PROVIDERS = [
  {
    id: 'whoop',
    name: 'Whoop',
    color: '#00A19A',
    authUrl: 'https://api.prod.whoop.com/oauth/oauth2/auth',
    // Scopes Whoop v1 nécessaires : recovery (HRV + FC repos), sleep (durée/score sommeil),
    // offline pour obtenir un refresh_token (sans quoi l'access_token expire ~1h sans moyen
    // de le renouveler silencieusement).
    scope: 'offline read:recovery read:sleep read:profile',
    clientIdEnv: 'NEXT_PUBLIC_WHOOP_CLIENT_ID',
  },
  {
    id: 'oura',
    name: 'Oura',
    color: '#7C6BFF',
    authUrl: 'https://cloud.ouraring.com/oauth/authorize',
    scope: 'daily heartrate',
    clientIdEnv: 'NEXT_PUBLIC_OURA_CLIENT_ID',
  },
];

export function getWearableProvider(id) {
  return WEARABLE_PROVIDERS.find((p) => p.id === id) || null;
}

export function isWearableClientConfigured(providerId) {
  const provider = getWearableProvider(providerId);
  if (!provider) return false;
  return Boolean(process.env[provider.clientIdEnv]);
}

export function anyWearableClientConfigured() {
  return WEARABLE_PROVIDERS.some((p) => isWearableClientConfigured(p.id));
}

/**
 * Construit l'URL d'autorisation OAuth2 du fournisseur choisi. `state` transporte
 * `${access_token Supabase}::${providerId}` (le provider doit être connu au retour du
 * callback pour savoir quel token endpoint/quelle table utiliser — voir
 * pages/api/wearables/callback.js).
 */
export function buildWearableAuthUrl({ providerId, redirectUri, state }) {
  const provider = getWearableProvider(providerId);
  if (!provider) throw new Error(`Fournisseur inconnu: ${providerId}`);
  const params = new URLSearchParams({
    client_id: process.env[provider.clientIdEnv],
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: provider.scope,
    state: state || '',
  });
  return `${provider.authUrl}?${params.toString()}`;
}
