import { GoogleGenerativeAI } from '@google/generative-ai';
import { DAYS_OF_WEEK } from './defaults';
import { enrichWorkoutMetrics, getIncompleteWorkouts, validateWorkout } from './workouts';
const MODEL = 'gemini-1.5-flash';
const MAX_RETRIES = 2;
function getApiKey() {
  return (
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY
  );
}
function getModel() {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('Clé API Gemini manquante. Définis GOOGLE_GENERATIVE_AI_API_KEY sur Vercel.');
  }
  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({
    model: MODEL,
    generationConfig: { responseMimeType: 'application/json' },
  });
}
function extractJson(text) {
  const raw = text.trim();
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('Réponse IA non parseable en JSON');
  }
}
const WORKOUT_SCHEMA = `
Chaque séance DOIT contenir exactement ces champs :
id, day (Lundi-Dimanche), type (NATATION|CYCLISME|C.A.P|ENCHAÎNEMENT|REPOS),
title, duration, intensity (pace/watts), cadence, cardio (zone FC), rpe (RPE x/10), desc, modified (boolean).
Jours obligatoires : ${DAYS_OF_WEEK.join(', ')} — exactement 7 séances par semaine.
`;
export async function generatePlanWithAI({ wizardData, profile }) {
  const model = getModel();
  const prompt = `Tu es un coach triathlon expert. Génère un plan d'entraînement JSON strict.
Profil athlète : ${JSON.stringify(profile)}
Wizard : ${JSON.stringify(wizardData)}
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
    "N": [7 séances semaine en cours],
    "N+1": [7 séances semaine suivante]
  }
}
Calibre intensity/cadence/cardio/rpe selon VMA ${profile.vma} km/h, FTP ${profile.ftp}W, CSS ${profile.nat100}/100m.
Respecte ~${wizardData.hoursPerWeek}h/semaine et repos le ${wizardData.offDays}.
Objectif : ${wizardData.targetGoal} le ${wizardData.targetDate}.`;
  let data = await callAndParse(model, prompt);
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const enriched = {
      N: (data.workouts?.N || []).map((w) => enrichWorkoutMetrics(w, profile)),
      'N+1': (data.workouts?.['N+1'] || []).map((w) => enrichWorkoutMetrics(w, profile)),
    };
    const incomplete = getIncompleteWorkouts(enriched);
    if (incomplete.length === 0) {
      return { trainingPlan: data.trainingPlan, workouts: enriched };
    }
    const fixPrompt = `Complète ces séances incomplètes. Champs manquants : ${JSON.stringify(incomplete)}
Séances actuelles : ${JSON.stringify(enriched)}
${WORKOUT_SCHEMA}
Réponds avec : { "workouts": { "N": [...], "N+1": [...] } }`;
    const fixData = await callAndParse(model, fixPrompt);
    data = { ...data, workouts: fixData.workouts || data.workouts };
  }
  const final = {
    N: (data.workouts?.N || []).map((w) => enrichWorkoutMetrics(w, profile)),
    'N+1': (data.workouts?.['N+1'] || []).map((w) => enrichWorkoutMetrics(w, profile)),
  };
  return { trainingPlan: data.trainingPlan, workouts: final };
}
export async function chatWithCoach({ message, profile, workouts, trainingPlan }) {
  const model = getModel();
  const prompt = `Tu es TRI COACH, coach triathlon personnel. Réponds en français.
Profil : ${JSON.stringify(profile)}
Plan : ${JSON.stringify(trainingPlan)}
Séances actuelles : ${JSON.stringify(workouts)}
Message athlète : "${message}"
${WORKOUT_SCHEMA}
Si l'athlète demande une modification de séance (décaler, alléger, remplacer, etc.),
renvoie des patches ciblés. Sinon patches vide.
Réponds UNIQUEMENT avec :
{
  "reply": "réponse coach concise et motivante",
  "patches": [
    { "week": "N|N+1", "id": "w2", "day": "Mardi", "type": "CYCLISME", "title": "...", "duration": "...", "intensity": "...", "cadence": "...", "cardio": "...", "rpe": "...", "desc": "...", "modified": true }
  ]
}`;
  const data = await callAndParse(model, prompt);
  if (data.patches?.length) {
    for (const patch of data.patches) {
      const check = validateWorkout(enrichWorkoutMetrics(patch, profile));
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
async function callAndParse(model, prompt) {
  const result = await model.generateContent(prompt);
  const text = result.response.text();
  return extractJson(text);
}
