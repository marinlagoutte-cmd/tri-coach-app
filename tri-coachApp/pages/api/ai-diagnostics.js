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
import { checkRateLimit, RATE_LIMIT_MESSAGES } from '../../lib/rateLimit';

const GEMINI_CANDIDATES = (process.env.GG_PREFERRED_MODELS || process.env.GG_MODELS || 'gemini-3.1-flash-lite,gemini-3.5-flash')
  .split(',').map((s) => s.trim()).filter(Boolean);
const GROQ_CANDIDATES = (process.env.GROQ_PREFERRED_MODELS || 'openai/gpt-oss-120b,openai/gpt-oss-20b')
  .split(',').map((s) => s.trim()).filter(Boolean);

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

async function testGroqModel(model, apiKey) {
  const startedAt = Date.now();
  if (!apiKey) {
    return { provider: 'groq', model, ok: false, latencyMs: 0, error: 'GROQ_API_KEY manquante côté serveur.' };
  }
  try {
    const res = await withTimeout(
      fetch(GROQ_ENDPOINT, {
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
    return { provider: 'groq', model, ok: true, latencyMs: Date.now() - startedAt, sample: String(text).trim().slice(0, 200) };
  } catch (err) {
    return { provider: 'groq', model, ok: false, latencyMs: Date.now() - startedAt, error: err?.message || String(err) };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  // Rate limit léger : ce endpoint fait autant d'appels IA qu'il y a de modèles
  // candidats à chaque déclenchement (manuel, depuis Réglages → IA) — même garde-fou
  // que les autres routes IA (voir lib/rateLimit.js) pour éviter le spam.
  const { allowed, retryAfterSec } = checkRateLimit(req, { id: 'ai-diagnostics', limit: 6, windowMs: 60_000 });
  if (!allowed) {
    return res.status(200).json({ error: RATE_LIMIT_MESSAGES[req.body?.language] ? RATE_LIMIT_MESSAGES[req.body.language](retryAfterSec) : RATE_LIMIT_MESSAGES.fr(retryAfterSec) });
  }

  const geminiKey = getGeminiApiKey();
  const groqKey = process.env.GROQ_API_KEY;

  const results = await Promise.all([
    ...GEMINI_CANDIDATES.map((model) => testGeminiModel(model, geminiKey)),
    ...GROQ_CANDIDATES.map((model) => testGroqModel(model, groqKey)),
  ]);

  return res.status(200).json({ results, testedAt: new Date().toISOString() });
}
