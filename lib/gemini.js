import { GoogleGenAI } from '@google/genai';
import { DAYS_OF_WEEK } from './defaults';
import { getIncompleteWorkouts, sanitizeWorkout, checkSessionCountCoherence, enforceSessionCount, mergeWeekFix, dedupeIdenticalSameDaySessions, enforceBeginnerProgression } from './workouts';
import { resolveAthletePhysiology, applyFeedbackTrendToPhysiology } from './physiology';
import { summarizeFeedbackTrend } from './feedback';
import { buildPeriodizationPlan, describePhaseGuidance, formatMacrocyclesForPrompt, phasesToCycles } from './periodization';
import { TIER_LABELS, getCarbRange, getFluidRange, getSodiumRange, getPotassiumRange } from './nutritionData';

// Modèles actuels valides (vérifie la liste à jour sur https://ai.google.dev/gemini-api/docs/models si besoin)
// Flash-Lite en premier : son quota gratuit journalier est bien plus généreux que
// celui de gemini-3.5-flash (qui plafonne à 20 requêtes/jour en free tier) — on
// garde donc 3.5-flash comme repli plutôt que comme premier choix.
const DEFAULT_CANDIDATES = ['gemini-3.1-flash-lite', 'gemini-3.5-flash'];
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

      // Une erreur d'authentification concerne TOUTE la clé API : inutile d'essayer
      // les autres candidats. En revanche le quota Gemini free tier est appliqué
      // PAR MODÈLE (voir "GenerateRequestsPerDayPerProjectPerModel-FreeTier" dans
      // la réponse d'erreur) : un modèle à quota épuisé n'empêche pas d'essayer
      // le suivant, qui a son propre quota séparé.
      if (code === 'AUTH') break;
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
  if (!vma) return "Non calculable : VMA non renseignée. N'indique AUCUNE allure chiffrée pour les séances course à pied — utilise exclusivement des repères RPE (ressenti) et suggère explicitement à l'athlète de faire un test VMA (ex: demi-Cooper) pour affiner les prochaines séances.";
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
  if (!ftp) return "Non calculable : FTP non renseignée. N'indique AUCUNE puissance chiffrée pour les séances vélo — utilise exclusivement des repères RPE (ressenti) et suggère explicitement à l'athlète de faire un test FTP pour affiner les prochaines séances.";
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
  if (!nat100) return "Non calculable : allure CSS non renseignée. N'indique AUCUNE allure chiffrée pour les séances natation — utilise exclusivement des repères RPE (ressenti) et suggère explicitement à l'athlète de faire un test CSS (ou un 100m chronométré) pour affiner les prochaines séances.";
  const m = String(nat100).match(/(\d+):(\d{2})/);
  if (!m) return "Non calculable : format d'allure CSS invalide, ignore cette donnée et utilise des repères RPE.";
  const cssMin = Number(m[1]) + Number(m[2]) / 60;
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
  if (!fcMax || !fcRepos) return "Non calculable : FC max et/ou FC repos non renseignées. N'indique AUCUNE fourchette de bpm chiffrée — utilise exclusivement des repères RPE (ressenti).";
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

// --- PÉRIODISATION : la structure MACRO complète (tous les mésocycles, base → développement
// spécifique → [pic] → affûtage) est désormais calculée de façon déterministe par
// lib/periodization.js — voir ce fichier pour le détail. `computePeriodization` ne fait plus
// qu'exposer la phase EN COURS (dérivée de cette même structure, source unique de vérité) pour
// injection dans le prompt de génération des séances de la semaine N/N+1.
function computePeriodization(targetDate) {
  const { totalWeeks, phases, currentPhase } = buildPeriodizationPlan(targetDate);
  const phase = `${describePhaseGuidance(currentPhase.key)} (Mésocycle actuel : "${currentPhase.name}", ${currentPhase.dates}.)`;
  return { weeksLeft: totalWeeks, phase, phases };
}

/**
 * Génère le bloc de règles injecté dans CHAQUE prompt IA (génération initiale ET chat
 * d'ajustement). Avant, ce bloc était une simple constante statique qui ne connaissait
 * ni le nombre de séances/semaine déclaré au questionnaire, ni le jour de repos, ni la
 * discipline — l'IA pouvait donc générer 6 ou 7 séances d'entraînement même si l'athlète
 * avait demandé 4, et le chat pouvait proposer une séance de natation à un coureur pur.
 */
function buildWorkoutSchema({ maxSessionsPerWeek, offDays, sportType } = {}) {
  const restCount = maxSessionsPerWeek ? 7 - Number(maxSessionsPerWeek) : null;
  const sessionCountRule = maxSessionsPerWeek
    ? `═══════════════════════════════════════════════════════════════════════════
RÈGLE ABSOLUE N°0 — NOMBRE DE SÉANCES D'ENTRAÎNEMENT (contrainte la plus souvent violée) :
═══════════════════════════════════════════════════════════════════════════
- L'athlète a déclaré EXACTEMENT ${maxSessionsPerWeek} séance(s) d'entraînement par semaine.
- Sur les 7 jours, EXACTEMENT ${maxSessionsPerWeek} doivent être une vraie séance (type ≠ REPOS)
  et EXACTEMENT ${restCount} doivent être type "REPOS" — jamais plus, jamais moins.
- Le(s) jour(s) suivant(s) DOIT/DOIVENT être REPOS quoi qu'il arrive (jour de repos obligatoire
  déclaré au questionnaire) : ${offDays || 'aucun déclaré'}.
- Une séance "double" (deux séances le même jour, ex: brick) compte pour DEUX séances dans le total,
  pas une seule — ajuste le nombre de jours REPOS en conséquence si tu en utilises une.
- INTERDICTION ABSOLUE DE DOUBLON : si un jour comporte deux séances, elles doivent être STRUCTURÉES
  et DIFFÉRENTES l'une de l'autre — jamais deux fois le même contenu (même titre, même durée, même
  intensité). Pour un plan multi-discipline, privilégie deux disciplines différentes ce jour-là (vrai
  enchaînement/brick, ex: vélo + course). Pour un plan mono-discipline (ex: course à pied uniquement),
  varie impérativement la NATURE des deux séances (ex: une sortie qualité/fractionné + une séance de
  récupération/technique/renforcement bien plus légère) — ne recopie jamais deux fois la même séance.
- AVANT de répondre, compte toi-même les entrées type ≠ REPOS de chaque semaine (N et N+1) et
  vérifie que ça fait bien ${maxSessionsPerWeek}. Si ce n'est pas le cas, corrige avant de répondre.
═══════════════════════════════════════════════════════════════════════════
`
    : '';
  const disciplineRule = sportType === 'running'
    ? `RÈGLE DE DISCIPLINE : cet athlète a un objectif COURSE À PIED uniquement — n'inclus JAMAIS de
séance NATATION ou CYCLISME (sauf si l'athlète le demande explicitement dans un message de chat),
et ne mentionne jamais FTP ou allure de natation, ces notions ne le concernent pas.\n`
    : '';

  return `
${sessionCountRule}${disciplineRule}
Tu agis comme un coach expert certifié (méthodologie ACSM / principes de périodisation classique
base-développement-affûtage / surcharge progressive / règle des 80-20).

Chaque séance DOIT contenir exactement ces champs, jamais vides ni génériques :
id, day (Lundi-Dimanche),
type — utilise EXACTEMENT une de ces 5 valeurs, RECOPIÉE TELLE QUELLE, jamais une autre variante,
jamais deux valeurs séparées par "/" : "NATATION" | "CYCLISME" | "C.A.P" | "ENCHAÎNEMENT" | "REPOS",
title, duration, desc, modified (boolean), et selon la discipline :

═══════════════════════════════════════════════════════════════════════════
RÈGLE ABSOLUE N°1 — UNITÉS D'ALLURE/INTENSITÉ (source d'erreur la plus fréquente, zéro tolérance) :
═══════════════════════════════════════════════════════════════════════════
- RUN (C.A.P) : le champ "intensity" DOIT être au format "m:ss /km" EXCLUSIVEMENT.
  ✅ CORRECT   : "4:30 /km"   "5:12 /km"   "3:55 /km (VMA)"
  ❌ INTERDIT  : "14 km/h"   "14.0 km/h (75% VMA)"   "12 kmh"   toute valeur en km/h ou mph.
  Pour convertir une vitesse en allure : minutes/km = 60 ÷ (vitesse en km/h).
  Exemple : 14 km/h → 60/14 = 4.28min → 4min17s → "4:17 /km". Fais TOUJOURS ce calcul
  mentalement et vérifie le résultat avant de l'écrire — n'écris JAMAIS une valeur en km/h.
- SWIM (NATATION) : "intensity" au format "m:ss /100m" EXCLUSIVEMENT (ex: "1:35 /100m").
- BIKE (CYCLISME) : "intensity" en watts cibles, format "NNNW" (ex: "245W"), jamais en km/h ni en %FC seul.
- Ces trois formats sont non négociables : une valeur dans le mauvais format rend la séance INUTILISABLE
  pour l'athlète (il ne peut pas régler sa montre GPS/home trainer avec une unité incohérente).
═══════════════════════════════════════════════════════════════════════════

- RUN : effortZone = zone d'effort (Z1-Z5), avgBpm = BPM moyen estimé — choisis CES valeurs à
  l'intérieur des zones précalculées fournies plus bas pour CE profil, jamais une valeur générique.
- BIKE : rpe = effort ressenti (RPE x/10), cardio = zone FC + bpm moyen, watts DANS la zone de puissance précalculée.
- SWIM : effortZone = zone d'effort, allure DANS la zone précalculée.
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
Jours obligatoires : ${DAYS_OF_WEEK.join(', ')} — exactement 7 ENTRÉES par semaine (une par jour, sauf ajout explicite
d'une séance double), mais attention : "entrée" ne veut PAS dire "séance d'entraînement" — voir RÈGLE ABSOLUE N°0
ci-dessus, le nombre de séances réelles (type ≠ REPOS) doit correspondre exactement au nombre déclaré, le reste des
7 entrées étant des entrées de type "REPOS".

AVANT DE RÉPONDRE — AUTO-VÉRIFICATION OBLIGATOIRE (relis ton propre JSON et corrige si besoin) :
1. Aucun champ "intensity" de type RUN ne contient "km/h" ou "kmh" — uniquement "m:ss /km".
2. Aucun champ "intensity" de type SWIM ne contient autre chose que "m:ss /100m".
3. Aucun champ "intensity" de type BIKE ne contient autre chose que des watts.
4. Chaque séance d'intervalles a un restTime explicite et une structure détaillée (pas "voir description").
5. Les 7 jours de la semaine sont bien présents, une seule séance par jour (sauf brick explicite).
6. Compte les entrées type ≠ REPOS de la semaine : ça doit correspondre EXACTEMENT au nombre de
   séances/semaine déclaré (règle absolue n°0 ci-dessus). Le(s) jour(s) de repos obligatoire(s) sont bien REPOS.
`;
}

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

function describeSessionAllocation(wizardData) {
  if (wizardData.sportType !== 'triathlon') {
    return `Course à pied : priorise la fréquence sur l'allure spécifique à mesure qu'on se rapproche de l'objectif, en gardant au moins une séance d'endurance fondamentale longue par semaine et 1 séance à allure spécifique/intensité (pas plus, pour limiter le risque de blessure).`;
  }
  const fmt = wizardData.triathlonFormat;
  const guidance = {
    XS: `Format découverte/sprint court : répartition assez équilibrée entre les 3 disciplines, légère priorité à la course à pied (discipline où le déficit technique/physio se rattrape le plus vite).`,
    S: `Format sprint : répartition équilibrée, légère priorité au vélo et à la course qui pèsent le plus dans le chrono final.`,
    M: `Format olympique : répartition quasi équilibrée entre les 3 disciplines, avec 1 séance de natation technique + 1 séance de vélo au seuil/sweetspot + 1 sortie longue course minimum si le volume le permet.`,
    L: `Format L (half/70.3) : le VÉLO doit recevoir la plus grande part du volume horaire (c'est la discipline la plus longue en durée) — vise ~45-50% du temps total en vélo, ~25-30% en course, ~15-20% en natation. Inclure au moins 1 sortie vélo longue par semaine et idéalement 1 séance d'enchaînement (brick) vélo→course pour habituer les jambes à la transition. Limiter les séances de course à haut impact (VMA/fractionné) à 1 max par semaine pour préserver les articulations sur la durée de préparation.`,
    XL: `Format XL (Ironman/distance complète) : le VÉLO domine très largement le volume horaire (~50-55%), la course reste importante en fréquence mais avec un volume mesuré pour limiter les blessures de surutilisation, la natation peut être la discipline la moins fréquente si le volume total est contraint. Intégrer régulièrement des séances d'enchaînement (brick) et au moins 1 sortie longue vélo et 1 sortie longue course par semaine (jamais le même jour en début de préparation, possible en brick en fin de préparation).`,
  };
  return guidance[fmt] || guidance.M;
}

function describeFitnessAdaptation(fitnessLevel) {
  const level = Number(fitnessLevel) || 3;
  if (level <= 2) {
    return `Athlète DÉBUTANT/NOVICE (niveau ${level}/5) : priorise la régularité et la construction technique avant l'intensité. Limite le travail à haute intensité (Z4/Z5) à 1 séance/semaine maximum, privilégie l'endurance fondamentale (Z1-Z2) sur au moins 75-80% du volume, augmente le volume hebdomadaire très progressivement (jamais plus de +10% par semaine entre les cycles), et intègre plus de temps de récupération/repos actif entre les séances exigeantes que pour un athlète confirmé.
BORNES CHIFFRÉES OBLIGATOIRES (phase base/développement, à respecter STRICTEMENT pour ce niveau) :
- Séance de seuil/VMA/fractionné (course) : maximum 20min de temps de travail cumulé (ex: 2x8min ou 4x5min), jamais 3x10min ou plus dès les premières semaines.
- Sortie longue course à pied : maximum 75min en phase base pour ce niveau (jamais 2h — une sortie longue de 2h est réservée à un niveau confirmé en fin de préparation).
- Sortie longue vélo : maximum 2h en phase base pour ce niveau.
- Exemple à NE JAMAIS reproduire pour ce niveau en semaine 1 : "séance de seuil 3x10min" + "sortie longue de 2h" le même microcycle — c'est une charge d'athlète confirmé, pas de débutant.`;
  }
  if (level >= 4) {
    return `Athlète CONFIRMÉ/COMPÉTITEUR : peut absorber une charge plus élevée et une part d'intensité plus importante (jusqu'à 25-30% du volume en Z3+ selon la phase), avec des séances plus complexes (fractionnés composés, blocs de sweetspot longs, brick avancés). Reste cependant rigoureux sur le principe 80/20 et la récupération — un athlète confirmé se blesse aussi par excès de confiance sur la charge.`;
  }
  return `Athlète INTERMÉDIAIRE : équilibre classique 80/20, progression standard, intensité modérée introduite progressivement selon la phase de périodisation.`;
}

// Langue choisie par l'athlète dans les réglages (fr par défaut) — instruction injectée
// dans chaque prompt pour que le texte RÉDIGÉ (titre, description, structure, réponse
// coach...) sorte dans cette langue. Les champs à valeur FIXE (day: "Lundi"-"Dimanche",
// type: "NATATION"|"CYCLISME"|"C.A.P"|"ENCHAÎNEMENT"|"REPOS", et les formats d'unité
// imposés comme "4:30 /km") ne sont volontairement PAS concernés : ce sont des clés
// internes comparées telles quelles ailleurs dans l'app (CalendarView, filtres, etc.),
// les traduire casserait cette logique.
const AI_LANGUAGE_NAMES = { fr: 'français', en: 'English', es: 'español' };
function languageInstruction(language) {
  const name = AI_LANGUAGE_NAMES[language] || AI_LANGUAGE_NAMES.fr;
  if (language === 'fr' || !language) return '';
  return `\nLANGUE DE RÉDACTION : rédige TOUT le texte libre destiné à l'athlète (title, desc, structure,
cycles[].name, cycles[].status, reply, et tout conseil ou réponse en prose) en ${name}. NE TRADUIS PAS
les champs à valeur fixe : "day" reste EXACTEMENT en français ("Lundi" à "Dimanche"), "type" reste
EXACTEMENT une des 5 valeurs françaises imposées ("NATATION"|"CYCLISME"|"C.A.P"|"ENCHAÎNEMENT"|"REPOS"),
et les formats d'unité imposés (ex: "4:30 /km", "245W", "1:35 /100m") restent inchangés.\n`;
}

export async function generatePlanWithAI({ wizardData, profile, feedbackHistory, language = 'fr' }) {
  const goalDescription = describeGoal(wizardData);
  const timeDescription = describeTargetTime(wizardData);
  const { weeksLeft, phase, phases } = computePeriodization(wizardData.targetDate);
  const currentPhaseKey = phases?.[0]?.key || 'base';
  const macrocyclesDescription = formatMacrocyclesForPrompt(phases);
  const sessionAllocation = describeSessionAllocation(wizardData);
  const fitnessAdaptation = describeFitnessAdaptation(wizardData.fitnessLevel);
  const isTriathlon = wizardData.sportType === 'triathlon';

  const fitnessLabels = { 1: 'débutant', 2: 'novice', 3: 'intermédiaire', 4: 'confirmé', 5: 'expert/compétiteur' };
  const fitnessLabel = fitnessLabels[wizardData.fitnessLevel] || 'intermédiaire';

  // Physiologie réellement adaptée à CET athlète (mesurée > estimée depuis un chrono réel >
  // valeur déjà connue du profil > rien) — jamais une valeur inventée à partir du niveau déclaré.
  let physio = resolveAthletePhysiology(wizardData, profile);
  const trend = summarizeFeedbackTrend(feedbackHistory);
  physio = applyFeedbackTrendToPhysiology(physio, trend);

  const fmtMetric = (value, unit) => (value === null || value === undefined ? 'non renseignée' : `${value}${unit}`);
  const hasUnknown = [physio.vmaSource, physio.ftpSource, physio.nat100Source, physio.fcMaxSource, physio.fcReposSource]
    .some((s) => s?.startsWith('non renseignée'));

  const physioBlock = isTriathlon
    ? `Profil physiologique de référence pour CET athlète :
- VMA : ${fmtMetric(physio.vma, ' km/h')} — fiabilité : ${physio.vmaSource}
- FTP : ${fmtMetric(physio.ftp, 'W')} — fiabilité : ${physio.ftpSource}
- Allure natation CSS : ${physio.nat100 ? `${physio.nat100}/100m` : 'non renseignée'} — fiabilité : ${physio.nat100Source}
- FC max : ${fmtMetric(physio.fcMax, ' bpm')} — fiabilité : ${physio.fcMaxSource}
- FC repos : ${fmtMetric(physio.fcRepos, ' bpm')} — fiabilité : ${physio.fcReposSource}
${hasUnknown ? "⚠️ Au moins une valeur ci-dessus n'est PAS renseignée (null) : n'invente JAMAIS de chiffre à sa place. Pour toute discipline dont la métrique est manquante, utilise UNIQUEMENT des repères RPE (ressenti, 1 à 10) dans intensity/desc, jamais une allure/puissance/bpm chiffré, et suggère à l'athlète dans le titre ou la description d'une séance clé de renseigner cette donnée (test terrain, chrono récent) pour affiner les prochains plans." : ''}`
    : `Profil physiologique de référence pour CET athlète :
- VMA : ${fmtMetric(physio.vma, ' km/h')} — fiabilité : ${physio.vmaSource}
- FC max : ${fmtMetric(physio.fcMax, ' bpm')} — fiabilité : ${physio.fcMaxSource}
- FC repos : ${fmtMetric(physio.fcRepos, ' bpm')} — fiabilité : ${physio.fcReposSource}
(FTP et allure natation non pertinents : objectif course à pied uniquement.)
${physio.vmaSource.startsWith('non renseignée') ? "⚠️ VMA non renseignée : n'indique AUCUNE allure chiffrée pour les séances course à pied, utilise uniquement des repères RPE, et suggère un test VMA (ex: demi-Cooper) dans une séance de la semaine." : ''}`;

  const zonesBlock = isTriathlon
    ? `--- Zones de fréquence cardiaque (Karvonen) ---
${computeHrZones(physio.fcMax, physio.fcRepos)}
--- Zones d'allure course à pied (% VMA) ---
${computeRunZones(physio.vma)}
--- Zones de puissance vélo (% FTP, méthode Coggan) ---
${computeBikeZones(physio.ftp)}
--- Zones d'allure natation (% CSS) ---
${computeSwimZones(physio.nat100)}`
    : `--- Zones de fréquence cardiaque (Karvonen) ---
${computeHrZones(physio.fcMax, physio.fcRepos)}
--- Zones d'allure course à pied (% VMA) ---
${computeRunZones(physio.vma)}`;

  const progressionBlock = trend.direction !== 'stable'
    ? `\nÉVOLUTION DU NIVEAU (à prendre en compte, ne pas ignorer) :\n${trend.label}\n`
    : '';

  const workoutSchema = buildWorkoutSchema({
    maxSessionsPerWeek: wizardData.maxSessionsPerWeek,
    offDays: wizardData.offDays,
    sportType: wizardData.sportType,
  });

  const prompt = `Tu es un entraîneur de triathlon et de course à pied EXPERT, diplômé, avec 15 ans d'expérience
d'encadrement d'athlètes du débutant au compétiteur. Tu appliques rigoureusement la méthodologie ACSM,
les principes de périodisation classique (base → développement → affûtage), le principe de surcharge
progressive, la règle des 80/20, et tu es intraitable sur la prévention des blessures par surcharge.

Ta mission : générer un plan d'entraînement JSON strict, UNIQUE et ENTIÈREMENT adapté à CET athlète précis
— jamais un plan générique de manuel. Chaque décision (répartition des séances, intensité, progression)
doit découler explicitement des données ci-dessous. Si tu hésites entre une option générique et une option
qui exploite une donnée spécifique de l'athlète, choisis TOUJOURS la seconde.

${languageInstruction(language)}
═══════════ PROFIL DE L'ATHLÈTE ═══════════
${wizardData.firstName ? `Prénom : ${wizardData.firstName}.` : ''}
Genre ${wizardData.gender}, poids ${wizardData.weight || profile.weight}kg, niveau déclaré ${wizardData.fitnessLevel}/5 (${fitnessLabel}).
${physioBlock}
${progressionBlock}
ADAPTATION AU NIVEAU (obligatoire, ne pas ignorer) :
${fitnessAdaptation}

TABLES DE ZONES PRÉCALCULÉES POUR CE PROFIL (utilise EXCLUSIVEMENT ces valeurs, n'en recalcule pas d'autres) :
${zonesBlock}

═══════════ OBJECTIF ═══════════
${goalDescription}
${timeDescription}
Date de l'objectif : ${wizardData.targetDate} (${weeksLeft} semaines restantes)
Phase de périodisation actuelle (celle des semaines N et N+1 que tu vas générer) : ${phase}

═══════════════════════════════════════════════════════════════════════════
RÈGLE ABSOLUE N°2 — STRUCTURE MACRO DE LA PRÉPARATION (PLUSIEURS MÉSOCYCLES OBLIGATOIRES) :
═══════════════════════════════════════════════════════════════════════════
Une préparation sérieuse ne se limite JAMAIS à un seul bloc uniforme : elle s'organise TOUJOURS en
plusieurs mésocycles enchaînés (principe de périodisation classique). Voici la structure macro déjà
calculée pour CETTE préparation, du jour J jusqu'à l'objectif — reproduis-la TELLE QUELLE (mêmes noms,
mêmes dates, même statut, dans le même ordre) dans le champ "trainingPlan.cycles" du JSON de sortie,
un objet par ligne ci-dessous :
${macrocyclesDescription}
N'invente PAS d'autre découpage et ne renvoie JAMAIS un seul macrocycle unique : ce tableau doit
contenir exactement ${phases.length} entrée(s), une par mésocycle listé ci-dessus. Les séances des
semaines N et N+1 que tu génères doivent être cohérentes avec le PREMIER mésocycle de cette liste
(celui au statut "En cours", qui correspond à la phase de périodisation actuelle décrite juste au-dessus).
═══════════════════════════════════════════════════════════════════════════

RÉPARTITION DES SÉANCES PAR DISCIPLINE (obligatoire, adapte le plan à cette logique) :
${sessionAllocation}

═══════════ CONTRAINTES DE L'ATHLÈTE ═══════════
Disponibilités : ~${wizardData.hoursPerWeek}h/semaine réparties sur EXACTEMENT ${wizardData.maxSessionsPerWeek} séances/semaine (voir règle absolue n°0 ci-dessous).
Repos obligatoire le ${wizardData.offDays}.
${Number(wizardData.maxSessionsPerWeek) < 5 && isTriathlon ? `⚠️ Avec seulement ${wizardData.maxSessionsPerWeek} séances/semaine pour un triathlon, tu ne peux PAS traiter les 3 disciplines séparément chaque semaine à volume égal : priorise les disciplines les plus déterminantes pour CE format (voir répartition ci-dessus), envisage des séances d'enchaînement (brick) pour combiner deux disciplines dans une même séance, et sois transparent dans le titre/desc de chaque séance sur le compromis fait (ex: "cette semaine, moins de natation pour prioriser le vélo, discipline la plus longue de l'épreuve").` : ''}

${workoutSchema}

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
    "N": [ /* 7 entrées semaine en cours (séances + repos), phase: ${phase.split(' :')[0]} */ ],
    "N+1": [ /* 7 entrées semaine suivante — progression ou variation réelle par rapport à N */ ]
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
    if (incomplete.length === 0) break;
    const fixPrompt = `Complète ces séances incomplètes avec un contenu précis et spécifique (jamais générique).
Champs manquants ou insuffisants : ${JSON.stringify(incomplete)}
Séances actuelles : ${JSON.stringify(rawList)}
${workoutSchema}
Réponds UNIQUEMENT avec les séances corrigées (tu peux ne renvoyer QUE les jours concernés, ce n'est pas grave) :
{ "workouts": { "N": [...], "N+1": [...] } }`;
    const fixData = await callGeminiJSON(fixPrompt);
    // ROBUSTESSE : fusion jour par jour au lieu d'un remplacement en bloc — si l'IA
    // ne renvoie qu'un sous-ensemble des 7 jours dans sa correction, les jours
    // absents de la réponse gardent leur version d'origine au lieu de disparaître
    // purement et simplement du calendrier (bug observé : "il manque la moitié").
    data = {
      ...data,
      workouts: {
        N: mergeWeekFix(rawList.N, fixData.workouts?.N),
        'N+1': mergeWeekFix(rawList['N+1'], fixData.workouts?.['N+1']),
      },
    };
  }

  if (!data.trainingPlan || typeof data.trainingPlan !== 'object') {
    const err = new Error("Réponse IA incomplète : champ 'trainingPlan' manquant.");
    err.code = 'PARSE_ERROR';
    throw err;
  }

  // ROBUSTESSE : comme pour le nombre de séances/semaine (enforceSessionCount) ou les unités
  // d'allure (sanitizeWorkout), la structure macro de la préparation (plusieurs mésocycles) est
  // TROP IMPORTANTE pour dépendre uniquement de l'obéissance de l'IA au prompt — elle est donc
  // recalculée ici de façon déterministe et remplace systématiquement ce que l'IA a renvoyé.
  // Ça garantit que l'onglet "Objectif" affiche toujours plusieurs macrocycles cohérents (jamais
  // un seul bloc unique), quelle que soit la réponse brute du modèle.
  data.trainingPlan.cycles = phasesToCycles(phases);

  const resolvedProfile = {
    ...profile,
    vma: physio.vma,
    fcMax: physio.fcMax,
    fcRepos: physio.fcRepos,
    ...(isTriathlon ? { ftp: physio.ftp, nat100: physio.nat100 } : {}),
    weight: Number(wizardData.weight) || profile.weight,
  };

  let sanitized = {
    N: (data.workouts?.N || []).map((w) => sanitizeWorkout(w, resolvedProfile)),
    'N+1': (data.workouts?.['N+1'] || []).map((w) => sanitizeWorkout(w, resolvedProfile)),
  };

  // ROBUSTESSE : le nombre de séances réelles vs REPOS est la contrainte la plus
  // fréquemment ignorée par l'IA malgré la règle absolue n°0 du prompt. Correction
  // UNIQUEMENT déterministe (jamais un second aller-retour IA ici) : cette correction
  // opère directement sur le tableau de 7 jours déjà complet et ne peut donc jamais
  // faire disparaître un jour — contrairement à une re-demande à l'IA qui pourrait
  // renvoyer une semaine partielle (c'est exactement ce qui causait des semaines
  // incomplètes après une "correction" précédente).
  for (const weekKey of ['N', 'N+1']) {
    const issues = checkSessionCountCoherence(sanitized[weekKey], wizardData.maxSessionsPerWeek, wizardData.offDays);
    if (issues.length > 0) {
      sanitized[weekKey] = enforceSessionCount(sanitized[weekKey], wizardData.maxSessionsPerWeek, wizardData.offDays, resolvedProfile, wizardData.sportType);
    }
    // Filet de sécurité INDÉPENDANT du nombre total de séances : même quand le total
    // est correct, l'IA génère parfois deux séances quasi identiques sur un même
    // jour double (ex: 2x le même footing). On corrige systématiquement.
    sanitized[weekKey] = dedupeIdenticalSameDaySessions(sanitized[weekKey]).map((w) => sanitizeWorkout(w, resolvedProfile));

    // ROBUSTESSE : même logique que ci-dessus pour le nombre de séances — la progressivité
    // pour un niveau débutant/novice (fitnessLevel <= 2) est trop importante pour dépendre
    // uniquement de l'obéissance de l'IA au prompt (voir describeFitnessAdaptation). On
    // plafonne donc ici, de façon déterministe, les séances trop exigeantes pour ce profil
    // en phase base/développement (jamais en peak/taper).
    sanitized[weekKey] = enforceBeginnerProgression(sanitized[weekKey], wizardData.fitnessLevel, currentPhaseKey);
  }

  return { trainingPlan: data.trainingPlan, workouts: sanitized, resolvedProfile };
}

export async function chatWithCoach({ message, profile, workouts, trainingPlan, intent, sportType, constraints, feedbackHistory, language = 'fr' }) {
  const intentInstruction = intent === 'add'
    ? `L'athlète veut AJOUTER une séance supplémentaire, PAS remplacer une séance existante. Chaque patch doit avoir "patchMode": "add" et un "id" nouveau (jamais l'id d'une séance existante).
${constraints?.maxSessionsPerWeek ? `⚠️ Ajouter une séance fait dépasser les ${constraints.maxSessionsPerWeek} séances/semaine déclarées au questionnaire — précise-le clairement à l'athlète dans ta réponse et propose plutôt d'alléger une séance existante si le volume ${constraints.hoursPerWeek ? `(${constraints.hoursPerWeek}h/sem déclarées) ` : ''}ne permet pas d'en absorber une de plus, sauf si l'athlète insiste explicitement.` : ''}`
    : intent === 'modify'
      ? `L'athlète veut MODIFIER une séance existante. Chaque patch doit avoir "patchMode": "modify" et reprendre le "id" ou le "day" exact de la séance visée. Ne change JAMAIS le nombre total de séances/semaine sans que l'athlète le demande explicitement.`
      : `Déduis toi-même s'il s'agit d'un ajout ("patchMode": "add") ou d'une modification ("patchMode": "modify") d'après le message. Par défaut, ne change JAMAIS le nombre total de séances/semaine ni les jours de repos obligatoires sans demande explicite de l'athlète.`;

  const trend = summarizeFeedbackTrend(feedbackHistory);
  const trendInstruction = trend.direction !== 'stable'
    ? `\nTENDANCE RÉCENTE DE L'ATHLÈTE (à prendre en compte pour calibrer tes propositions) :\n${trend.label}\n`
    : '';

  const constraintsBlock = constraints
    ? `Contraintes déclarées au questionnaire (à respecter sauf demande explicite contraire) :
- Discipline : ${sportType === 'running' ? 'course à pied uniquement (jamais de natation/vélo)' : 'triathlon (natation/vélo/course)'}
- ${constraints.maxSessionsPerWeek || '?'} séance(s)/semaine, ~${constraints.hoursPerWeek || '?'}h/semaine
- Jour(s) de repos obligatoire(s) : ${constraints.offDays || 'non précisé'}
`
    : '';

  const workoutSchema = buildWorkoutSchema({
    maxSessionsPerWeek: constraints?.maxSessionsPerWeek,
    offDays: constraints?.offDays,
    sportType,
  });

  const prompt = `Tu es TRI COACH, coach triathlon personnel. Réponds en ${AI_LANGUAGE_NAMES[language] || 'français'}, ton motivant et concis.
${profile?.firstName ? `Tu t'adresses à ${profile.firstName} — utilise son prénom naturellement dans ta réponse (sans en abuser).` : ''}
${languageInstruction(language)}${constraintsBlock}${trendInstruction}
Profil : ${JSON.stringify(profile)}
${Object.entries(profile || {}).some(([k, v]) => ['vma', 'ftp', 'nat100', 'fcMax', 'fcRepos'].includes(k) && (v === null || v === undefined)) ? "⚠️ Un ou plusieurs champs physiologiques du profil ci-dessus sont null (non renseignés) : n'invente JAMAIS de valeur à leur place. Pour toute allure/puissance/bpm concernant un champ null, utilise uniquement des repères RPE (ressenti)." : ''}
Plan : ${JSON.stringify(trainingPlan)}
Séances actuelles : ${JSON.stringify(workouts)}
Message athlète : "${message}"
${workoutSchema}
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
      // sanitizeWorkout corrige les champs INVALIDES (pas seulement vides) —
      // par ex. une allure donnée en km/h par erreur est convertie en min/km,
      // contrairement à un simple "champ || valeur par défaut" qui ne corrige
      // que les champs vides et laisserait passer une valeur fausse mais non-vide.
      const sanitized = sanitizeWorkout(patch, profile);
      Object.assign(patch, sanitized);
    }
  }
  return {
    reply: data.reply || "J'ai bien pris en compte ta demande.",
    patches: data.patches || [],
  };
}

// --- NUTRITION : conseils basés sur les référentiels scientifiques reconnus
// (position stands ACSM/ISSN, consensus IOC nutrition sportive, littérature ultra-endurance
// récente sur les glucides multi-transportables) — voir lib/nutritionData.js pour les
// cibles numériques pré-calculées par palier d'effort, injectées ici en ancres chiffrées
// (même principe que les zones physio pour les séances d'entraînement).

const NUTRITION_GUARDRAILS = `
Tu es un(e) diététicien(ne) du sport, expert en nutrition d'endurance (triathlon/course à pied/trail).
Base-toi UNIQUEMENT sur des recommandations scientifiquement établies et consensuelles (ISSN/ACSM/IOC).
Ne jamais recommander de jeûne prolongé avant un effort intense, de restriction calorique sévère, de
compléments non réglementés, ou de quantités extrêmes hors des repères fournis.
Réponds en français, de façon concrète, actionnable (exemples précis d'aliments/boissons) et CONCISE :
pas de blabla, pas de rappel méthodologique, va droit au but. Ne mentionne pas explicitement les
référentiels scientifiques dans ta réponse (c'est déjà indiqué ailleurs dans l'interface).
`;

function validateNutritionText(text) {
  const banned = /jeûne prolongé|jeûne total|restriction sévère|sans manger pendant.*jours|compléments non réglementés|substances interdites/i;
  return { valid: !banned.test(text), flaggedDanger: banned.test(text) };
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
      // Même logique que callGeminiJSON : le quota est par modèle, pas par clé.
      if (lastError.code === 'AUTH') break;
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
Ta réponse précédente contient une recommandation dangereuse détectée automatiquement :
"""${text}"""
Corrige et régénère une réponse complète, sûre et conforme, tout aussi concise.`;
    text = await callGeminiText(fixPrompt);
    check = validateNutritionText(text);
  }
  return { text, verified: check.valid };
}

function buildRaceTargetsBlock(raceProfile, heat = 'mild') {
  const carb = getCarbRange(raceProfile.tier);
  const fluid = getFluidRange(heat);
  const sodium = getSodiumRange(raceProfile.tier, heat);
  const potassium = getPotassiumRange(raceProfile.tier);
  return `Palier d'effort : ${TIER_LABELS[raceProfile.tier]} (${raceProfile.label}, ~${Math.round(raceProfile.durationMin)}min${raceProfile.distanceKm ? `, ~${raceProfile.distanceKm}km` : ''}).
Cibles chiffrées pré-calculées pour CE format (utilise ces valeurs, n'en invente pas d'autres) :
- Glucides : ${carb.min}-${carb.max}g/h ${carb.note ? `(${carb.note})` : ''}
- Liquide : ${fluid.min}-${fluid.max}ml/h
- Sodium : ${sodium.min}-${sodium.max}mg/h
- Potassium : ${potassium.min}-${potassium.max}mg/h`;
}

/**
 * Génère les DEUX blocs courts affichés dans l'onglet Nutrition : conseil "à l'entraînement"
 * (générique, vie quotidienne + séances) et conseil "le jour de la course" (dont le niveau de
 * détail est directement proportionnel au palier d'effort — un 5km n'a pas besoin des mêmes
 * précisions qu'un Ironman ou un ultra-trail).
 */
export async function generateNutritionAdvice({ profile, trainingPlan, sportType, raceProfile, language = 'fr' }) {
  const targetsBlock = buildRaceTargetsBlock(raceProfile);
  const langNote = language !== 'fr' ? `Rédige ta réponse entièrement en ${AI_LANGUAGE_NAMES[language] || 'français'}.\n` : '';

  const trainingPrompt = `${NUTRITION_GUARDRAILS}
${langNote}Profil athlète : poids ${profile?.weight || '?'}kg, discipline : ${sportType === 'triathlon' ? 'triathlon' : 'course à pied'}.
Rédige un conseil COURT (4-5 lignes MAXIMUM) sur l'alimentation/hydratation à adopter au quotidien et
pendant les séances d'entraînement (pas la course elle-même). Reste générique et actionnable.`;

  const raceLengthGuidance = raceProfile.tier === 'flash'
    ? 'Réponse TRÈS courte (2-3 lignes) : ce format ne nécessite quasi aucune stratégie nutritionnelle.'
    : raceProfile.tier === 'court'
      ? 'Réponse courte (3-4 lignes) : stratégie simple, pas de plan complexe.'
      : raceProfile.tier === 'moyen'
        ? 'Réponse de longueur moyenne (4-6 lignes) : donne les cibles glucides/liquide et 1-2 exemples concrets.'
        : raceProfile.tier === 'long'
          ? 'Réponse détaillée (6-8 lignes) : cibles chiffrées, exemples de produits, stratégie de répartition sur la course.'
          : 'Réponse détaillée (8-10 lignes) : cibles chiffrées, mix glucose/fructose, alternance solide/liquide/salé, gestion de la lassitude gustative, sodium renforcé.';

  const racePrompt = `${NUTRITION_GUARDRAILS}
${langNote}Profil athlète : poids ${profile?.weight || '?'}kg.
${targetsBlock}
Rédige le conseil nutrition à appliquer LE JOUR DE LA COURSE (pas l'entraînement). ${raceLengthGuidance}
Utilise les cibles chiffrées ci-dessus dans ta réponse (glucides/h notamment). Cite 1-3 exemples de
produits concrets (gel, boisson, aliment solide) adaptés à ce format.`;

  const [training, race] = await Promise.all([
    generateVerifiedAdvice(trainingPrompt),
    generateVerifiedAdvice(racePrompt),
  ]);

  return {
    trainingAdvice: training.text,
    raceAdvice: race.text,
    verified: training.verified && race.verified,
  };
}

export async function answerNutritionQuestion({ profile, trainingPlan, question, raceProfile, planSummary, language = 'fr' }) {
  const targetsBlock = raceProfile ? buildRaceTargetsBlock(raceProfile) : '';
  const langNote = language !== 'fr' ? `Rédige ta réponse entièrement en ${AI_LANGUAGE_NAMES[language] || 'français'}.\n` : '';
  const prompt = `${NUTRITION_GUARDRAILS}
${langNote}Profil athlète : poids ${profile?.weight || '?'}kg, objectif : ${trainingPlan?.title || '-'}.
${targetsBlock}
${planSummary ? `${planSummary}\n` : ''}Question de l'athlète : "${question}"
Réponds de façon personnalisée, concrète et rassurante (réponse courte, 3-6 lignes sauf si la question
exige clairement plus de détail). Si la question évoque un trouble digestif, une intolérance, ou une
difficulté à consommer un type de produit (ex: gels), propose des alternatives pratiques concrètes
(texture, timing, type de glucide, aliment de substitution) et suggère un avis diététicien/médecin
uniquement si le problème semble persistant ou sérieux.`;
  const { text, verified } = await generateVerifiedAdvice(prompt);
  return { answer: text, verified };
}
