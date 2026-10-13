// lib/stravaScope.js — lecture des autorisations Strava enregistrées.
//
// CORRECTIF (message « Reconnecte Strava » permanent) : selon la source, les autorisations
// sont séparées par des VIRGULES (adresse de retour Strava : « read,activity:read_all ») ou
// par des ESPACES (notation OAuth : « activity:read_all profile:read_all read », le cas réel
// enregistré dans la base de l'athlète). L'ancien découpage par virgules seules voyait un bloc
// unique, jamais égal à « profile:read_all », et signalait à tort une autorisation manquante.

export function parseScopes(scope) {
  return String(scope || '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
}

export function hasProfileScope(scope) {
  return parseScopes(scope).includes('profile:read_all');
}
