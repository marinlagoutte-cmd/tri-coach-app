// lib/aiClient.js
//
// CLIENT IA UNIFIÉ (Gemini + Groq). Remplace callGeminiJSON/callGeminiText (lib/gemini.js)
// et callGroqJSON/callGroqText (lib/groq.js), qui envoyaient un unique bloc de texte au
// modèle, sans instruction système, sans schéma de sortie et avec un timeout de 25 s.
//
// Ce que ce client apporte à la QUALITÉ des réponses :
//   1. Instruction système séparée (persona + conventions stables) du contenu variable
//      (données de l'athlète) — les modèles suivent nettement mieux une consigne système.
//   2. Sortie structurée IMPOSÉE par schéma JSON quand un schéma est fourni :
//      Gemini → responseJsonSchema ; Groq → response_format json_schema strict (décodage
//      contraint). Plus de champs manquants, de types farfelus (objet à la place d'une
//      chaîne) ni de "type" hors énumération : toute une famille de garde-fous devient
//      superflue et le modèle consacre son "attention" au contenu, pas au format.
//   3. Niveau de réflexion par tâche (plan = medium, chat = low...) sur les modèles
//      Gemini 3.x, reasoning_effort sur gpt-oss (Groq).
//   4. Timeouts réalistes par tâche + budget de temps global (deadline) : on ne démarre
//      jamais un appel qui ne pourrait pas finir avant la coupure Vercel.
//   5. Replis gracieux : schéma refusé → réessai sans schéma ; réflexion refusée → réessai
//      sans ; modèle indisponible → modèle suivant.

import { GoogleGenAI } from '@google/genai';
import { getModelCandidates, getThinkingLevel, getGroqReasoningEffort, getTierTimeoutMs } from './aiConfig';

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const MIN_USEFUL_MS = 8_000; // en dessous, inutile de lancer un appel

// ---------------------------------------------------------------------------------------
// Utilitaires communs
// ---------------------------------------------------------------------------------------

function makeError(message, code, extra = {}) {
  const err = new Error(message);
  err.code = code;
  Object.assign(err, extra);
  return err;
}

/**
 * Extraction JSON tolérante : JSON pur, bloc ```json ... ```, ou premier objet {...}
 * équilibré trouvé dans le texte (en tenant compte des chaînes et des échappements).
 */
export function extractJson(text) {
  const raw = String(text ?? '').trim();
  if (!raw) throw makeError('Réponse IA vide', 'PARSE_ERROR');
  try {
    return JSON.parse(raw);
  } catch (_) { /* on continue */ }

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try { return JSON.parse(fenced[1].trim()); } catch (_) { /* on continue */ }
  }

  const start = raw.indexOf('{');
  if (start !== -1) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < raw.length; i += 1) {
      const c = raw[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') inString = true;
      else if (c === '{') depth += 1;
      else if (c === '}') {
        depth -= 1;
        if (depth === 0) {
          try { return JSON.parse(raw.slice(start, i + 1)); } catch (_) { break; }
        }
      }
    }
  }
  throw makeError('Réponse IA non parseable en JSON', 'PARSE_ERROR');
}

/** Classe une erreur brute dans une catégorie stable (voir ERROR_MESSAGES des routes API). */
export function classifyError(err) {
  if (err?.code && ['NO_KEY', 'PARSE_ERROR', 'NETWORK', 'SAFETY', 'TRUNCATED', 'BUDGET'].includes(err.code)) return err.code;
  const msg = String(err?.message || err || '').toLowerCase();
  const status = Number(err?.status || err?.response?.status || (typeof err?.code === 'number' ? err.code : NaN));
  if (status === 401 || status === 403 || /api key not valid|permission.denied|unauthenticated|invalid.*api.?key|unauthorized/.test(msg)) return 'AUTH';
  if (status === 429 || /quota|rate.?limit|resource.?exhausted|too many requests/.test(msg)) return 'QUOTA';
  if (status === 413 || /request too large|context length|too many tokens/.test(msg)) return 'TOO_LARGE';
  if (status === 404 || /not found|model.*not.*(exist|found)|unknown model|decommissioned/.test(msg)) return 'MODEL_NOT_FOUND';
  if (/safety|blocked|prohibited|content.?filter/.test(msg)) return 'SAFETY';
  if (/timeout|timed out|econnreset|enotfound|network|fetch failed|abort|délai dépassé/.test(msg)) return 'NETWORK';
  if (status === 400) return 'BAD_REQUEST';
  if (status >= 500) return 'SERVER';
  return 'UNKNOWN';
}

function effectiveTimeout(tier, deadline) {
  const tierMs = getTierTimeoutMs(tier);
  if (!deadline) return tierMs;
  const remaining = deadline.remainingMs() - 2_000;
  if (remaining < MIN_USEFUL_MS) {
    throw makeError('Budget de temps épuisé pour cette requête', 'BUDGET');
  }
  return Math.min(tierMs, remaining);
}

async function withAbortTimeout(fn, ms, label) {
  const controller = new AbortController();
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(makeError(`Délai dépassé (${label}, ${Math.round(ms / 1000)} s)`, 'NETWORK'));
    }, ms);
  });
  try {
    return await Promise.race([fn(controller.signal), timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Adapte un schéma au mode "strict" de Groq : chaque objet doit lister TOUTES ses
 * propriétés dans `required` et interdire les propriétés supplémentaires. Nos schémas
 * (lib/planSchema.js) sont déjà écrits ainsi ; cette passe est un filet de sécurité.
 */
export function toStrictSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(toStrictSchema);
  const out = { ...schema };
  if (out.type === 'object' && out.properties) {
    out.properties = Object.fromEntries(Object.entries(out.properties).map(([k, v]) => [k, toStrictSchema(v)]));
    out.required = Object.keys(out.properties);
    out.additionalProperties = false;
  }
  if (out.items) out.items = toStrictSchema(out.items);
  if (out.anyOf) out.anyOf = out.anyOf.map(toStrictSchema);
  return out;
}

// ---------------------------------------------------------------------------------------
// Gemini
// ---------------------------------------------------------------------------------------

function getGeminiApiKey() {
  return process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
}

let geminiClient = null;
function getGeminiClient() {
  if (geminiClient) return geminiClient;
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw makeError('Clé API Gemini manquante. Définis GEMINI_API_KEY dans .env.local (ou dans Vercel → Settings → Environment Variables).', 'NO_KEY');
  }
  geminiClient = new GoogleGenAI({ apiKey });
  return geminiClient;
}

/** Réservé aux tests : force la recréation du client (ex. après changement de clé). */
export function __resetGeminiClientForTests() { geminiClient = null; }

function supportsThinkingLevel(model) {
  return /^gemini-3/i.test(model);
}

async function callGeminiModel(model, { system, prompt, schema, json, tier, signal, useSchema, useThinking }) {
  const client = getGeminiClient();
  const config = { abortSignal: signal };
  if (system) config.systemInstruction = system;
  if (json) {
    config.responseMimeType = 'application/json';
    if (schema && useSchema) config.responseJsonSchema = schema;
  }
  if (useThinking && supportsThinkingLevel(model)) {
    config.thinkingConfig = { thinkingLevel: getThinkingLevel(tier) };
  }
  const response = await client.models.generateContent({ model, contents: prompt, config });
  const finish = response?.candidates?.[0]?.finishReason;
  const text = response?.text;
  if (!text) {
    if (finish && /SAFETY|PROHIBITED|BLOCKLIST|SPII/.test(finish)) throw makeError(`Réponse bloquée (${finish})`, 'SAFETY');
    throw makeError(`Réponse Gemini vide${finish ? ` (${finish})` : ''}`, 'PARSE_ERROR');
  }
  if (finish === 'MAX_TOKENS' && json) {
    // JSON tronqué : on tente quand même de le parser, sinon erreur explicite.
    try { return extractJson(text); } catch (_) { throw makeError('Réponse Gemini tronquée (MAX_TOKENS)', 'TRUNCATED'); }
  }
  return json ? extractJson(text) : String(text).trim();
}

async function callGemini({ tier, system, prompt, schema, json, deadline }) {
  const candidates = getModelCandidates('gemini', tier);
  let lastError = null;
  for (const model of candidates) {
    let useSchema = Boolean(schema);
    let useThinking = true;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const ms = effectiveTimeout(tier, deadline);
        const result = await withAbortTimeout(
          (signal) => callGeminiModel(model, { system, prompt, schema, json, tier, signal, useSchema, useThinking }),
          ms,
          model
        );
        return { result, model, provider: 'gemini' };
      } catch (err) {
        const code = classifyError(err);
        err.code = code;
        lastError = err;
        const msg = String(err?.message || '').toLowerCase();
        console.warn(`[ai:gemini] ${model} [${code}] :`, err?.message || err);
        if (code === 'NO_KEY' || code === 'AUTH' || code === 'BUDGET') throw err;
        // Requête refusée à cause d'une option (schéma, niveau de réflexion) : même modèle, sans l'option.
        if (code === 'BAD_REQUEST' && useSchema && /schema|response_?json|mime/.test(msg)) { useSchema = false; continue; }
        if (code === 'BAD_REQUEST' && useThinking && /thinking/.test(msg)) { useThinking = false; continue; }
        // JSON malformé malgré tout : un 2e essai sur le même modèle vaut le coup une fois.
        if ((code === 'PARSE_ERROR' || code === 'TRUNCATED') && attempt === 0) continue;
        break; // modèle suivant
      }
    }
  }
  throw makeError(
    `Aucun modèle Gemini disponible (${candidates.join(', ')}). Détail : ${lastError?.message || 'inconnu'}`,
    lastError?.code || 'UNKNOWN'
  );
}

// ---------------------------------------------------------------------------------------
// Groq (API compatible OpenAI)
// ---------------------------------------------------------------------------------------

function isGptOss(model) {
  return /gpt-oss/i.test(model);
}

async function callGroqModel(model, { system, prompt, schema, json, tier, signal, format }) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw makeError('Clé API Groq manquante. Définis GROQ_API_KEY (clé gratuite sur https://console.groq.com/keys).', 'NO_KEY');
  }
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });
  const body = { model, messages, temperature: json ? 0.5 : 0.7 };
  if (isGptOss(model)) body.reasoning_effort = getGroqReasoningEffort(tier);
  if (json) {
    body.response_format = format === 'schema' && schema
      ? { type: 'json_schema', json_schema: { name: 'tri_coach_output', strict: true, schema: toStrictSchema(schema) } }
      : { type: 'json_object' };
  }
  const res = await fetch(GROQ_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    throw makeError(`Groq HTTP ${res.status}: ${bodyText.slice(0, 300)}`, undefined, { status: res.status });
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw makeError('Réponse Groq vide', 'PARSE_ERROR');
  return json ? extractJson(text) : String(text).trim();
}

async function callGroq({ tier, system, prompt, schema, json, deadline }) {
  const candidates = getModelCandidates('groq', tier);
  let lastError = null;
  for (const model of candidates) {
    let format = schema ? 'schema' : 'object';
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const ms = effectiveTimeout(tier, deadline);
        const result = await withAbortTimeout(
          (signal) => callGroqModel(model, { system, prompt, schema, json, tier, signal, format }),
          ms,
          model
        );
        return { result, model, provider: 'groq' };
      } catch (err) {
        const code = classifyError(err);
        err.code = code;
        lastError = err;
        console.warn(`[ai:groq] ${model} [${code}] :`, err?.message || err);
        if (code === 'NO_KEY' || code === 'AUTH' || code === 'BUDGET') throw err;
        // Schéma strict refusé (ou "Generated JSON does not match the expected schema") :
        // on retombe en mode json_object, le schéma reste décrit dans le prompt.
        if ((code === 'BAD_REQUEST' || code === 'PARSE_ERROR') && format === 'schema') { format = 'object'; continue; }
        if (code === 'PARSE_ERROR' && attempt === 0) continue;
        break;
      }
    }
  }
  throw makeError(
    `Aucun modèle Groq disponible (${candidates.join(', ')}). Détail : ${lastError?.message || 'inconnu'}`,
    lastError?.code || 'UNKNOWN'
  );
}

// ---------------------------------------------------------------------------------------
// Point d'entrée
// ---------------------------------------------------------------------------------------

/**
 * Appel IA générique.
 * @param {object} opts
 * @param {'gemini'|'groq'} [opts.provider='gemini']
 * @param {'plan'|'review'|'chat'|'light'} [opts.tier='plan']
 * @param {string} [opts.system]   instruction système (persona + conventions)
 * @param {string} opts.prompt     contenu variable (données, demande)
 * @param {object} [opts.schema]   schéma JSON de sortie (active la sortie structurée)
 * @param {boolean} [opts.json=true]
 * @param {object} [opts.deadline] voir createDeadline (lib/aiConfig.js)
 * @param {boolean} [opts.withMeta=false] renvoie { result, model, provider } au lieu du seul résultat
 */
export async function callAI({ provider = 'gemini', tier = 'plan', system, prompt, schema, json = true, deadline, withMeta = false }) {
  const fn = provider === 'groq' ? callGroq : callGemini;
  const out = await fn({ tier, system, prompt, schema, json, deadline });
  return withMeta ? out : out.result;
}
