// lib/aiConfig.js
//
// CONFIGURATION CENTRALISÉE DES MODÈLES IA — une seule source de vérité, partagée par
// lib/aiClient.js (appels réels) et pages/api/ai-diagnostics.js (panneau Réglages → IA).
//
// Pourquoi des "paliers" (tiers) au lieu d'une liste unique de modèles :
// avant, TOUTES les tâches (génération d'un plan de 14 séances, simple phrase de chat,
// validation d'une zone) passaient par la même liste, avec gemini-3.1-flash-lite en premier —
// le modèle le moins capable pour la tâche la plus difficile de l'app. Ici :
//   - plan   : génération/régénération de semaines → modèle le plus capable d'abord,
//              réflexion "medium", timeout long (JSON volumineux).
//   - review : relecture/réparation d'un plan → même exigence de raisonnement.
//   - chat   : conversation + petits ajustements → bon compromis latence/qualité.
//   - light  : tâches courtes (nutrition, analyse Strava, validation de zones, choix de
//              parcours) → modèles rapides et économes en quota.
// Si un modèle est indisponible (quota gratuit épuisé, renommé, panne), l'appelant passe au
// suivant : le quota gratuit Gemini est compté PAR MODÈLE, donc une chaîne de repli élargit
// aussi le quota total disponible.
//
// Variables d'environnement (toutes optionnelles) :
//   GG_MODELS_PLAN / GG_MODELS_REVIEW / GG_MODELS_CHAT / GG_MODELS_LIGHT  (listes "a,b,c")
//   GROQ_MODELS_PLAN / ... (idem pour Groq)
//   GG_PREFERRED_MODELS / GROQ_PREFERRED_MODELS : ANCIENNES variables, encore respectées pour
//   ne rien casser — mais elles forcent la MÊME liste pour toutes les tâches. Si elles sont
//   définies dans Vercel avec l'ancienne valeur (flash-lite en premier), supprime-les.
//   AI_THINKING_PLAN / AI_THINKING_CHAT ... : "MINIMAL" | "LOW" | "MEDIUM" | "HIGH".

const TIERS = {
  plan: {
    gemini: ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.1-flash-lite'],
    groq: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'],
    thinking: 'MEDIUM',
    groqEffort: 'medium',
    timeoutMs: 120_000,
  },
  review: {
    gemini: ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.1-flash-lite'],
    groq: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'],
    thinking: 'MEDIUM',
    groqEffort: 'medium',
    timeoutMs: 90_000,
  },
  chat: {
    gemini: ['gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'],
    groq: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'],
    thinking: 'LOW',
    groqEffort: 'low',
    timeoutMs: 60_000,
  },
  light: {
    gemini: ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.6-flash'],
    groq: ['openai/gpt-oss-20b', 'openai/gpt-oss-120b'],
    thinking: 'LOW',
    groqEffort: 'low',
    timeoutMs: 40_000,
  },
};

export const TIER_NAMES = Object.keys(TIERS);

function parseList(value) {
  return String(value || '').split(',').map((s) => s.trim()).filter(Boolean);
}

function envFor(prefix, tier) {
  return process.env[`${prefix}_${tier.toUpperCase()}`];
}

/** Liste ordonnée des modèles à essayer pour un fournisseur et une tâche. */
export function getModelCandidates(provider, tier = 'plan') {
  const conf = TIERS[tier] || TIERS.plan;
  if (provider === 'groq') {
    const specific = parseList(envFor('GROQ_MODELS', tier));
    if (specific.length) return specific;
    const legacy = parseList(process.env.GROQ_PREFERRED_MODELS);
    return legacy.length ? legacy : conf.groq;
  }
  const specific = parseList(envFor('GG_MODELS', tier));
  if (specific.length) return specific;
  const legacy = parseList(process.env.GG_PREFERRED_MODELS || process.env.GG_MODELS);
  return legacy.length ? legacy : conf.gemini;
}

const VALID_THINKING = ['MINIMAL', 'LOW', 'MEDIUM', 'HIGH'];

export function getThinkingLevel(tier = 'plan') {
  const fromEnv = String(envFor('AI_THINKING', tier) || '').toUpperCase();
  if (VALID_THINKING.includes(fromEnv)) return fromEnv;
  return (TIERS[tier] || TIERS.plan).thinking;
}

export function getGroqReasoningEffort(tier = 'plan') {
  return (TIERS[tier] || TIERS.plan).groqEffort;
}

export function getTierTimeoutMs(tier = 'plan') {
  return (TIERS[tier] || TIERS.plan).timeoutMs;
}

/**
 * Budget de temps GLOBAL d'une requête HTTP (une génération de plan enchaîne plusieurs
 * appels IA : génération + relecture, parfois 2 rounds de co-génération). Chaque appel
 * reçoit min(timeout du palier, temps restant) — on ne lance jamais un appel qui n'a
 * aucune chance de finir avant que Vercel coupe la fonction (300 s max sur le plan Hobby).
 */
export function createDeadline(totalMs = 280_000) {
  const endsAt = Date.now() + totalMs;
  return {
    endsAt,
    remainingMs: () => endsAt - Date.now(),
  };
}

export function snapshotConfig() {
  return Object.fromEntries(TIER_NAMES.map((tier) => [tier, {
    gemini: getModelCandidates('gemini', tier),
    groq: getModelCandidates('groq', tier),
    thinking: getThinkingLevel(tier),
    timeoutMs: getTierTimeoutMs(tier),
  }]));
}
