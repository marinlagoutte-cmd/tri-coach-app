// lib/rateLimit.js
//
// Rate limiting léger par IP (en mémoire), pour protéger les 3 routes IA
// (/api/chat, /api/generate-plan, /api/nutrition) contre le spam/abus — sans
// exiger de compte (l'app autorise "continuer sans compte", donc pas d'auth
// obligatoire possible ici, juste un throttle par IP).
//
// LIMITE CONNUE (assumée) : ce compteur vit en mémoire du process serverless.
// Sur Vercel, chaque instance "cold" repart de zéro et plusieurs instances
// peuvent tourner en parallèle sous forte charge — ce n'est donc PAS une
// garantie dure (pas l'équivalent d'un rate-limiter distribué type Upstash/
// Redis), mais un premier rempart suffisant contre le risque réel identifié
// (un bot/scraper qui spamme l'URL Vercel et épuise le quota Gemini). Si le
// trafic grossit, migrer vers un store partagé sans changer l'API de ce module.
const buckets = new Map();
const MAX_BUCKETS = 5000; // garde-fou mémoire : purge globale simple si dépassé

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

/**
 * @param {{ id: string, limit: number, windowMs: number }} opts
 * @returns {{ allowed: boolean, retryAfterSec: number }}
 */
export function checkRateLimit(req, { id, limit, windowMs }) {
  const key = `${id}:${getClientIp(req)}`;
  const now = Date.now();

  if (buckets.size > MAX_BUCKETS) buckets.clear();

  const timestamps = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (timestamps.length >= limit) {
    const retryAfterSec = Math.max(1, Math.ceil((windowMs - (now - timestamps[0])) / 1000));
    return { allowed: false, retryAfterSec };
  }
  timestamps.push(now);
  buckets.set(key, timestamps);
  return { allowed: true, retryAfterSec: 0 };
}

export const RATE_LIMIT_MESSAGES = {
  fr: (s) => `⚠️ Trop de requêtes envoyées d'un coup. Réessaie dans ${s}s.`,
  en: (s) => `⚠️ Too many requests sent at once. Try again in ${s}s.`,
  es: (s) => `⚠️ Demasiadas solicitudes seguidas. Inténtalo de nuevo en ${s}s.`,
};
