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

// --- CALCUL DES ZONES PHYSIOLOGIQUES (pré-calculées côté serveur, injectées dans le prompt) ---
// Objectif : donner à l'IA des ancres numériques exactes plutôt que de la laisser
// halluciner des zones à partir de règles vagues — c'est la principale garantie
// de rigueur scientifique et de cohérence avec le profil réel de l'athlète.

function formatMinPerKm(paceMin) {
  const min = Math.floor(paceMin);
  const sec = Math.round((paceMin - min) * 60);
  return `${min}:${String(sec).padStart(2, '0')}`;
}

function computeRunZones(vma) {
  // % VMA par zone (référentiel classique fractionné/seuil/endurance fondamentale)
  const zones = [
    { z: 'Z1 (récupération)', pct: [0.60, 0.70] },
    { z: 'Z2 (endurance fondamentale)', pct: [0.70, 0.80] },
    { z: 'Z3 (tempo/seuil bas)', pct: [0.80, 0.88] },
    { z: 'Z4 (seuil/sweetspot)', pct: [0.88, 0.95] },
    { z: 'Z5 (VMA/fractionné court)', pct: [0.95, 1.05] },
  ];
  return zones.map(({ z, pct }) => {
    const fastSpeed = vma * pct[1];
    const slowSpeed = vma * pct[0];
    return `${z} : ${formatMinPerKm(60 / fastSpeed)} à ${formatMinPerKm(60 / slowSpeed)} /km`;
  }).join('\n');
}

function computeBikeZones(ftp) {
  // Zones de puissance Coggan (référence standard cyclisme)
  const zones = [
    { z: 'Z1 (récupération)', pct: [0, 0.55] },
    { z: 'Z2 (endurance)', pct: [0.56, 0.75] },
    { z: 'Z3 (tempo)', pct: [0.76, 0.90] },
    { z: 'Z4 (seuil/sweetspot)', pct: [0.91, 1.05] },
    { z: 'Z5 (VO2max)', pct: [1.06, 1.20] },
    { z: 'Z6 (anaérobie)', pct: [1.21, 1.50] },
  ];
  return zones.map(({ z, pct }) => `${z} : ${Math.round(ftp * pct[0])}-${Math.round(ftp * pct[1])}W`).join('\n');
}

function computeSwimZones(nat100) {
  const m = String(nat100 || '1:35').match(/(\d+):(\d{2})/);
  const cssMin = m ? Number(m[1]) + Number(m[2]) / 60 : 1 + 35 / 60;
  const zones = [
    { z: 'Z1 (récupération)', pct: [1.15, 1.25] },
    { z: 'Z2 (endurance)', pct: [1.06, 1.15] },
    { z: 'Z3 (tempo)', pct: [1.02, 1.06] },
    { z: 'Z4 (seuil/CSS)', pct: [0.98, 1.02] },
    { z: 'Z5 (vitesse)', pct: [0.88, 0.98] },
  ];
  return zones.map(({ z, pct }) => `${z} : ${formatMinPerKm(cssMin * pct[0])} à ${formatMinPerKm(cssMin * pct[1])} /100m`).join('\n');
}

function computeHrZones(fcMax, fcRepos) {
  const hrr = fcMax - fcRepos;
  const zones = [
    { z: 'Z1', pct: [0.50, 0.60] },
    { z: 'Z2', pct: [0.60, 0.70] },
    { z: 'Z3', pct: [0.70, 0.80] },
    { z: 'Z4', pct: [0.80, 0.90] },
    { z: 'Z5', pct: [0.90, 1.00] },
  ];
  return zones.map(({ z, pct }) => `${z} : ${Math.round(fcRepos + hrr * pct[0])}-${Math.round(fcRepos + hrr * pct[1])} bpm (méthode Karvonen)`).join('\n');
}

// --- PÉRIODISATION : détermine la phase d'entraînement (base/développement/affûtage)
// à partir du nombre de semaines restantes avant l'objectif, pour que chaque semaine
// générée soit réellement différente et progressive (jamais un copier-coller N vs N+1).
function computePeriodization(targetDate) {
  const now = new Date();
  const target = new Date(targetDate);
  const weeksLeft = Math.max(0, Math.round((target - now) / (7 * 24 * 3600 * 1000)));
  let phase;
  if (weeksLeft <= 1) phase = 'Affûtage final (taper) : réduction drastique du volume (-40 à -60%), maintien de l\'intensité, fraîcheur maximale.';
  else if (weeksLeft <= 3) phase = 'Affûtage (taper) : réduction progressive du volume (-20 à -30%/semaine), séances plus courtes mais avec un peu d\'intensité pour rester affûté.';
  else if (weeksLeft <= 8) phase = 'Développement spécifique : volume élevé, part d\'intensité et de séances spécifiques à l\'objectif en hausse.';
  else phase = 'Base / développement foncier : volume progressif, dominante endurance fondamentale (Z1-Z2), intensité limitée.';
  return { weeksLeft, phase };
}

const WORKOUT_SCHEMA = `
Tu agis comme un coach expert certifié (méthodologie ACSM / principes de périodisation classique).
Chaque séance DOIT contenir exactement ces champs, jamais vides :
id, day (Lundi-Dimanche), type (NATATION/SWIM|CYCLISME/BIKE|C.A.P/RUN|ENCHAÎNEMENT/BRICK|REPOS),
title, duration, desc, modified (boolean), et selon la discipline :
- RUN : intensity = allure OBLIGATOIREMENT au format min/km (ex: "4:30 /km"), JAMAIS en km/h,
  effortZone = zone d'effort (Z1-Z5), avgBpm = BPM moyen estimé — choisis CES valeurs à l'intérieur
  des zones précalculées fournies plus bas pour CE profil, jamais une valeur générique.
- BIKE : intensity = watts cible (dans les zones de puissance précalculées), rpe = effort ressenti (RPE x/10), cardio = zone FC + bpm moyen.
- SWIM : intensity = allure OBLIGATOIREMENT au format min/100m (dans les zones précalculées), effortZone = zone d'effort.
- ATTENTION PARTICULIÈRE : le champ "intensity" doit être précis, spécifique à CHAQUE séance et cohérent
  avec les tables de zones fournies (jamais une valeur générique recopiée d'une autre séance).
- Tous : restTime = temps de repos entre répétitions EXPLICITE (jamais "-" si la séance contient des intervalles,
  ex: course "30s-1min30 selon distance", vélo "3' à 5' souple", natation "15-30s").
- Tous : structure = résumé en une phrase de la séance en 3 blocs : échauffement / corps de séance
  (avec le nombre de répétitions et l'allure/puissance cible) / retour au calme. JAMAIS un champ vague du type
  "voir description" — la structure doit être exploitable seule, sans lire ailleurs.
RÈGLES DE COHÉRENCE OBLIGATOIRES (garde-fous expert) :
- Les valeurs (allure, watts, BPM) DOIVENT rester STRICTEMENT dans les tables de zones précalculées fournies
  pour ce profil précis : ne jamais halluciner ni recopier des valeurs génériques d'un autre athlète.
- Une séance à dominante intensité (VMA, seuil, sweetspot, fractionné) doit toujours être précédée d'un échauffement ≥10min et suivie d'un retour au calme.
- Jamais deux séances à haute intensité (Z4/Z5) consécutives sur deux jours de suite dans la même semaine.
- Respecter le principe de 80/20 (environ 80% du volume hebdo en endurance fondamentale Z1-Z2, 20% en intensité),
  SAUF si la phase d'entraînement indiquée impose une répartition différente (ex: affûtage).
- La semaine N+1 doit être une PROGRESSION ou une VARIATION réelle par rapport à N (volume, intensité ou
  contenu différents selon la phase de périodisation) — ne jamais dupliquer une semaine à l'identique.
- Le volume hebdomadaire total (somme des durées) doit correspondre au volume horaire disponible déclaré
  par l'athlète, à ±15% près — jamais largement au-dessus ou en dessous.
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
  const { weeksLeft, phase } = computePeriodization(wizardData.targetDate);

  const fitnessLabels = { 1: 'débutant', 2: 'novice', 3: 'intermédiaire', 4: 'confirmé', 5: 'expert/compétiteur' };
  const fitnessLabel = fitnessLabels[wizardData.fitnessLevel] || 'intermédiaire';

  const prompt = `Tu es un coach triathlon/course à pied expert, rigoureux scientifiquement (méthodologie ACSM,
périodisation classique base/développement/affûtage, principe de surcharge progressive). Génère un plan
d'entraînement JSON strict, UNIQUE et entièrement adapté au profil ci-dessous — n'utilise JAMAIS de contenu
générique qui ignorerait ces données précises.

${wizardData.firstName ? `Athlète : ${wizardData.firstName}.` : ''}
Genre ${wizardData.gender}, poids ${wizardData.weight || profile.weight}kg, niveau ${wizardData.fitnessLevel}/5 (${fitnessLabel}).
Profil physiologique de référence : VMA ${profile.vma} km/h, FTP ${profile.ftp}W, allure natation CSS ${profile.nat100}/100m,
FC max ${profile.fcMax || 190} bpm, FC repos ${profile.fcRepos || 55} bpm.

TABLES DE ZONES PRÉCALCULÉES POUR CE PROFIL (utilise EXCLUSIVEMENT ces valeurs, n'en recalcule pas d'autres) :
--- Zones de fréquence cardiaque (Karvonen) ---
${computeHrZones(profile.fcMax || 190, profile.fcRepos || 55)}
--- Zones d'allure course à pied (% VMA) ---
${computeRunZones(profile.vma)}
--- Zones de puissance vélo (% FTP, méthode Coggan) ---
${computeBikeZones(profile.ftp)}
--- Zones d'allure natation (% CSS) ---
${computeSwimZones(profile.nat100)}

Objectif : ${goalDescription}
${timeDescription}
Date de l'objectif : ${wizardData.targetDate} (${weeksLeft} semaines restantes)
Phase de périodisation actuelle : ${phase}

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
    "N": [ /* 7 séances semaine en cours, phase: ${phase.split(' :')[0]} */ ],
    "N+1": [ /* 7 séances semaine suivante — progression ou variation réelle par rapport à N */ ]
  }
}
`;

  let data = await callGeminiJSON(prompt);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    // IMPORTANT : on vérifie la complétude sur la réponse BRUTE de l'IA,
    // avant tout remplissage générique — sinon un trou (ex: allure ou
    // structure manquante) serait masqué par une valeur par défaut
    // passe-partout et ne serait jamais réellement complété par l'IA.
    const rawList = { N: data.workouts?.N || [], 'N+1': data.workouts?.['N+1'] || [] };
    const incomplete = getIncompleteWorkouts(rawList);
    if (incomplete.length === 0) {
      const enriched = {
        N: rawList.N.map((w) => sanitizeWorkout(w, profile)),
        'N+1': rawList['N+1'].map((w) => sanitizeWorkout(w, profile)),
      };
      return { trainingPlan: data.trainingPlan, workouts: enriched };
    }
    const fixPrompt = `Complète ces séances incomplètes avec un contenu précis et spécifique (jamais générique).
Champs manquants ou insuffisants : ${JSON.stringify(incomplete)}
Séances actuelles : ${JSON.stringify(rawList)}
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
${profile?.firstName ? `Tu t'adresses à ${profile.firstName} — utilise son prénom naturellement dans ta réponse (sans en abuser).` : ''}
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

// --- NUTRITION : conseils basés sur les référentiels scientifiques reconnus
// (position stands ACSM/ISSN, recommandations IOC en nutrition sportive d'endurance) ---

const NUTRITION_GUARDRAILS = `
Tu es un(e) diététicien(ne) du sport, expert en nutrition d'endurance (triathlon/course à pied).
Base-toi UNIQUEMENT sur des recommandations scientifiquement établies et consensuelles :
- Apports glucidiques à l'effort : ~30-60g/h pour un effort <2h30, jusqu'à 90g/h (mix glucose/fructose 2:1) au-delà, selon les recommandations ISSN/ACSM.
- Hydratation : 400-800ml/h selon météo/sudation, avec 300-700mg/L de sodium en conditions chaudes ou efforts >1h.
- Fenêtre de récupération : glucides + protéines (ratio ~3:1 à 4:1) dans les 30-60min post-effort.
- Ne jamais recommander de jeûne prolongé avant un effort intense, de restriction calorique sévère, de compléments non réglementés, ou de quantités extrêmes.
- Toujours rappeler que ce sont des repères généraux, pas un avis médical individualisé, et qu'un professionnel de santé/diététicien doit valider en cas de pathologie.
Réponds en français, de façon concrète et actionnable (exemples d'aliments/boissons précis).
`;

function validateNutritionText(text) {
  const banned = /jeûne prolongé|jeûne total|restriction sévère|sans manger pendant.*jours|compléments non réglementés|substances interdites/i;
  const hasHydration = /hydrat|boire|litre|ml\/h|eau/i.test(text);
  const hasFuel = /glucide|carb|banane|gel|barre|sucre|énergétique/i.test(text);
  return { valid: !banned.test(text) && hasHydration && hasFuel, hasHydration, hasFuel, flaggedDanger: banned.test(text) };
}

async function callGeminiText(prompt) {
  const client = getClient();
  const candidates = getCandidateModels();
  let lastError = null;
  for (const model of candidates) {
    try {
      const response = await withTimeout(
        client.models.generateContent({ model, contents: prompt }),
        CALL_TIMEOUT_MS,
        model
      );
      return String(response.text || '').trim();
    } catch (err) {
      lastError = err;
      lastError.code = classifyError(err);
      if (lastError.code === 'AUTH' || lastError.code === 'QUOTA') break;
    }
  }
  const finalErr = new Error(`Nutrition IA indisponible: ${lastError?.message || 'inconnu'}`);
  finalErr.code = lastError?.code || 'UNKNOWN';
  throw finalErr;
}

/**
 * DOUBLE CHECK : génère un conseil nutrition puis le fait re-vérifier/corriger par l'IA
 * si le contrôle scientifique automatisé (garde-fous) échoue, avant de l'afficher.
 */
async function generateVerifiedAdvice(prompt) {
  let text = await callGeminiText(prompt);
  let check = validateNutritionText(text);
  if (!check.valid) {
    const fixPrompt = `${NUTRITION_GUARDRAILS}
Ta réponse précédente ne respecte pas toutes les règles ci-dessus (hydratation et/ou apport glucidique manquant, ou recommandation dangereuse détectée) :
"""${text}"""
Corrige et régénère une réponse complète, sûre et conforme.`;
    text = await callGeminiText(fixPrompt);
    check = validateNutritionText(text);
  }
  return { text, verified: check.valid };
}

export async function generateNutritionAdvice({ profile, trainingPlan, workouts, sportType }) {
  const weekSessions = (workouts?.N || [])
    .map((w) => `${w.day}: ${w.type} — ${w.title} (${w.duration}, ${w.intensity || '-'})`)
    .join('\n');

  const generalPrompt = `${NUTRITION_GUARDRAILS}
Profil athlète : poids ${profile?.weight || '?'}kg, objectif : ${trainingPlan?.title || sportType}.
Rédige un conseil général (5-8 lignes) sur l'alimentation et l'hydratation quotidiennes adaptées à cet objectif d'entraînement d'endurance, pour la vie de tous les jours (hors séances).`;

  const weeklyPrompt = `${NUTRITION_GUARDRAILS}
Profil athlète : poids ${profile?.weight || '?'}kg, objectif : ${trainingPlan?.title || sportType}.
Séances de la semaine en cours :
${weekSessions}
Pour CHAQUE séance à enjeu nutritionnel (longue durée >1h ou haute intensité), précise brièvement quoi manger/boire avant, pendant et après. Format en liste par jour, concis.`;

  const [general, weekly] = await Promise.all([
    generateVerifiedAdvice(generalPrompt),
    generateVerifiedAdvice(weeklyPrompt),
  ]);

  return {
    generalAdvice: general.text,
    weeklyAdvice: weekly.text,
    verified: general.verified && weekly.verified,
  };
}

export async function answerNutritionQuestion({ profile, trainingPlan, question }) {
  const prompt = `${NUTRITION_GUARDRAILS}
Profil athlète : poids ${profile?.weight || '?'}kg, objectif : ${trainingPlan?.title || '-'}.
Question de l'athlète : "${question}"
Réponds de façon personnalisée, concrète et rassurante, en restant dans les garde-fous scientifiques ci-dessus. Si la question évoque un trouble digestif ou une intolérance, propose des alternatives pratiques (texture, timing, type de glucide) et suggère un avis diététicien/médecin si le problème persiste.`;
  const { text, verified } = await generateVerifiedAdvice(prompt);
  return { answer: text, verified };
}
