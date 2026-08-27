// Appelant Groq (gratuit) pour la co-génération — même contrat d'interface que
// callGeminiJSON dans lib/gemini.js : callGroqJSON(prompt) -> objet JS parsé.
// Groq expose une API REST compatible OpenAI (pas besoin du SDK openai, un simple
// fetch suffit) : https://api.groq.com/openai/v1/chat/completions
//
// Clé gratuite : https://console.groq.com/keys (aucune carte bancaire requise pour
// démarrer, quotas généreux en tier gratuit).

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
// Ordre de préférence : le premier dispo/dans le quota gagne. On garde un modèle
// "versatile" (meilleure qualité) en premier et un plus petit/rapide en repli.
const DEFAULT_CANDIDATES = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];
const CALL_TIMEOUT_MS = 25_000;

function getApiKey() {
  return process.env.GROQ_API_KEY;
}

function getCandidateModels() {
  const envList = process.env.GROQ_PREFERRED_MODELS;
  return envList ? envList.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_CANDIDATES;
}

function extractJson(text) {
  const raw = String(text).trim();
  try {
    return JSON.parse(raw);
  } catch (e) {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (err) {
        const parseErr = new Error('Réponse Groq non parseable en JSON (extraction échouée)');
        parseErr.code = 'PARSE_ERROR';
        throw parseErr;
      }
    }
    const parseErr = new Error('Réponse Groq non parseable en JSON');
    parseErr.code = 'PARSE_ERROR';
    throw parseErr;
  }
}

// Même logique de classification que classifyError() dans lib/gemini.js, adaptée
// aux codes/messages renvoyés par l'API Groq (format d'erreur proche d'OpenAI).
function classifyError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  const status = err?.status;

  if (status === 401 || status === 403 || /invalid api key|unauthorized|authentication/i.test(msg)) {
    return 'AUTH';
  }
  if (status === 429 || /quota|rate.?limit|429/i.test(msg)) {
    return 'QUOTA';
  }
  if (status === 404 || /not found|404|does not exist|decommissioned/i.test(msg)) {
    return 'MODEL_NOT_FOUND';
  }
  if (/timeout|econnreset|enotfound|network|fetch failed|abort|délai dépassé/i.test(msg)) {
    return 'NETWORK';
  }
  return 'UNKNOWN';
}

function withTimeout(promise, ms, label) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const err = new Error(`Délai dépassé (${label})`);
      err.code = 'NETWORK';
      reject(err);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

async function callOnce(model, prompt, apiKey, { json = true } = {}) {
  const res = await fetch(GROQ_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      ...(json ? { response_format: { type: 'json_object' } } : {}),
      temperature: 0.7,
    }),
  });

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    const err = new Error(`Groq HTTP ${res.status}: ${bodyText.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) {
    const err = new Error('Réponse Groq vide (pas de contenu dans choices[0].message.content)');
    err.code = 'PARSE_ERROR';
    throw err;
  }
  return json ? extractJson(text) : String(text).trim();
}

// Boucle commune candidats/erreurs, partagée par callGroqJSON et callGroqText (seul le
// mode json/texte et le message d'erreur final diffèrent).
async function callWithCandidates(prompt, { json }) {
  const apiKey = getApiKey();
  if (!apiKey) {
    const err = new Error('Clé API Groq manquante. Définis GROQ_API_KEY dans .env.local (ou dans Vercel → Settings → Environment Variables). Clé gratuite sur https://console.groq.com/keys');
    err.code = 'NO_KEY';
    throw err;
  }

  const candidates = getCandidateModels();
  let lastError = null;

  for (const model of candidates) {
    try {
      return await withTimeout(callOnce(model, prompt, apiKey, { json }), CALL_TIMEOUT_MS, model);
    } catch (err) {
      const code = (err.code === 'PARSE_ERROR' || err.code === 'NETWORK') ? err.code : classifyError(err);
      lastError = err;
      lastError.code = code;
      console.warn(`[groq] Modèle "${model}" indisponible [${code}] :`, err?.message || err);
      if (code === 'AUTH') break;
    }
  }

  const label = candidates.join(', ');
  const finalErr = new Error(
    `Aucun modèle Groq disponible parmi les candidats: ${label}. Détails: ${lastError?.message || 'inconnu'}`
  );
  finalErr.code = lastError?.code || 'UNKNOWN';
  console.error(`[groq] Échec complet ${json ? 'callGroqJSON' : 'callGroqText'}:`, {
    code: finalErr.code,
    candidates,
    lastError: lastError?.message,
  });
  throw finalErr;
}

export async function callGroqJSON(prompt) {
  return callWithCandidates(prompt, { json: true });
}

// Pendant du callGeminiText de lib/gemini.js — même contrat (prompt -> texte brut),
// utilisé pour la co-génération des conseils nutrition et des réponses du chat, qui ne
// sont pas du JSON structuré (contrairement aux séances). AJOUTÉ : le double-check
// Gemini + Groq ne couvrait jusqu'ici que la génération de plan (JSON) — l'onglet
// Nutrition et le chat "libre" n'appelaient QUE Gemini, ce endpoint texte manquait.
export async function callGroqText(prompt) {
  return callWithCandidates(prompt, { json: false });
}
