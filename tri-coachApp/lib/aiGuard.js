// lib/aiGuard.js
//
// PROTECTION DES ROUTES IA (chat, génération, régénération, nutrition, parcours, zones,
// diagnostic). Avant : routes ouvertes à n'importe qui connaissant l'URL Vercel, avec
// un simple compteur par IP gardé en mémoire (remis à zéro à chaque démarrage d'instance,
// non partagé entre instances) → un robot pouvait épuiser les quotas gratuits Gemini/Groq.
//
// Trois niveaux :
//   1. AUTHENTIFICATION : jeton de session Supabase (en-tête Authorization: Bearer …),
//      vérifié côté serveur. Exigée par défaut dès que Supabase est configuré.
//      AI_REQUIRE_AUTH=false la désactive (pour garder le mode « continuer sans compte »).
//   2. LIMITE PAR MINUTE : par compte si connecté, sinon par IP (lib/rateLimit.js).
//   3. QUOTA QUOTIDIEN PERSISTANT par compte (table Supabase `ai_usage`, voir
//      supabase-migration-ai-usage-2026-09.sql) : AI_DAILY_LIMIT appels/jour (80 par défaut).
//      Nécessite SUPABASE_SERVICE_ROLE_KEY ; si la table n'existe pas encore, ce niveau est
//      simplement ignoré (les deux premiers restent actifs).

import { createClient } from '@supabase/supabase-js';
import { checkRateLimit, RATE_LIMIT_MESSAGES } from './rateLimit';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const AUTH_MESSAGES = {
  fr: '🔒 Connecte-toi à ton compte pour utiliser le coach IA.',
  en: '🔒 Sign in to your account to use the AI coach.',
  es: '🔒 Inicia sesión en tu cuenta para usar el coach IA.',
};
const DAILY_MESSAGES = {
  fr: (n) => `⚠️ Limite quotidienne atteinte (${n} demandes IA). Elle se réinitialise à minuit (UTC).`,
  en: (n) => `⚠️ Daily limit reached (${n} AI requests). It resets at midnight (UTC).`,
  es: (n) => `⚠️ Límite diario alcanzado (${n} solicitudes IA). Se reinicia a medianoche (UTC).`,
};

export function aiAuthRequired() {
  const flag = String(process.env.AI_REQUIRE_AUTH || '').trim().toLowerCase();
  if (flag === 'false' || flag === '0' || flag === 'no') return false;
  return Boolean(supabaseUrl && anonKey);
}

export function dailyLimit() {
  const n = Number(process.env.AI_DAILY_LIMIT);
  return Number.isFinite(n) && n > 0 ? n : 80;
}

function extractToken(req) {
  const header = String(req.headers?.authorization || '');
  if (/^bearer\s+/i.test(header)) return header.replace(/^bearer\s+/i, '').trim();
  return typeof req.body?.accessToken === 'string' ? req.body.accessToken : null;
}

async function resolveUser(token) {
  if (!token || !supabaseUrl || !anonKey) return null;
  try {
    const client = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data, error } = await client.auth.getUser(token);
    return error ? null : data?.user || null;
  } catch (_) {
    return null;
  }
}

let usageTableMissing = false;

/** Compte et enregistre l'appel du jour. Renvoie { exceeded } ; ne bloque jamais sur une panne. */
async function consumeDailyQuota(userId, routeId) {
  if (!userId || !serviceRoleKey || !supabaseUrl || usageTableMissing) return { exceeded: false };
  try {
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    const { count, error } = await admin
      .from('ai_usage')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', since.toISOString());
    if (error) {
      if (/relation .*ai_usage.* does not exist|42P01/i.test(`${error.message} ${error.code}`)) {
        usageTableMissing = true;
        console.warn('[aiGuard] Table ai_usage absente : quota quotidien désactivé (exécute supabase-migration-ai-usage-2026-09.sql).');
      }
      return { exceeded: false };
    }
    if ((count || 0) >= dailyLimit()) return { exceeded: true };
    await admin.from('ai_usage').insert({ user_id: userId, route: routeId });
    return { exceeded: false };
  } catch (e) {
    console.warn('[aiGuard] quota quotidien indisponible :', e?.message || e);
    return { exceeded: false };
  }
}

/**
 * À appeler en tête de chaque route IA.
 * @returns {Promise<{allowed:boolean, status:number, message:string|null, retryAfterSec:number, user:object|null, code?:string}>}
 */
export async function guardAiRoute(req, { id, limit, windowMs }) {
  const lang = AUTH_MESSAGES[req.body?.language] ? req.body.language : 'fr';
  const user = await resolveUser(extractToken(req));

  if (aiAuthRequired() && !user) {
    return { allowed: false, status: 401, code: 'AUTH_REQUIRED', message: AUTH_MESSAGES[lang], retryAfterSec: 0, user: null };
  }

  const { allowed, retryAfterSec } = checkRateLimit(req, { id, limit, windowMs, key: user?.id ? `user:${user.id}` : null });
  if (!allowed) {
    return { allowed: false, status: 429, code: 'RATE_LIMIT', message: RATE_LIMIT_MESSAGES[lang](retryAfterSec), retryAfterSec, user };
  }

  const { exceeded } = await consumeDailyQuota(user?.id, id);
  if (exceeded) {
    return { allowed: false, status: 429, code: 'DAILY_LIMIT', message: DAILY_MESSAGES[lang](dailyLimit()), retryAfterSec: 0, user };
  }
  return { allowed: true, status: 200, message: null, retryAfterSec: 0, user };
}
