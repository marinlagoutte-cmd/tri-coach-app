import { GoogleGenAI } from '@google/genai';
import { DAYS_OF_WEEK } from './defaults';
import { enrichWorkoutMetrics, getIncompleteWorkouts, validateWorkout, checkWorkoutCoherence, sanitizeWorkout } from './workouts';

// Modèles actuels valides (vérifie la liste à jour sur https://ai.google.dev/gemini-api/docs/models si besoin)
const DEFAULT_CANDIDATES = ['gemini-3.5-flash', 'gemini-3.1-flash-lite'];
const MAX_RETRIES = 2;
const CALL_TIMEOUT_MS = 25_000; // sécurité : évite qu'une requête reste bloquée indéfiniment sur Vercel

function getApiKey() {
  return (
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY
  );
}

let _client = null;
function getClient() {
  if (_client) return _client;
  const apiKey = getApiKey();
  if (!apiKey) {
    const err = new Error('Clé API Gemini manquante. Définis GEMINI_API_KEY dans .env.local (ou dans Vercel → Settings → Environment Variables).');
    err.code = 'NO_KEY';
    throw err;
  }
  _client = new GoogleGenAI({ apiKey });
  return _client;
}

function getCandidateModels() {
  const envList = process.env.GG_PREFERRED_MODELS || process.env.GG_MODELS;
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
        const parseErr = new Error('Réponse IA non parseable en JSON (extraction échouée)');
        parseErr.code = 'PARSE_ERROR';
        throw parseErr;
      }
    }
    const parseErr = new Error('Réponse IA non parseable en JSON');
    parseErr.code = 'PARSE_ERROR';
    throw parseErr;
  }
}

/**
 * Classe une erreur brute (SDK, réseau, HTTP...) dans une catégorie stable
 * pour qu'on puisse réagir correctement côté API (pages/api/*.js).
 */
function classifyError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  const status = err?.status || err?.code || err?.response?.status;

  if (status === 401 || status === 403 || /api key not valid|permission.denied|unauthenticated|invalid.*api.?key/i.test(msg)) {
    return 'AUTH';
  }
  if (status === 429 || /quota|rate.?limit|resource.?exhausted|429/i.test(msg)) {
    return 'QUOTA';
  }
  if (status === 404 || /not found|404|model.*not.*found|unknown model/i.test(msg)) {
    return 'MODEL_NOT_FOUND';
  }
  if (/safety|blocked|content.?filter/i.test(msg)) {
    return 'SAFETY';
  }
  if (/timeout|econnreset|enotfound|network|fetch failed|abort/i.test(msg)) {
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

async function callGeminiJSON(prompt) {
  const client = getClient();
  const candidates = getCandidateModels();
  let lastError = null;

  for (const model of candidates) {
    try {
      const response = await withTimeout(
        client.models.generateContent({
          model,
          contents: prompt,
          config: { responseMimeType: 'application/json' },
        }),
        CALL_TIMEOUT_MS,
        model
      );
      return extractJson(response.text);
    } catch (err) {
      const code = err.code === 'PARSE_ERROR' ? 'PARSE_ERROR' : classifyError(err);
      lastError = err;
      lastError.code = code;
      console.warn(`[gemini] Modèle "${model}" indisponible [${code}] :`, err?.message || err);

      // Une erreur d'authentification ou de quota concerne TOUTE la clé API,
      // pas un modèle en particulier : inutile d'essayer les autres candidats.
      if (code === 'AUTH' || code === 'QUOTA') break;
    }
  }

  const label = candidates.join(', ');
  const finalErr = new Error(
    `Aucun modèle disponible parmi les candidats: ${label}. Détails: ${lastError?.message || 'inconnu'}`
  );
  finalErr.code = lastError?.code || 'UNKNOWN';
  console.error('[gemini] Échec complet callGeminiJSON:', {
    code: finalErr.code,
    candidates,
    lastError: lastError?.message,
  });
  throw finalErr;
}

const WORKOUT_SCHEMA = `
Chaque séance DOIT contenir exactement ces champs, jamais vides :
id, day (Lundi-Dimanche), type (NATATION/SWIM|CYCLISME/BIKE|C.A.P/RUN|ENCHAÎNEMENT/BRICK|REPOS),
title, duration, desc, modified (boolean), et selon la discipline :
- RUN : intensity = allure km/h, effortZone = zone d'effort (Z1-Z5), avgBpm = BPM moyen estimé.
- BIKE : intensity = watts cible, rpe = effort ressenti (RPE x/10), cardio = zone FC + bpm moyen.
- SWIM : intensity = allure /100m, effortZone = zone d'effort.
- Tous : restTime = temps de repos entre répétitions (ex: "1'30 entre les séries") ou "-" si continu/repos.
Les valeurs DOIVENT rester physiologiquement réalistes par rapport au profil fourni (VMA, FTP, allure CSS, FC max/repos) : ne jamais halluciner des watts/BPM/allures incohérents.
Jours obligatoires : ${DAYS_OF_WEEK.join(', ')} — exactement 7 séances par semaine, une par jour (sauf ajout explicite d'une séance double).
`;

function describeGoal(wizardData) {
  if (wizardData.sportType === 'running') {
    if (wizardData.runningSubtype === 'trail') {
      return `Trail de ${wizardData.trailKm || '?'} km avec ${wizardData.trailElevation || '?'} m D+.`;
    }
    return `Course à pied sur route : ${wizardData.distance}.`;
  }
  const d = wizardData.customDistances || {};
  return `Triathlon format ${wizardData.triathlonFormat} (natation ${d.swim}km / vélo ${d.bike}km / course ${d.run}km).`;
}

function describeTargetTime(wizardData) {
  if (wizardData.sportType === 'triathlon') {
    const t = wizardData.triathlonTimes || {};
    return `Objectif par discipline — natation: ${t.swim || '?'}, transitions: ${t.transition_t1 || '?'} + ${t.transition_t2 || '?'}, vélo: ${t.bike || '?'}, course: ${t.run || '?'}, temps global visé: ${t.total || '?'}.`;
  }
  return `Chrono cible: ${wizardData.targetTime || '?'}.`;
}

export async function generatePlanWithAI({ wizardData, profile }) {
  const goalDescription = describeGoal(wizardData);
  const timeDescription = describeTargetTime(wizardData);

  const prompt = `Tu es un coach triathlon/course à pied expert. Génère un plan d'entraînement JSON strict.

Athlète : genre ${wizardData.gender}, poids ${wizardData.weight || profile.weight}kg, niveau de forme ${wizardData.fitnessLevel}/5.
Profil physiologique : VMA ${profile.vma} km/h, FTP ${profile.ftp}W, allure natation CSS ${profile.nat100}/100m.

Objectif : ${goalDescription}
${timeDescription}
Date de l'objectif : ${wizardData.targetDate}

Disponibilités : ~${wizardData.hoursPerWeek}h/semaine réparties sur environ ${wizardData.maxSessionsPerWeek} séances/semaine. Repos obligatoire le ${wizardData.offDays}.

${WORKOUT_SCHEMA}

Réponds UNIQUEMENT avec ce JSON :
{
  "trainingPlan": {
    "title": "string",
    "date": "YYYY-MM-DD",
    "startDate": "YYYY-MM-DD",
    "targetTime": "string",
    "splits": { "nat": "string", "bike": "string", "run": "string" },
    "terrain": "string",
    "drafting": false,
    "cycles": [{ "id": 1, "name": "string", "dates": "string", "status": "En cours|Terminé|À venir" }]
  },
  "workouts": {
    "N": [ /* 7 séances semaine en cours */ ],
    "N+1": [ /* 7 séances semaine suivante */ ]
  }
}
`;

  let data = await callGeminiJSON(prompt);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    // DOUBLE CHECK : enrichissement + contrôle de cohérence physiologique avant tout affichage
    const enriched = {
      N: (data.workouts?.N || []).map((w) => sanitizeWorkout(w, profile)),
      'N+1': (data.workouts?.['N+1'] || []).map((w) => sanitizeWorkout(w, profile)),
    };
    const incomplete = getIncompleteWorkouts(enriched);
    if (incomplete.length === 0) {
      return { trainingPlan: data.trainingPlan, workouts: enriched };
    }
    const fixPrompt = `Complète ces séances incomplètes. Champs manquants : ${JSON.stringify(incomplete)}
Séances actuelles : ${JSON.stringify(enriched)}
${WORKOUT_SCHEMA}
Réponds avec : { "workouts": { "N": [...], "N+1": [...] } }`;
    const fixData = await callGeminiJSON(fixPrompt);
    data = { ...data, workouts: fixData.workouts || data.workouts };
  }

  const final = {
    N: (data.workouts?.N || []).map((w) => sanitizeWorkout(w, profile)),
    'N+1': (data.workouts?.['N+1'] || []).map((w) => sanitizeWorkout(w, profile)),
  };
  return { trainingPlan: data.trainingPlan, workouts: final };
}

export async function chatWithCoach({ message, profile, workouts, trainingPlan, intent }) {
  const intentInstruction = intent === 'add'
    ? `L'athlète veut AJOUTER une séance supplémentaire, PAS remplacer une séance existante. Chaque patch doit avoir "patchMode": "add" et un "id" nouveau (jamais l'id d'une séance existante).`
    : intent === 'modify'
      ? `L'athlète veut MODIFIER une séance existante. Chaque patch doit avoir "patchMode": "modify" et reprendre le "id" ou le "day" exact de la séance visée.`
      : `Déduis toi-même s'il s'agit d'un ajout ("patchMode": "add") ou d'une modification ("patchMode": "modify") d'après le message.`;

  const prompt = `Tu es TRI COACH, coach triathlon personnel. Réponds en français, ton motivant et concis.
Profil : ${JSON.stringify(profile)}
Plan : ${JSON.stringify(trainingPlan)}
Séances actuelles : ${JSON.stringify(workouts)}
Message athlète : "${message}"
${WORKOUT_SCHEMA}
${intentInstruction}
Si l'athlète demande un ajustement (décaler, alléger, remplacer, douleur, séance en plus, etc.),
renvoie des patches ciblés avec TOUS les champs remplis. Sinon patches vide.
Réponds UNIQUEMENT avec :
{
  "reply": "réponse coach concise et motivante",
  "patches": [ /* chaque patch inclut patchMode: "add"|"modify" */ ]
}`;

  const data = await callGeminiJSON(prompt);
  if (data.patches?.length) {
    for (const patch of data.patches) {
      // DOUBLE CHECK : cohérence physiologique systématique avant application/affichage
      const enrichedPatch = sanitizeWorkout(patch, profile);
      const check = validateWorkout(enrichedPatch);
      Object.assign(patch, enrichedPatch);
      if (!check.valid) {
        patch.cadence = patch.cadence || '85-95 rpm';
        patch.cardio = patch.cardio || 'Z2-Z3';
        patch.rpe = patch.rpe || 'RPE 6/10';
        patch.intensity = patch.intensity || '75% FTP';
        patch.duration = patch.duration || '45 min';
        patch.desc = patch.desc || 'Séance ajustée par le coach.';
      }
    }
  }
  return {
    reply: data.reply || "J'ai bien pris en compte ta demande.",
    patches: data.patches || [],
  };
}
