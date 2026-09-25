// lib/groq.js
//
// Adaptateur RÉTRO-COMPATIBLE. Toute la logique d'appel Groq (sortie structurée stricte,
// reasoning_effort, timeouts par tâche, repli json_object) vit désormais dans
// lib/aiClient.js, partagée avec Gemini. Ces deux fonctions restent exportées pour ne
// casser aucun import existant.
//
// Clé gratuite : https://console.groq.com/keys — variable GROQ_API_KEY.

import { callAI } from './aiClient';

export async function callGroqJSON(prompt, { tier = 'plan', system, schema, deadline } = {}) {
  return callAI({ provider: 'groq', tier, system, prompt, schema, json: true, deadline });
}

export async function callGroqText(prompt, { tier = 'light', system, deadline } = {}) {
  return callAI({ provider: 'groq', tier, system, prompt, json: false, deadline });
}
