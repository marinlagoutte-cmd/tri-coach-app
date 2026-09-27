// lib/aiAvailability.js
//
// DISPONIBILITÉ DES MODÈLES IA.
//
// Constat (retour de l'athlète après déploiement) : le diagnostic affichait « plein de modèles
// non disponibles » sans dire pourquoi. Avec une clé GRATUITE, c'est attendu : Google ne
// donne pas de quota gratuit sur tous ses modèles récents (quota « limit: 0 »), et un
// identifiant peut être réservé à certains comptes. Ce n'est pas bloquant tant qu'au moins un
// modèle répond par tâche (l'app passe au suivant), mais :
//   1. chaque erreur est traduite en cause compréhensible + action (diagnostic) ;
//   2. en production, un modèle inexistant ou sans quota gratuit est MIS À L'ÉCART 6 h, un
//      modèle dont le quota est momentanément épuisé 2 min : on ne perd plus de temps à les
//      réessayer à chaque requête. (Mémoire par instance serveur : elle repart à zéro quand
//      Vercel recycle l'instance, sans conséquence.)

const SKIP_MS = { NOT_FOUND: 6 * 3600_000, NO_FREE_QUOTA: 6 * 3600_000, QUOTA: 120_000 };
const skipped = new Map(); // "provider:model" → timestamp de fin de mise à l'écart

function statusOf(message, status) {
  const n = Number(status);
  if (Number.isFinite(n) && n > 0) return n;
  const m = String(message || '').match(/\b(4\d\d|5\d\d)\b/);
  return m ? Number(m[1]) : null;
}

export function isNoFreeQuota(message) {
  return /limit:\s*0\b|free[_\s-]?tier[^.]*limit:\s*0|not available (on|for) the free tier|no free (tier|quota)/i.test(String(message || ''));
}

/**
 * Cause lisible d'une erreur de modèle.
 * @returns {{ code: string, label: string, hint: string }}
 */
export function explainModelError(message, status = null) {
  const msg = String(message || '');
  const st = statusOf(msg, status);
  if (/manquante|missing[^.]*key|absente/i.test(msg)) {
    return { code: 'NO_KEY', label: 'Clé absente', hint: "Ajoute la clé dans Vercel (Settings → Environment Variables), puis redéploie : une variable ajoutée ne s'applique qu'au déploiement suivant." };
  }
  if (st === 401 || st === 403 || /api key not valid|invalid[^.]*api[^.]*key|unauthori[sz]ed|permission[_ ]denied|forbidden/i.test(msg)) {
    return { code: 'AUTH', label: 'Clé refusée', hint: 'Vérifie la clé copiée dans Vercel (complète, sans espace, du bon compte), puis redéploie.' };
  }
  if (st === 429 && isNoFreeQuota(msg)) {
    return { code: 'NO_FREE_QUOTA', label: 'Pas de quota gratuit pour ce modèle', hint: "Ce modèle demande un compte avec facturation. Sans importance : l'app l'ignore et utilise les suivants." };
  }
  if (st === 404 || /not[ _]found|not supported|does not exist|unknown model|decommissioned|is not available/i.test(msg)) {
    return { code: 'NOT_FOUND', label: 'Modèle non accessible avec ta clé', hint: "Identifiant inconnu ou réservé à certains comptes. Sans importance : l'app l'ignore et utilise les suivants." };
  }
  if (st === 429 || /quota|rate[ _-]?limit|resource[_ ]exhausted|too many requests/i.test(msg)) {
    return { code: 'QUOTA', label: 'Quota épuisé pour le moment', hint: 'Limite gratuite par minute ou par jour atteinte. Réessaie plus tard.' };
  }
  if (/délai dépassé|timeout|timed out|abort/i.test(msg)) {
    return { code: 'TIMEOUT', label: 'Pas de réponse à temps', hint: 'Service lent ou surchargé. Réessaie dans un moment.' };
  }
  if (st && st >= 500) {
    return { code: 'SERVER', label: 'Service momentanément indisponible', hint: 'Panne passagère chez le fournisseur.' };
  }
  return { code: 'OTHER', label: 'Erreur', hint: msg.slice(0, 200) };
}

export function markModelUnavailable(provider, model, code) {
  const ms = SKIP_MS[code];
  if (ms) skipped.set(`${provider}:${model}`, Date.now() + ms);
}

export function isModelSkipped(provider, model) {
  const until = skipped.get(`${provider}:${model}`);
  if (!until) return false;
  if (until < Date.now()) { skipped.delete(`${provider}:${model}`); return false; }
  return true;
}

/** Candidats hors modèles mis à l'écart (liste complète si TOUS le sont, par sécurité). */
export function availableCandidates(provider, candidates) {
  const list = (candidates || []).filter((m) => !isModelSkipped(provider, m));
  return list.length ? list : candidates;
}

/** Réservé aux tests. */
export function __resetAvailability() { skipped.clear(); }
