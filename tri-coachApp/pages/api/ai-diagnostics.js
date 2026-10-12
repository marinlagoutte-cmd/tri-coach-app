// pages/api/ai-diagnostics.js
//
// Endpoint de DIAGNOSTIC IA, dédié au panneau Réglages → IA (voir
// components/AiDiagnosticsModal.js) — demande explicite de l'athlète : les erreurs
// techniques du double-check Gemini+Groq (ex. "Double-check indisponible cette fois...")
// ne doivent plus jamais apparaître ailleurs dans l'app, mais il doit rester possible de
// tester manuellement chaque modèle candidat et de voir lequel répond / est en bug.
//
// Contrairement à lib/gemini.js:callGeminiJSON et lib/groq.js:callGroqJSON (qui essaient
// les candidats un par un et s'arrêtent au premier qui répond), on teste ICI CHAQUE
// modèle INDIVIDUELLEMENT et en parallèle, pour voir l'état de TOUS les candidats d'un
// coup — c'est tout l'intérêt du diagnostic (ex: voir qu'un modèle candidat est
// décommissionné même si un autre répond très bien).
//
// MAJ 2026-08 : llama-3.3-70b-versatile et llama-3.1-8b-instant ont été
// décommissionnés par Groq (annonce du 17/06/2026, arrêt effectif ~08/2026,
// cf. le 404 model_not_found remonté par le diagnostic). Remplacés par les
// modèles recommandés par Groq : https://console.groq.com/docs/deprecations
import { GoogleGenAI } from '@google/genai';
import { guardAiRoute } from '../../lib/aiGuard';
import { explainModelError, markModelUnavailable, PERMANENT_CODES } from '../../lib/aiAvailability';
import { TIER_NAMES, getModelCandidates, snapshotConfig } from '../../lib/aiConfig';

// MAJ 09/2026 : les candidats viennent de la configuration centralisée (lib/aiConfig.js),
// qui définit une liste par TÂCHE (plan, relecture, chat, tâches légères). On teste
// l'union dédupliquée de toutes ces listes, et on renvoie aussi la configuration résolue
// pour voir d'un coup d'œil quel modèle sert à quoi.
function uniq(list) {
  return [...new Set(list)];
}
const GEMINI_CANDIDATES = uniq(TIER_NAMES.flatMap((tier) => getModelCandidates('gemini', tier)));
const GROQ_CANDIDATES = uniq(TIER_NAMES.flatMap((tier) => getModelCandidates('groq', tier)));

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
// Prompt minimal exprès (pas de vrai prompt d'entraînement) : ce endpoint sert à vérifier
// la CONNECTIVITÉ/DISPONIBILITÉ d'un modèle, pas la qualité de ses réponses coaching.
const TEST_PROMPT = 'Réponds uniquement par ce JSON exact, sans aucun autre texte : {"status":"ok"}';
const TIMEOUT_MS = 15_000;

function withTimeout(promise, ms) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`Délai dépassé (${ms}ms)`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

function getGeminiApiKey() {
  return (
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY
  );
}

async function testGeminiModel(model, apiKey) {
  const startedAt = Date.now();
  if (!apiKey) {
    return { provider: 'gemini', model, ok: false, latencyMs: 0, error: 'GEMINI_API_KEY manquante côté serveur.' };
  }
  try {
    const client = new GoogleGenAI({ apiKey });
    const response = await withTimeout(
      client.models.generateContent({
        model,
        contents: TEST_PROMPT,
        config: { responseMimeType: 'application/json' },
      }),
      TIMEOUT_MS
    );
    return {
      provider: 'gemini',
      model,
      ok: true,
      latencyMs: Date.now() - startedAt,
      sample: String(response?.text || '').trim().slice(0, 200),
    };
  } catch (err) {
    return {
      provider: 'gemini',
      model,
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: err?.message || String(err),
    };
  }
}

const MISTRAL_ENDPOINT = 'https://api.mistral.ai/v1/chat/completions';
const MISTRAL_CANDIDATES = uniq(TIER_NAMES.flatMap((tier) => getModelCandidates('mistral', tier)));

async function testGroqModel(model, apiKey, provider = 'groq') {
  const startedAt = Date.now();
  const endpoint = provider === 'mistral' ? MISTRAL_ENDPOINT : GROQ_ENDPOINT;
  const keyName = provider === 'mistral' ? 'MISTRAL_API_KEY' : 'GROQ_API_KEY';
  if (!apiKey) {
    return { provider, model, ok: false, latencyMs: 0, error: `${keyName} manquante côté serveur${provider === 'mistral' ? ' (secours optionnel)' : ''}.` };
  }
  try {
    const res = await withTimeout(
      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: TEST_PROMPT }],
          response_format: { type: 'json_object' },
          temperature: 0,
        }),
      }),
      TIMEOUT_MS
    );
    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${bodyText.slice(0, 300)}`);
    }
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (!text) throw new Error('Réponse vide (pas de contenu dans choices[0].message.content).');
    return { provider, model, ok: true, latencyMs: Date.now() - startedAt, sample: String(text).trim().slice(0, 200) };
  } catch (err) {
    return { provider, model, ok: false, latencyMs: Date.now() - startedAt, error: err?.message || String(err) };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  // Rate limit léger : ce endpoint fait autant d'appels IA qu'il y a de modèles
  // candidats à chaque déclenchement (manuel, depuis Réglages → IA) — même garde-fou
  // que les autres routes IA (voir lib/rateLimit.js) pour éviter le spam.
  // Authentification + limite par compte + quota quotidien (lib/aiGuard.js).
  const { allowed, retryAfterSec, message: guardMessage, status: guardStatus } = await guardAiRoute(req, { id: 'ai-diagnostics', limit: 6, windowMs: 60_000 });
  if (!allowed) {
    return res.status(200).json({ error: guardMessage });
  }

  const geminiKey = getGeminiApiKey();
  const groqKey = process.env.GROQ_API_KEY;

  const mistralKey = process.env.MISTRAL_API_KEY;
  const raw = await Promise.all([
    ...GEMINI_CANDIDATES.map((model) => testGeminiModel(model, geminiKey)),
    ...GROQ_CANDIDATES.map((model) => testGroqModel(model, groqKey)),
    ...(mistralKey ? MISTRAL_CANDIDATES.map((model) => testGroqModel(model, mistralKey, 'mistral')) : []),
  ]);
  // CORRECTIF : sans clé, Mistral n'apparaissait pas du tout (impossible de distinguer
  // « clé absente » de « Mistral en panne »). Une ligne explicite est désormais renvoyée.
  if (!mistralKey) {
    raw.push({ provider: 'mistral', model: 'MISTRAL_API_KEY', ok: false, latencyMs: 0, error: 'Clé MISTRAL_API_KEY absente côté serveur.' });
  }
  // Cause lisible de chaque échec + mise à l'écart des modèles indisponibles (même instance).
  const results = raw.map((r) => {
    if (r.ok) return r;
    const reason = explainModelError(r.error);
    if (reason.code === 'NOT_FOUND' || reason.code === 'NO_FREE_QUOTA') markModelUnavailable(r.provider, r.model, reason.code);
    return { ...r, reason };
  });

  // Ce que l'app utilisera RÉELLEMENT : pour chaque tâche et chaque fournisseur, le premier
  // modèle de la liste qui a répondu (l'app essaie la liste dans l'ordre).
  const config = snapshotConfig();
  const okSet = new Set(results.filter((r) => r.ok).map((r) => `${r.provider}:${r.model}`));
  const providers = [['gemini', 'GG_MODELS'], ['groq', 'GROQ_MODELS'], ['mistral', 'MISTRAL_MODELS']];
  const summary = TIER_NAMES.map((tier) => ({
    tier,
    ...Object.fromEntries(providers.map(([prov]) => [prov, (config[tier][prov] || []).find((m) => okSet.has(`${prov}:${m}`)) || null])),
  }));
  // Configuration recommandée (facultative) : retirer UNIQUEMENT les modèles durablement
  // indisponibles (inexistants pour la clé, sans quota gratuit). CORRECTIF : la première
  // version retirait aussi les modèles en panne passagère (surcharge 5xx, délai) — sur le
  // diagnostic réel, elle conseillait d'abandonner gemini-3.8-flash pour une surcharge
  // momentanée. Les pannes passagères sont gérées automatiquement (mise à l'écart 10 min).
  const permanentSet = new Set(results.filter((r) => !r.ok && PERMANENT_CODES.includes(r.reason?.code)).map((r) => `${r.provider}:${r.model}`));
  const recommendedEnv = [];
  TIER_NAMES.forEach((tier) => {
    providers.forEach(([prov, prefix]) => {
      const list = config[tier][prov] || [];
      const kept = list.filter((m) => !permanentSet.has(`${prov}:${m}`));
      if (kept.length && kept.length < list.length) recommendedEnv.push(`${prefix}_${tier.toUpperCase()}=${kept.join(',')}`);
    });
  });

  return res.status(200).json({
    results,
    summary,
    recommendedEnv,
    mistralConfigured: Boolean(mistralKey),
    config,
    legacyOverride: Boolean(process.env.GG_PREFERRED_MODELS || process.env.GROQ_PREFERRED_MODELS),
    testedAt: new Date().toISOString(),
  });
}
