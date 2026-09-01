import { GoogleGenAI } from '@google/genai';
import { callGroqJSON, callGroqText } from './groq';
import { DAYS_OF_WEEK } from './defaults';
import { getIncompleteWorkouts, sanitizeWorkout, checkSessionCountCoherence, enforceSessionCount, mergeWeekFix, ensureAllDaysPresent, dedupeIdenticalSameDaySessions, rebalanceSameDisciplineDoubles, enforceMaxSessionsPerDay, enforceThirdSessionLowIntensity, enforceBeginnerProgression, enforceNoConsecutiveHardDays, enforceDoubleThresholdEligibility, enforceTaperVolume, applyFatigueAutoRegulation, checkWeeklyVolumeWarning, checkWeekSimilarityWarning, checkMonotonyWarning, checkPolarizationWarning, checkTrailElevationWarning, injectPhysioTestSessions, enforceSwimVolumeFloor, enforceLongSessionFloor, applyBeginnerFirstPlanRamp, applyEasierTrendProgression } from './workouts';
import { resolveAthletePhysiology, applyFeedbackTrendToPhysiology, resolveTargetPhysiology } from './physiology';
import { summarizeFeedbackTrend, summarizeHrvTrend } from './feedback';
import { buildPeriodizationPlan, describePhaseGuidance, formatMacrocyclesForPrompt, phasesToCycles, getProgressionFactor, interpolateTowardTarget, summarizeUpcomingRaces } from './periodization';
import { computeCurrentPhase } from './cycleTracking';
import { TIER_LABELS, getCarbRange, getFluidRange, getSodiumRange, getPotassiumRange } from './nutritionData';
import { describeLaps } from './lapsAnalysis';

// Point 8 — Suivi du cycle menstruel (voir components/CycleTracker.js,
// lib/cycleTracking.js) : ENTIÈREMENT conditionné à l'opt-in de l'athlète — computeCurrentPhase
// renvoie `null` si le suivi n'est pas activé ou si aucune date n'a été saisie, auquel cas ce
// bloc reste vide et le prompt n'y fait strictement aucune allusion (aucune inférence, aucun
// signal si l'athlète n'a rien déclaré).
function buildCyclePhaseBlock(menstrualCycle) {
  const phase = computeCurrentPhase(menstrualCycle);
  if (!phase) return '';
  return `\nPHASE DU CYCLE MENSTRUEL ESTIMÉE (déclarée par l'athlète, à prendre en compte) :\n${phase.label} (jour ${phase.dayInCycle}/${phase.cycleLength}) — ${phase.guidance}\nAdapte le ressenti attendu en conséquence (ex: ne pas s'inquiéter d'un RPE plus élevé en fin\nde phase lutéale ou en phase menstruelle) SANS réduire systématiquement le contenu du plan\npour autant — reste au niveau d'un ajustement fin, pas d'une règle rigide appliquée aveuglément.\n`;
}

// Point 7 — Calendrier de courses multi-saisons (voir components/RaceCalendar.js,
// STORAGE_KEYS.raceCalendar) : informe l'IA des échéances À VENIR autres que l'objectif
// principal (déjà couvert par targetDate/targetTime dans le reste du prompt), pour qu'une
// course B/C dans 2-3 semaines commence déjà à influencer la semaine générée (ex : ne pas
// placer une séance à très haut volume juste avant, prévoir une réduction de charge courte)
// sans attendre d'être littéralement dans le mini-bloc d'affûtage correspondant.
function buildRaceCalendarBlock(raceCalendar) {
  const upcoming = summarizeUpcomingRaces(raceCalendar).filter((r) => r.daysAway <= 45);
  if (upcoming.length === 0) return '';
  const lines = upcoming
    .map((r) => `- ${r.name} — priorité ${r.priority || 'B'} — dans ${r.daysAway} jour${r.daysAway > 1 ? 's' : ''} (${r.date})`)
    .join('\n');
  return `\nAUTRES ÉCHÉANCES AU CALENDRIER (à anticiper, en plus de l'objectif principal) :\n${lines}\nPour une échéance de priorité A ou B dans moins de 10 jours : prévois une réduction de\ncharge cohérente juste avant (mini-affûtage), même si elle n'est pas l'objectif principal —\nl'athlète doit y arriver frais. Pour une priorité C ou une échéance plus lointaine, il suffit\nd'en tenir compte sans sacrifier la progression vers l'objectif principal.\n`;
}

// Journal de douleurs/blessures (voir components/InjuryJournal.js, STORAGE_KEYS.injuryLog) —
// résumé des gênes ACTIVES uniquement (les entrées marquées "résolues" ne doivent plus
// influencer la génération, sans quoi une vieille douleur guérie continuerait à brider le
// plan indéfiniment). Même esprit que hrvBlock : un signal parmi d'autres, jamais une
// interdiction générique — c'est à l'IA d'adapter concrètement (éviter d'aggraver LA zone
// concernée : ex. limiter le volume de course à fort impact sur une gêne au genou, réduire
// les tractions/appuis bras en cas de gêne à l'épaule pour la natation, etc.), pas de
// suspendre bêtement toute une discipline.
function buildInjuryBlock(injuryLog) {
  const active = (injuryLog || []).filter((e) => e && !e.resolved && e.bodyPart);
  if (active.length === 0) return '';
  const lines = active.map((e) => `- ${e.bodyPart} (signalée le ${e.date}${e.note ? ` : "${e.note}"` : ''})`).join('\n');
  return `\nGÊNES/DOULEURS ACTUELLEMENT SIGNALÉES (à prendre en compte, ne pas ignorer) :\n${lines}\nAdapte concrètement le contenu des séances pour ménager la ou les zone(s) concernée(s)\n(réduis l'impact/le volume spécifique à cette zone, propose une alternative technique si\npertinent, ou une séance de renforcement ciblée de prévention) SANS pour autant supprimer\ntoute activité par excès de prudence — reste dans l'esprit d'un vrai coach qui individualise,\npas d'un plan générique qui ignore royalement l'info ni d'un plan qui panique et vide le\ncalendrier.\n`;
}

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
      // Important : si err.code est déjà 'NETWORK' (posé par withTimeout ci-dessus) ou
      // 'PARSE_ERROR', on le garde tel quel plutôt que de le refaire classifier par
      // classifyError() — sinon un timeout (message français "Délai dépassé") pouvait être
      // reclassé en 'UNKNOWN' par classifyError() faute de correspondre à son regex, et
      // l'athlète recevait le message d'erreur générique au lieu du message NETWORK dédié.
      const code = (err.code === 'PARSE_ERROR' || err.code === 'NETWORK') ? err.code : classifyError(err);
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

// DISPATCHER CO-GÉNÉRATION : point d'entrée UNIQUE utilisé par generatePlanWithAI /
// regenerateWeekWithAI / reviewPlanCoherenceWithAI pour appeler "l'IA" — le provider
// ('gemini' ou 'groq') est choisi par l'appelant (voir lib/coGeneration.js, qui appelle
// deux fois la même fonction de génération avec un provider différent à chaque fois,
// pour que les DEUX passent par exactement la même chaîne de prompt + garde-fous).
async function callAIJSON(prompt, provider = 'gemini') {
  if (provider === 'groq') return callGroqJSON(prompt);
  return callGeminiJSON(prompt);
}

// Pendant texte de callAIJSON ci-dessus, pour les fonctions qui renvoient de la prose
// (nutrition, chat) plutôt que du JSON structuré — voir callGeminiText/callGroqText.
async function callAIText(prompt, provider = 'gemini') {
  if (provider === 'groq') return callGroqText(prompt);
  return callGeminiText(prompt);
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

const RUN_ZONE_LABELS = [
  'Z1 (récupération)',
  'Z2 (endurance fondamentale)',
  'Z3 (tempo/seuil bas)',
  'Z4 (seuil/sweetspot)',
  'Z5 (VMA/fractionné court)',
];

/**
 * Zones d'allure course à pied pour le prompt IA.
 * PRIORITÉ ABSOLUE aux zones CALIBRÉES MANUELLEMENT par l'athlète dans l'onglet Profil
 * (voir components/ZoneCharts.js, lib/zones.js:defaultPaceZones) si elles sont fournies :
 * c'est précisément le garde-fou qui corrige un écart entre l'allure théorique (% VMA,
 * ci-dessous) et l'allure réellement tenue sur le terrain — ex: un athlète dont la VMA
 * mesurée donne un EF théorique à 4'20/km mais qui court réellement son EF à 4'50/km
 * (fatigue cumulée triathlon, terrain, morphologie...) : la table théorique ne doit
 * JAMAIS l'emporter sur une calibration réelle explicitement saisie par l'athlète.
 * `manualPaceZones` : tableau de 5 zones ascendantes en VITESSE (km/h), même format que
 * hrZones/powerZones — voir lib/zones.js.
 */
function computeRunZones(vma, manualPaceZones) {
  const hasManual = Array.isArray(manualPaceZones)
    && manualPaceZones.length === 5
    && manualPaceZones.every((z) => Number.isFinite(Number(z?.min)) && Number(z.min) >= 0);

  if (hasManual) {
    const sorted = [...manualPaceZones].sort((a, b) => Number(a.min) - Number(b.min));
    const lines = sorted.map((z, i) => {
      const slowSpeed = Math.max(Number(z.min) || 0.1, 0.1);
      const nextMin = Number(sorted[i + 1]?.min);
      const fastSpeed = Number.isFinite(nextMin) && nextMin > slowSpeed ? nextMin : slowSpeed * 1.15;
      return `${RUN_ZONE_LABELS[i]} : ${formatMinPerKm(60 / fastSpeed)} à ${formatMinPerKm(60 / slowSpeed)} /km`;
    });
    return `${lines.join('\n')}\n⚠️ Ces zones d'allure ont été CALIBRÉES MANUELLEMENT par l'athlète dans son profil (mesure de terrain réelle) :
utilise EXCLUSIVEMENT ces valeurs, PRIORITAIRES sur tout calcul théorique depuis la VMA — même si elles
semblent "lentes" ou "rapides" au regard de la VMA déclarée, elles reflètent l'allure réellement tenable
par cet athlète, ce qui prime toujours sur une formule générique.`;
  }

  if (!vma) return "Non calculable : VMA non renseignée. N'indique AUCUNE allure chiffrée pour les séances course à pied — utilise exclusivement des repères RPE (ressenti) et suggère explicitement à l'athlète de faire un test VMA (ex: demi-Cooper) pour affiner les prochaines séances.";
  // % VMA par zone (référentiel classique fractionné/seuil/endurance fondamentale)
  const zones = [
    { z: RUN_ZONE_LABELS[0], pct: [0.60, 0.70] },
    { z: RUN_ZONE_LABELS[1], pct: [0.70, 0.80] },
    { z: RUN_ZONE_LABELS[2], pct: [0.80, 0.88] },
    { z: RUN_ZONE_LABELS[3], pct: [0.88, 0.95] },
    { z: RUN_ZONE_LABELS[4], pct: [0.95, 1.05] },
  ];
  return `${zones.map(({ z, pct }) => {
    const fastSpeed = vma * pct[1];
    const slowSpeed = vma * pct[0];
    return `${z} : ${formatMinPerKm(60 / fastSpeed)} à ${formatMinPerKm(60 / slowSpeed)} /km`;
  }).join('\n')}
(Calcul théorique % VMA — l'athlète peut calibrer manuellement ces allures dans l'onglet Profil s'il
constate un écart avec son allure réelle de terrain ; tant qu'il ne l'a pas fait, ce calcul reste une
approximation, pas une mesure.)`;
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

// --- VÉRIFICATION DE COHÉRENCE DES VALEURS CHIFFRÉES (allure/watts) VS LE PROFIL RÉEL ---
// Le prompt fournit déjà les zones exactes à l'IA (voir compute*Zones ci-dessus), mais rien ne
// garantit qu'elle choisisse une valeur réellement dans les clous. On ne recalcule pas une
// correspondance zone-par-zone stricte (le champ effortZone est parfois une plage "Z2-Z3", pas
// une zone unique) : on vérifie plutôt qu'aucune valeur n'est physiologiquement aberrante pour ce
// profil (ex: une allure de sprint donnée pour un footing) — assez large pour ne jamais braquer
// à tort sur une valeur légitime, assez strict pour capter une hallucination franche.
function runPaceSanityBoundsMinPerKm(vma, manualPaceZones) {
  const hasManual = Array.isArray(manualPaceZones)
    && manualPaceZones.length === 5
    && manualPaceZones.every((z) => Number.isFinite(Number(z?.min)) && Number(z.min) >= 0);
  if (hasManual) {
    const speeds = manualPaceZones.map((z) => Number(z.min)).filter((v) => v > 0);
    if (!speeds.length) return vma ? [60 / (vma * 1.10), 60 / (vma * 0.55)] : null;
    const fastest = Math.max(...speeds) * 1.15; // marge au-delà du haut de Z5
    const slowest = Math.min(...speeds.filter((v) => v > 0)) * 0.7 || Math.min(...speeds) * 0.7;
    return [60 / fastest, 60 / Math.max(slowest, 0.1)];
  }
  if (!vma) return null;
  return [60 / (vma * 1.10), 60 / (vma * 0.55)]; // [plus rapide toléré, plus lent toléré]
}
function bikeWattsSanityBounds(ftp) {
  if (!ftp) return null;
  return [ftp * 0.30, ftp * 1.60];
}
function swimPaceSanityBoundsMinPer100(nat100) {
  const m = String(nat100 || '').match(/(\d+):(\d{2})/);
  if (!m) return null;
  const css = Number(m[1]) + Number(m[2]) / 60;
  return [css * 0.75, css * 1.35];
}
function parsePaceMinPerKm(str) {
  const m = String(str || '').match(/(\d+):(\d{2})\s*\/?\s*km/i);
  return m ? Number(m[1]) + Number(m[2]) / 60 : null;
}
function parseWatts(str) {
  const m = String(str || '').match(/(\d+)\s*w\b/i);
  return m ? Number(m[1]) : null;
}
function parsePaceMinPer100(str) {
  const m = String(str || '').match(/(\d+):(\d{2})\s*\/?\s*100/i);
  return m ? Number(m[1]) + Number(m[2]) / 60 : null;
}

function checkZoneRangeWarnings(weekWorkouts, physio, weekLabel) {
  if (!Array.isArray(weekWorkouts)) return [];
  const warnings = [];
  weekWorkouts.forEach((w) => {
    if (!w || w.type === 'REPOS') return;
    if (w.type === 'C.A.P') {
      const bounds = runPaceSanityBoundsMinPerKm(physio.vma, physio.paceZones);
      const pace = parsePaceMinPerKm(w.intensity);
      if (bounds && pace && (pace < bounds[0] || pace > bounds[1])) {
        warnings.push(`Semaine ${weekLabel}, ${w.day} : allure "${w.intensity}" incohérente avec la VMA de l'athlète (${physio.vma} km/h) — probable erreur de génération.`);
      }
    } else if (w.type === 'CYCLISME') {
      const bounds = bikeWattsSanityBounds(physio.ftp);
      const watts = parseWatts(w.intensity);
      if (bounds && watts && (watts < bounds[0] || watts > bounds[1])) {
        warnings.push(`Semaine ${weekLabel}, ${w.day} : puissance "${w.intensity}" incohérente avec la FTP de l'athlète (${physio.ftp}W) — probable erreur de génération.`);
      }
    } else if (w.type === 'NATATION') {
      const bounds = swimPaceSanityBoundsMinPer100(physio.nat100);
      const pace = parsePaceMinPer100(w.intensity);
      if (bounds && pace && (pace < bounds[0] || pace > bounds[1])) {
        warnings.push(`Semaine ${weekLabel}, ${w.day} : allure "${w.intensity}" incohérente avec la CSS de l'athlète (${physio.nat100}/100m) — probable erreur de génération.`);
      }
    }
  });
  return warnings;
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
/**
 * Règles d'expertise "physiologie de l'entraînement d'endurance" (CAP route, trail, triathlon).
 * Objectif : cadrer l'IA sans la rendre rigide — poser les invariants scientifiques (charge,
 * récupération, spécificité) tout en laissant de la place à des séances innovantes (ex: double
 * seuil) quand le niveau/volume de l'athlète le permet réellement.
 */
const EXPERIENCE_RANK = { debutant: 1, novice: 2, intermediaire: 3, confirme: 4, expert: 5 };
const EXPERIENCE_LABELS = {
  debutant: 'débutant complet (jamais suivi de plan structuré)',
  novice: 'novice (<6 mois de pratique régulière)',
  intermediaire: 'intermédiaire (6 mois à 2 ans)',
  confirme: 'confirmé (2 à 5 ans, plusieurs objectifs déjà préparés)',
  expert: 'expert/compétiteur (5 ans+ d\'entraînement structuré)',
};

/**
 * Fusionne DEUX axes volontairement distincts : la FORME PHYSIQUE du moment (fitnessLevel, peut
 * fluctuer d'une préparation à l'autre) et l'EXPÉRIENCE D'ENTRAÎNEMENT (training age, stable dans
 * le temps). Un athlète confirmé qui reprend après une pause a une forme basse mais reste
 * expérimenté : il doit garder un contenu technique et un vocabulaire expert, seulement avec un
 * volume/intensité de départ prudents — pas être traité comme un débutant complet. À l'inverse, un
 * grand sportif d'un autre sport peut avoir une bonne forme générale mais aucune expérience
 * spécifique à l'endurance (tendons/os non adaptés à l'impact, aucun vécu de gestion d'allure) :
 * la PÉDAGOGIE et la COMPLEXITÉ des séances doivent suivre l'expérience, pas la forme.
 */
function describeAthleteAdaptation(fitnessLevel, trainingExperience) {
  const level = Number(fitnessLevel) || 3;
  const expRank = EXPERIENCE_RANK[trainingExperience] || 3;
  const expLabel = EXPERIENCE_LABELS[trainingExperience] || EXPERIENCE_LABELS.intermediaire;

  const pedagogyBlock = expRank <= 2
    ? `PÉDAGOGIE (expérience : ${expLabel}) : explique TOUJOURS le "pourquoi" de la séance en une phrase dans
"desc" (ex: "on reste en endurance fondamentale pour construire ta base aérobie sans risque de blessure").
Privilégie le ressenti (RPE) en complément du chiffré, évite le jargon non expliqué, et ne propose JAMAIS
de structure complexe (fractionné pyramidal, sweetspot, double seuil) même si la forme physique du moment
le permettrait — la complexité doit suivre le VÉCU d'entraînement, pas seulement la forme physique.`
    : expRank >= 4
      ? `PÉDAGOGIE (expérience : ${expLabel}) : contenu épuré et technique, l'athlète connaît déjà les bases —
ne réexplique pas les fondamentaux, va droit au but sur l'objectif de chaque séance.`
      : `PÉDAGOGIE (expérience : ${expLabel}) : équilibre entre explication du "pourquoi" et contenu technique.`;

  const fitnessBlock = level <= 2
    ? `FORME ACTUELLE (${level}/5) : volume et intensité de départ prudents, progression très progressive
(jamais +10% de volume hebdo d'une semaine à l'autre).`
    : level >= 4
      ? `FORME ACTUELLE (${level}/5) : peut absorber un volume et une intensité de départ plus élevés dès la
phase de base.`
      : `FORME ACTUELLE (${level}/5) : progression standard, intensité modérée introduite progressivement.`;

  const boundsBlock = (level <= 2 || expRank <= 2)
    ? `
BORNES CHIFFRÉES OBLIGATOIRES (phase base/développement — dès que la FORME est ≤2 OU l'EXPÉRIENCE est ≤2,
la plus prudente des deux règles prime) :
- Séance de seuil/VMA/fractionné (course) : maximum 20min de temps de travail cumulé (ex: 2x8min ou 4x5min).
- Sortie longue course à pied : maximum 75min en phase base.
- Sortie longue vélo : maximum 2h en phase base.
- Exemple à NE JAMAIS reproduire pour ce profil en semaine 1 : "séance de seuil 3x10min" + "sortie longue
de 2h" le même microcycle.`
    : expRank >= 4
      ? `
BORNES CHIFFRÉES ATTENDUES (profil ${expLabel} — hors phase d'affûtage) : une "sortie longue" plafonnée à
1h30-2h vélo ou <1h20 course pour ce niveau est trop courte pour être réellement formatrice et ne
correspond pas à une vraie sortie longue de club à ce niveau.
- Sortie longue vélo : au moins 2h30 en phase base, jusqu'à 3-4h en phase développement/spécifique pour
  une préparation format L (Half/70.3) ou XL (Ironman), selon le volume horaire hebdomadaire déclaré.
- Sortie longue course à pied : au moins 1h40, jusqu'à 2h+ en phase développement/spécifique selon le
  volume disponible et sans dépasser ce qui reste cohérent avec le volume hebdo total (±15%, voir plus bas).`
      : '';

  return `${pedagogyBlock}\n${fitnessBlock}${boundsBlock}`;
}

function buildEnduranceExpertRules({ fitnessLevel, trainingExperience, sportType, runningSubtype, phaseKey, hoursPerWeek, maxSessionsPerWeek, ppgEnabled } = {}) {
  const level = Number(fitnessLevel) || 3;
  const expRank = EXPERIENCE_RANK[trainingExperience] || 3;
  const advancedOk = level >= 4 && expRank >= 4 && Number(hoursPerWeek) >= 8;

  // Garde-fou déterministe correspondant : enforceMaxSessionsPerDay (workouts.js) autorise 3
  // séances/jour uniquement dans ce cas, et enforceThirdSessionLowIntensity force la 3e séance
  // en peu intensive si l'IA ne l'a pas déjà fait — cette règle de prompt est donc la première
  // ligne, pas la seule, mais mieux vaut que l'IA le fasse bien du premier coup.
  const tripleDayRule = Number(maxSessionsPerWeek) > 12
    ? `- TRIPLE SÉANCE AUTORISÉE (volume visé >12 séances/semaine) : tu PEUX programmer 3 séances le même
  jour à condition que ce soit 3 SPORTS DIFFÉRENTS (jamais 2x la même discipline) ET que la 3e séance
  de la journée soit OBLIGATOIREMENT peu intensive (endurance fondamentale Z1-Z2 ou technique, jamais
  seuil/VMA/fractionné) — c'est la contrepartie non négociable d'une triple journée.`
    : '- Pas de triple séance dans la même journée pour ce volume (≤12 séances/semaine visées) : 2 séances/jour maximum (1 si brick).';

  const doubleThresholdRule = advancedOk
    ? `- DOUBLE SEUIL AUTORISÉ (forme confirmée + expérience confirmée/expert + volume ≥8h/sem) : tu PEUX
  proposer une séance de double seuil (2 blocs de seuil courts dans la même journée, ex: 6x6min Z3 le
  matin + 5x5min Z3 le soir, méthode norvégienne) UNIQUEMENT en phase développement/spécifique, jamais
  plus d'1x/semaine, jamais la semaine d'une sortie longue le lendemain, et jamais 2 semaines de suite
  sans semaine allégée entre les deux.`
    : `- Double seuil INTERDIT pour ce profil (forme ou expérience insuffisante, ou volume <8h/sem) : une
  seule séance de qualité à dominante seuil/intensité par jour maximum.`;

  const trailBlock = sportType === 'running' && runningSubtype === 'trail'
    ? `- TRAIL : intègre du renforcement musculaire spécifique (excentrique, descente) 1x/semaine, une
  sortie longue avec dénivelé cumulé cohérent avec l'objectif (D+/D-), et exprime l'intensité en
  côte par l'effort ressenti (RPE) ou la fréquence cardiaque plutôt que l'allure pure (non pertinente
  en dénivelé). Ne jamais enchaîner deux sorties à fort dénivelé sur deux jours consécutifs.`
    : '';

  // PPG (préparation physique générale) — jusqu'ici réservée au trail (bloc ci-dessus, spécifique
  // excentrique/descente). Le triathlon/course sur route n'avait AUCUNE consigne PPG dans le prompt,
  // alors que gainage + stabilité épaule/hanche réduisent le risque de blessure de surcharge (nage :
  // épaule ; course/vélo : hanche/genou) — activable/désactivable par l'athlète au questionnaire
  // (`ppgEnabled`, défaut oui). Volontairement 1x/semaine max et jamais la veille d'une séance clé :
  // le PPG doit soutenir l'entraînement spécifique, jamais lui retirer de la fraîcheur.
  const ppgBlock = ppgEnabled && !(sportType === 'running' && runningSubtype === 'trail')
    ? `- PPG (préparation physique générale) DEMANDÉE par l'athlète : intègre 1x/semaine (jamais plus, et
  jamais la veille d'une séance clé/intensive) une séance courte (20-30min) de gainage + stabilité
  épaule-hanche (${sportType === 'triathlon' ? 'gainage type planche/oiseau, rotations externes épaule (bandes élastiques) pour la nage, squats unilatéraux/pont fessier pour la stabilité hanche/genou vélo-course' : 'gainage + renforcement fessiers/mollets pour la stabilité hanche/genou/cheville'}),
  RPE 3-4/10 (jamais épuisante), type de séance dédié plutôt que noyée en fin d'une autre séance.
  Réduis sa fréquence (tous les 10-14 jours) ou coupe-la entièrement en phase affûtage.`
    : '';

  return `
RÈGLES D'EXPERTISE PHYSIOLOGIE DE L'ENTRAÎNEMENT (invariants scientifiques — respecte l'esprit, pas
seulement la lettre ; tu peux innover dans la forme des séances tant que ces principes restent vrais) :
- Charge progressive : jamais +10% de volume hebdo d'une semaine à l'autre pour ce niveau (${level}/5).
  Toutes les 3-4 semaines, une semaine allégée (-30 à -40% de volume, intensité maintenue) pour absorber
  la charge — vérifie que le plan macro (mésocycles) en prévoit.
- Spécificité : plus l'objectif approche, plus les séances de qualité se rapprochent de l'allure/effort
  réel de course (spécificité), tout en gardant la base aérobie Z1-Z2 comme fondation jusqu'au bout.
- Individualisation : les bornes ci-dessus (niveau, format, phase) priment toujours sur un contenu
  "type manuel" — si une règle générique et une donnée spécifique à l'athlète entrent en conflit,
  la donnée spécifique gagne.
${doubleThresholdRule}
${tripleDayRule}
${trailBlock}
${ppgBlock}
- Affûtage (si la phase actuelle est "Affûtage") : réduis le volume de 40 à 60% sur les 7-10 derniers
  jours tout en conservant quelques touches d'intensité courtes à l'allure cible (ne jamais couper
  l'intensité totalement, seulement le volume).
- Tu es libre d'innover dans la forme (bricks créatifs, fartlek, sweet-spot, pyramidal, blocs de
  répétitions non-standards...) tant que la charge globale, la récupération et la progression restent
  cohérentes avec les règles ci-dessus.
`;
}

// Guidance NATATION spécifique au format de course visé (mêmes clés S/M/L/XL que
// describeSessionAllocation plus bas, réutilisées ici pour que le CONTENU des séances
// de natation — pas seulement leur part du volume horaire — reflète vraiment l'épreuve
// visée. C'est précisément le point signalé : le formalisme "feuille de club" (blocs,
// notation N*Dm) ne suffit pas si le CONTENU (dominante endurance vs vitesse, volume,
// repères "all [FORMAT]" utilisés) est identique quel que soit l'objectif de course.
const SWIM_FORMAT_GUIDANCE = {
  XS: `Format découverte/sprint court (~400-500m en course) : dominante technique + vitesse courte,
volume total modéré (privilégie la qualité à la quantité), séries courtes (25-50m) nombreuses pour
travailler l'aisance et l'efficacité de nage plutôt que l'endurance pure. Repère d'allure course cible :
"all SPRINT". Peu voire pas de blocs PULL longs (peu pertinents sur une distance aussi courte).`,
  S: `Format sprint (750m en course) : équilibre technique/vitesse/seuil court. Volume modéré, séries de
50-100m dominantes, quelques blocs 100-200m pour la capacité aérobie mais l'accent reste sur la vitesse
et le relâchement à allure soutenue (peu d'intérêt à du PULL très long ici). Repère d'allure course
cible : "all SPRINT". En phase pic/spécifique, introduis des blocs courts et rapides simulant le départ
groupé (25-50m à fond départ dans l'eau) en plus des blocs "all SPRINT".`,
  M: `Format olympique (1500m en course) : équilibre endurance/seuil, c'est le format le plus polyvalent —
mélange 100-200m à allure seuil/CSS et blocs PULL 200-400m pour la capacité aérobie, avec une dose de
technique (educ/PLAQ) à chaque séance. Repère d'allure course cible : "all OLYMPIQUE" (ou une allure CSS
chiffrée directement si plus lisible pour l'athlète). Introduis des blocs "all OLYMPIQUE" de 200-400m dès
la phase développement spécifique.`,
  L: `Format L (half/70.3, 1900m en course) : dominante ENDURANCE — la natation y est un poste
d'économie d'énergie avant 90km de vélo et 21km de course, pas une épreuve de vitesse pure. Privilégie
des blocs PULL et NC longs (200-400m, voire 400-800m en phase développement chez un niveau confirmé/
expert), rythme régulier et relâché plutôt que fractionné très court. Volume total dans le haut de la
fourchette du niveau déclaré. Repère d'allure course cible : "all HALF". Limite les séries de vitesse
pure (<50m à fond) à une portion mineure de la séance — l'enjeu ici est de tenir l'allure cible sans
s'épuiser, pas d'aller vite sur 50m.`,
  XL: `Format XL (Ironman/distance complète, 3800m en course) : dominante ENDURANCE MAXIMALE — nage la
plus longue et la plus économe possible avant 180km de vélo et un marathon. Blocs PULL/NC très longs
(400-800m, voire 1000m+ en phase développement chez un niveau confirmé/expert), rythme très régulier,
quasiment aucune vitesse pure. Volume total dans le haut de la fourchette du niveau déclaré (voire
au-delà en phase développement pour un niveau confirmé/expert). Repère d'allure course cible : "all XL".
Quasiment pas de blocs "à fond"/vitesse — l'enjeu est l'endurance de nage et l'économie de mouvement sur
la durée, pas la vitesse de pointe.`,
};

function describeSwimFormatGuidance(triathlonFormat) {
  return SWIM_FORMAT_GUIDANCE[triathlonFormat] || SWIM_FORMAT_GUIDANCE.M;
}

function buildWorkoutSchema({ maxSessionsPerWeek, offDays, sportType, fitnessLevel, trainingExperience, runningSubtype, phaseKey, hoursPerWeek, triathlonFormat, ppgEnabled } = {}) {
  const restCount = maxSessionsPerWeek ? 7 - Number(maxSessionsPerWeek) : null;
  const expertRules = buildEnduranceExpertRules({ fitnessLevel, trainingExperience, sportType, runningSubtype, phaseKey, hoursPerWeek, maxSessionsPerWeek, ppgEnabled });
  const sessionCountRule = maxSessionsPerWeek
    ? `═══════════════════════════════════════════════════════════════════════════
RÈGLE ABSOLUE N°0 — NOMBRE DE SÉANCES D'ENTRAÎNEMENT (contrainte la plus souvent violée) :
═══════════════════════════════════════════════════════════════════════════
- L'athlète a déclaré EXACTEMENT ${maxSessionsPerWeek} séance(s) d'entraînement par semaine.
- Sur les 7 jours, EXACTEMENT ${maxSessionsPerWeek} doivent être une vraie séance (type ≠ REPOS)
  et EXACTEMENT ${restCount} doivent être type "REPOS" — jamais plus, jamais moins.
- Le(s) jour(s) suivant(s) DOIT/DOIVENT être REPOS quoi qu'il arrive (jour de repos obligatoire
  déclaré au questionnaire) : ${offDays || 'aucun déclaré'}.
- Un jour "double" (2 séances distinctes le même jour, chacune une entrée à part) compte pour DEUX
  séances dans le total — ajuste le nombre de jours REPOS en conséquence si tu en utilises un.
- Une séance de type "ENCHAÎNEMENT" (brick) compte AUSSI pour DEUX séances dans le total, même si
  elle tient en UNE SEULE entrée du calendrier : elle combine par construction 2 disciplines (ex:
  vélo→course) en une séance structurée — physiologiquement et pour le décompte du questionnaire,
  c'est bien 2 séances, pas 1, même si visuellement c'est 1 carte. Ne rajoute donc PAS de séance
  supplémentaire ce jour-là "pour compenser" : le brick a déjà rempli les 2 crédits.
- MAXIMUM ABSOLU 2 séances réelles sur un même jour, JAMAIS 3 ni 4.
- RÈGLE ABSOLUE SUR LES BRICKS — aucune exception : un jour qui contient une séance "ENCHAÎNEMENT"
  (brick) ne doit contenir STRICTEMENT AUCUNE AUTRE séance ce jour-là, quelle que soit la discipline,
  y compris la natation. Un enchaînement vélo→course combine déjà une charge cardiovasculaire et
  mécanique équivalente à 2 séances réelles (fatigue neuromusculaire cumulée, dette glycogénique,
  risque de foulée dégradée en fin d'effort) ; ajouter une 3e discipline le même jour (même une nage
  a priori "facile") majore le risque de surcharge et de blessure sans bénéfice d'entraînement
  proportionnel pour un athlète non-élite, et n'a aucune justification physiologique reconnue en
  dehors de rares protocoles élite/pro très spécifiques hors du cadre de cette app. Jamais "sortie
  longue course + vélo + natation PUIS brick course" le même jour, jamais "brick vélo→course + sortie
  vélo" le même jour (le vélo est déjà présent DANS le brick : ce serait une 2e séance de la MÊME
  discipline le même jour, incohérence encore plus grave) — utilise un autre jour de la semaine.
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
${expertRules}

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
- Tous : structure = résumé en UNE SEULE phrase courte (affichée sur la vignette du calendrier, donc
  concise) reprenant les 3 blocs échauffement / corps de séance / retour au calme. JAMAIS un champ vague
  du type "voir description" — mais jamais non plus le détail complet des séries : ça, c'est le rôle de
  "desc" (voir RÈGLE ABSOLUE N°2 ci-dessous).

═══════════════════════════════════════════════════════════════════════════
RÈGLE ABSOLUE N°2 — FORMALISME DES SÉANCES (format "feuille de club" réelle — le champ "desc") :
═══════════════════════════════════════════════════════════════════════════
Le champ "desc" de CHAQUE séance (hors REPOS) doit être rédigé comme une VRAIE feuille de séance
distribuée par un club d'entraînement : notation compacte et chiffrée, blocs bien séparés par des
retours à la ligne, lisible d'un coup d'œil au bord du bassin / sur la piste / sur le vélo — jamais un
paragraphe en prose explicative (ça, c'est le rôle du reste de l'app, pas de "desc").

--- NATATION (format à respecter à la lettre, c'est le plus strict) ---
"desc" suit EXACTEMENT cette structure en 3 blocs séparés par des retours à la ligne :
  "Échauffement :
  <contenu échauffement>
  Corps de séance :
  <série(s) principale(s), un bloc par ligne>
  ---
  <retour au calme, ex "200 souple">
  Total : <XXXX>m"

RÈGLE ABSOLUE — LE CONTENU DE LA SÉANCE SUIT L'ÉPREUVE VISÉE (pas seulement sa forme) : le formalisme
en 3 blocs ci-dessus, c'est la FORME — mais deux séances peuvent être parfaitement formatées et rester
génériques si leur CONTENU (dominante endurance vs vitesse, longueur des séries, volume) est identique
quel que soit l'objectif de course. C'est une erreur : la natation d'un athlète visant un Ironman ne doit
JAMAIS ressembler à celle d'un athlète visant un sprint, même à niveau égal. Applique cette guidance
SPÉCIFIQUE au format déclaré de l'athlète (voir OBJECTIF plus bas pour le format réel) :
${describeSwimFormatGuidance(triathlonFormat)}

Vocabulaire/abréviations imposées (jamais de description en prose type "nage ensuite 400m facile") :
- NC = nage complète (4 nages ou crawl continu) ; PULL = avec pull-buoy ; PLAQ = avec plaquettes ;
  palmes = avec palmes ; educ = éducatifs technique ; souple = très facile/récupération ; à fond = effort
  maximal court.
- all [FORMAT] = allure course cible, à choisir EXACTEMENT selon le format déclaré de l'athlète (voir
  guidance ci-dessus) : "all SPRINT" (format S/XS), "all OLYMPIQUE" (format M), "all HALF" (format L/
  half-70.3), "all XL" (format XL/Ironman) — n'utilise ces repères que dans les séances en phase
  développement spécifique/pic (jamais en base pure), sinon utilise directement la zone d'allure CSS
  précalculée plus bas.
- Chaque ligne de série suit le motif "N*Dm (contenu/allure) R : XX''" — secondes notées '' , minutes
  notées ' — ex : "6*100 R : 15'' / 4*50 all HALF R : 20''", "8*50 en PLAQ R : 15''", "2*(200 all HALF R :
  30'' / 4*50 PULL R : 15'')" pour des blocs imbriqués.
- Volume total cohérent avec le niveau/la phase — calcule-le réellement en additionnant les distances du
  bloc, ne recopie JAMAIS un total générique. PLANCHERS MINIMUM à respecter strictement (hors séance de
  récupération explicitement courte et hors semaine d'affûtage) : 1200m (débutant), 1500m (novice),
  2000m (intermédiaire), 2800m (confirmé), 3200m+ (expert/compétiteur) — un total plus proche d'un simple
  échauffement qu'une vraie séance structurée (ex: <1200m pour un profil confirmé/expert) est une ERREUR,
  même en semaine de récupération légère (dans ce cas, allège l'INTENSITÉ, pas le volume total en dessous
  de ces planchers). Exemples de corps de séance RÉELS à ce niveau de volume (à adapter, pas à recopier
  tel quel) :
  * Confirmé (~2800m) : "8*100 NC R : 15'' / 400 PULL allure seuil R : 30'' / 6*100 PLAQ R : 20'' /
    4*200 all HALF R : 30''"
  * Expert (~3200-3800m) : "10*100 NC R : 10'' / 2*(400 all CSS R : 30'') / 8*50 vitesse R : 30'' /
    6*200 PULL R : 20'' / 400 souple technique"
  * Pyramide dégressive/ascendante avec changement de matériel entre blocs (structure RÉELLE de club,
    à réutiliser souvent — pas seulement des séries plates du même format répétées) :
    "400-300-200-100 PULL R : 20'' / 100-200-300-400 PLAQ R : 20'' / 4*50 vitesse R : 30''"
  * Format L/half (confirmé, ~3000m, dominante ENDURANCE — voir guidance ci-dessus) : "400 PULL souple
    R : 20'' / 3*400 all HALF R : 30'' / 6*100 PLAQ R : 15'' / 2*300 PULL R : 20''" — noter l'absence
    quasi totale de vitesse pure, au profit de blocs longs à allure course cible.
  * Format XL/Ironman (confirmé/expert, ~3800m, dominante ENDURANCE MAXIMALE — voir guidance ci-dessus) :
    "600 PULL souple R : 20'' / 2*800 all XL R : 30'' / 4*200 PLAQ R : 20'' / 400 PULL souple" — blocs
    très longs et réguliers, jamais de série <100m hors technique/récupération.
  * Format S/sprint (confirmé, ~2200m, dominante VITESSE/TECHNIQUE — voir guidance ci-dessus) : "8*50 NC
    R : 15'' / 8*50 all SPRINT R : 20'' / 6*100 PLAQ R : 15'' / 4*25 à fond départ R : 40''" — séries
    courtes et rapides, aucun bloc PULL long (peu pertinent sur cette distance de course).
  Alterne le matériel utilisé d'un bloc à l'autre au sein d'une même séance (NC / PULL / PLAQ / palmes /
  educ) comme le fait un club réel — une séance qui n'utilise QUE du NC du début à la fin, sans aucune
  variation de matériel ni de format de série, est moins réaliste et moins engageante qu'une séance de
  club typique.
  Une séance d'intervalles courts (ex: "8*50") ne constitue JAMAIS À ELLE SEULE le corps de séance complet
  pour un niveau confirmé/expert — combine plusieurs blocs de nature différente (endurance/seuil/vitesse)
  comme dans les exemples ci-dessus pour atteindre le volume réellement attendu à ce niveau.
- ALLURE SUR CHAQUE BLOC CHIFFRÉ (zéro tolérance) : toute ligne de série qui n'est pas explicitement
  "souple"/"educ"/récupération DOIT porter une référence d'allure explicite et exploitable — soit une
  zone de la table CSS précalculée plus bas ("Z2", "Z4/CSS"...), soit un repère "all [FORMAT]" (voir
  ci-dessus), soit une allure chiffrée "m:ss/100m" directement dans la ligne. Un bloc de matériel
  (PLAQ/PULL/palmes) SANS aucune de ces trois références est incomplet — l'athlète ne sait alors pas à
  quelle intensité nager ce bloc. ❌ INTERDIT : "6*100 PLAQ R : 20''" seul, sans zone ni allure.
  ✅ CORRECT : "6*100 PLAQ Z3 R : 20''" ou "6*100 PLAQ all HALF R : 20''".
- CHOIX DU MATÉRIEL JUSTIFIÉ PAR L'OBJECTIF DU BLOC (jamais pour varier sans raison) : chaque
  changement de matériel correspond à un objectif technique/physiologique précis — PLAQ pour renforcer
  la prise d'appui et la puissance de traction (blocs seuil/vitesse courts), PULL pour isoler le haut du
  corps et le rythme de nage sur des blocs plus longs (endurance/seuil), palmes pour travailler
  l'ondulation/le gainage ou soulager les épaules en fin de séance, educ pour la technique pure à faible
  intensité. N'introduis jamais PLAQ/palmes sur un bloc d'endurance fondamentale longue ni PULL sur un
  bloc de vitesse pure — l'accord matériel↔objectif doit être cohérent, pas décoratif.
- COHÉRENCE DE CYCLE AVEC LES AUTRES DISCIPLINES (RÈGLE ABSOLUE) : la natation suit la MÊME logique de
  mésocycle que le vélo et la course cette semaine (voir la phase de périodisation actuelle indiquée plus
  bas) — jamais une natation "figée en base/technique" pendant qu'une autre discipline attaque déjà des
  blocs de développement spécifique/seuil, et inversement jamais une natation à dominante vitesse/CSS pure
  en pleine phase base pendant que le reste du plan reste en endurance fondamentale. Concrètement : en
  phase base, dominante NC/educ/endurance (Z1-Z2), volume progressif, PLAQ/palmes en dose technique
  limitée ; en phase développement spécifique, davantage de blocs seuil/CSS chiffrés et de PLAQ orientés
  puissance ; en phase pic/spécifique, introduis des blocs "all [FORMAT]" à l'allure course cible, comme
  le fait déjà la course à pied et le vélo à ce stade ; en affûtage, réduis le volume mais garde quelques
  touches courtes à allure vive (jamais un simple maintien technique sans aucune intensité).
- Termine TOUJOURS le corps de séance par un retour au calme souple (150-300m) avant la ligne "Total :".

--- COURSE À PIED & VÉLO (même esprit de rigueur, notation compacte chiffrée) ---
Même principe pour "desc" : blocs "Échauffement :" / "Corps de séance :" / retour au calme, avec une
notation compacte "N*(effort - récupération)" utilisant les valeurs chiffrées EXACTES des zones
précalculées fournies plus bas (jamais un pourcentage ou une allure générique) :
  Exemple course : "15' footing\nCorps de séance :\n4*(3' @85% VMA - 1' @95% VMA - 2' souple)\n10' souple pour finir"
  Exemple vélo : "15' souple\nCorps de séance :\n6*(5' @90% FTP R : 3' souple)\n10' souple"
Cette notation compacte va dans "desc" ; "structure" reste le résumé en une phrase (voir plus haut).
═══════════════════════════════════════════════════════════════════════════

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
7. Chaque "desc" de séance NATATION suit le format en 3 blocs de la RÈGLE ABSOLUE N°2 (Échauffement /
   Corps de séance / Total en mètres) avec des séries chiffrées "N*Dm ... R : XX''" — jamais une
   description en prose. Le total en mètres annoncé correspond bien à la somme réelle des distances.
8. Chaque séance NATATION reflète bien le format de course déclaré de l'athlète (guidance ci-dessus,
   RÈGLE ABSOLUE — LE CONTENU DE LA SÉANCE SUIT L'ÉPREUVE VISÉE), pas un contenu générique identique
   quel que soit l'objectif : relis chaque séance et vérifie que la dominante (vitesse/technique pour
   S/XS, équilibre pour M, endurance longue pour L/XL) et le token "all [FORMAT]" utilisé correspondent
   bien au format réellement déclaré — corrige si une séance ressemble à celle d'un autre format.
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

/**
 * PASSE DE RELECTURE DE COHÉRENCE (AJOUTÉE — demande explicite) : jusqu'ici, la
 * cohérence n'était vérifiée que par des règles déterministes ciblées (voir tous les
 * `enforce*`/`check*` dans lib/workouts.js) — utiles mais chacune ne voit qu'UN aspect
 * précis. Rien ne relisait chaque séance dans son ENSEMBLE, ni ne comparait le plan
 * complet à lui-même de façon globale (une IA généraliste est meilleure qu'une règle
 * fixe pour repérer ce genre d'incohérence "d'ensemble" qu'aucune règle ciblée n'anticipe).
 * Cette passe s'exécute UNE FOIS, sur le plan déjà passé par tous les garde-fous
 * déterministes ci-dessus (elle relit donc l'état FINAL, pas un brouillon intermédiaire),
 * et vérifie 4 niveaux :
 *   1) Cohérence INTERNE de chaque séance (la durée correspond à ce que décrit la
 *      structure, l'intensité correspond bien au type/titre de la séance, le volume
 *      annoncé est réellement celui du contenu décrit ; pour la natation, chaque bloc
 *      chiffré porte une référence d'allure explicite).
 *   2) Cohérence avec les AUTRES séances de la même semaine (équilibre entre
 *      disciplines cohérent avec ce que l'athlète a demandé, pas d'séance qui
 *      contredit l'objectif d'une séance voisine).
 *   3) Cohérence à travers le programme ENTIER (progression réelle et logique de N
 *      vers N+1, cohérente avec la phase de périodisation en cours et le niveau
 *      déclaré de l'athlète).
 *   4) Cohérence de CYCLE ENTRE DISCIPLINES (natation vs vélo/course de la même
 *      semaine, même logique de mésocycle — voir la règle correspondante dans le
 *      prompt de génération, section NATATION plus haut).
 * Best-effort : un échec de cet appel (timeout, quota, JSON invalide) NE DOIT JAMAIS
 * faire échouer toute la génération du plan — on continue avec le plan tel quel et on
 * journalise l'échec, exactement comme le reste de la chaîne de robustesse déjà en place.
 */
async function reviewPlanCoherenceWithAI({ sanitized, wizardData, resolvedProfile, phase, currentPhaseKey, isTriathlon, provider = 'gemini' }) {
  const contextSummary = `Contexte de l'athlète pour cette relecture :
- Objectif : ${wizardData.sportType}${wizardData.triathlonFormat ? ` (format ${wizardData.triathlonFormat})` : ''}, niveau déclaré ${wizardData.fitnessLevel}/5, expérience ${wizardData.trainingExperience}.
- ${wizardData.maxSessionsPerWeek} séances/semaine visées, ${wizardData.hoursPerWeek}h/semaine visées, repos obligatoire le ${wizardData.offDays}.
- Phase de périodisation actuelle : ${phase.split(' :')[0]} (${currentPhaseKey}).
- Métriques connues : VMA ${resolvedProfile.vma ?? 'non renseignée'}${isTriathlon ? `, FTP ${resolvedProfile.ftp ?? 'non renseignée'}, CSS ${resolvedProfile.nat100 ?? 'non renseignée'}` : ''}.
${isTriathlon ? `- Ce que le contenu NATATION doit refléter pour ce format précis (voir critère 5 ci-dessous) : ${describeSwimFormatGuidance(wizardData.triathlonFormat)}` : ''}`;

  const prompt = `Tu es un relecteur EXPERT qui vérifie la cohérence d'un plan d'entraînement déjà généré — tu ne le regénères PAS, tu identifies UNIQUEMENT les incohérences réelles et tu proposes des corrections ciblées.

${contextSummary}

Vérifie ces 5 niveaux, dans cet ordre :
1. COHÉRENCE INTERNE de chaque séance : la durée annoncée correspond-elle vraiment à la structure décrite (échauffement + corps de séance + retour au calme) ? L'intensité/allure correspond-elle au type et au titre de la séance (une séance "récupération" ne doit pas contenir un bloc à allure seuil, une séance "fractionné" ne doit pas être quasi entièrement en endurance de base) ? Pour une séance NATATION : chaque bloc chiffré (hors souple/educ) porte-t-il bien une référence d'allure explicite (zone, "all [FORMAT]", ou allure chiffrée) — un bloc PLAQ/PULL sans aucune référence d'intensité est une incohérence à corriger, et le "desc" respecte-t-il bien les 3 blocs Échauffement/Corps de séance/Total (jamais de la prose) ?
2. COHÉRENCE AVEC LES AUTRES SÉANCES DE LA MÊME SEMAINE : la répartition entre disciplines correspond-elle à ce que l'athlète a demandé ? Deux séances ne se contredisent-elles pas (ex: une séance "affûtage/récupération" à côté d'une séance à très haut volume la même semaine sans justification) ?
3. COHÉRENCE DU PROGRAMME ENTIER (N vs N+1) : N+1 montre-t-il une vraie progression ou variation logique par rapport à N (pas une semaine quasi identique, pas une régression injustifiée) ? Est-ce cohérent avec la phase "${currentPhaseKey}" et le niveau déclaré de l'athlète ?
4. COHÉRENCE DE CYCLE ENTRE DISCIPLINES (spécifique triathlon) : la natation suit-elle la MÊME logique de mésocycle que le vélo et la course cette semaine ? Compare concrètement le contenu des séances NATATION à celui des séances CYCLISME/C.A.P de la même semaine : si le vélo/la course sont clairement en phase développement/seuil (blocs seuil, sweetspot, allure course cible) alors que la natation reste 100% technique/endurance de base sans aucun bloc seuil/CSS chiffré, c'est une incohérence à corriger — et inversement si la natation attaque des blocs "all [FORMAT]" pendant que le reste du plan est encore en endurance fondamentale pure.
5. COHÉRENCE AVEC LE FORMAT DE COURSE VISÉ (spécifique triathlon, natation) : le contenu de chaque séance NATATION correspond-il vraiment au format déclaré de l'athlète, pas un contenu générique ? Un format L/XL (half/Ironman) doit montrer une nette dominante endurance (blocs PULL/NC longs 200-800m, peu voire pas de vitesse pure) ; un format S/XS (sprint) doit montrer une dominante vitesse/technique (séries courtes 25-100m, peu de PULL long). Si toutes les séances NATATION du plan pourraient être recopiées telles quelles sur un athlète visant un autre format sans rien changer, c'est une incohérence à corriger.

Plan actuel à relire (JSON complet, semaine N et N+1) :
${JSON.stringify(sanitized)}

Ne signale QUE des incohérences réelles et concrètes (pas de remarque stylistique, pas de préférence esthétique). Si tout est cohérent, réponds avec des tableaux vides. Pour chaque correction, renvoie l'objet séance COMPLET et corrigé (même "id", mêmes champs que le schéma d'origine : type, day, title, duration, intensity, cadence, cardio, rpe, effortZone, restTime, structure, desc) — pas seulement le champ modifié.

Réponds UNIQUEMENT avec ce JSON :
{
  "issues": [ { "id": "id de la séance concernée", "week": "N ou N+1", "problem": "description courte et concrète du problème détecté" } ],
  "corrections": { "N": [ /* séances complètes corrigées, uniquement celles qui changent */ ], "N+1": [ /* idem */ ] }
}`;

  try {
    const reviewData = await callAIJSON(prompt, provider);
    const corrections = reviewData?.corrections || {};
    const fixedN = mergeWeekFix(sanitized.N, corrections.N);
    const fixedN1 = mergeWeekFix(sanitized['N+1'], corrections['N+1']);
    return {
      N: fixedN,
      'N+1': fixedN1,
      reviewIssues: Array.isArray(reviewData?.issues) ? reviewData.issues : [],
    };
  } catch (err) {
    console.warn('[gemini] Relecture de cohérence indisponible, plan conservé tel quel :', err?.message || err);
    return { N: sanitized.N, 'N+1': sanitized['N+1'], reviewIssues: [] };
  }
}

export async function generatePlanWithAI({ wizardData, profile, feedbackHistory, healthHistory, manualPaceZones, injuryLog, raceCalendar, menstrualCycle, language = 'fr', provider = 'gemini' }) {
  const goalDescription = describeGoal(wizardData);
  const timeDescription = describeTargetTime(wizardData);
  const { weeksLeft, phase, phases } = computePeriodization(wizardData.targetDate);
  const currentPhaseKey = phases?.[0]?.key || 'base';
  const macrocyclesDescription = formatMacrocyclesForPrompt(phases);
  const sessionAllocation = describeSessionAllocation(wizardData);
  const fitnessAdaptation = describeAthleteAdaptation(wizardData.fitnessLevel, wizardData.trainingExperience);
  const isTriathlon = wizardData.sportType === 'triathlon';

  const fitnessLabels = { 1: 'débutant', 2: 'novice', 3: 'intermédiaire', 4: 'confirmé', 5: 'expert/compétiteur' };
  const fitnessLabel = fitnessLabels[wizardData.fitnessLevel] || 'intermédiaire';

  // Physiologie réellement adaptée à CET athlète (mesurée > estimée depuis un chrono réel >
  // valeur déjà connue du profil > rien) — jamais une valeur inventée à partir du niveau déclaré.
  let physio = resolveAthletePhysiology(wizardData, profile);
  const trend = summarizeFeedbackTrend(feedbackHistory);
  physio = applyFeedbackTrendToPhysiology(physio, trend);

  // SIGNAL VFC (AJOUTÉ) : deuxième signal de fatigue, physiologique cette fois, indépendant du
  // ressenti déclaré (`trend` ci-dessus) — voir summarizeHrvTrend dans lib/feedback.js. N'affecte
  // JAMAIS la physiologie résolue (physio) : uniquement la charge à venir, via
  // applyFatigueAutoRegulation plus bas et le bloc de prompt ci-dessous.
  const hrvTrend = summarizeHrvTrend(healthHistory);
  const hrvBlock = hrvTrend.direction === 'low'
    ? `\nSIGNAL VFC (à prendre en compte, ne pas ignorer) :\n${hrvTrend.label}\n`
    : '';
  const injuryBlock = buildInjuryBlock(injuryLog);
  const raceCalendarBlock = buildRaceCalendarBlock(raceCalendar);
  const cyclePhaseBlock = buildCyclePhaseBlock(menstrualCycle);

  // CIBLE DE PROGRESSION : niveau visé à terme, déduit du temps/allure objectif saisi à
  // l'étape 3 du questionnaire (jamais un chiffre deviné, voir resolveTargetPhysiology).
  // Combiné au niveau ACTUEL (physio ci-dessus) et au facteur de progression de la phase
  // en cours (voir lib/periodization.js), ça donne les allures/watts RÉELLEMENT à prescrire
  // pour cette semaine — ni figés sur le niveau actuel du début à la fin, ni la cible finale
  // dès la semaine 1 (surcharge progressive).
  const targetPhysio = resolveTargetPhysiology(wizardData);
  const progressionFactor = getProgressionFactor(currentPhaseKey);
  const vmaForPrescription = targetPhysio.targetVma
    ? interpolateTowardTarget(physio.vma, targetPhysio.targetVma, currentPhaseKey)
    : physio.vma;
  // Natation : même logique que la VMA (interpolation numérique current → cible), en
  // convertissant l'allure "m:ss/100m" en secondes pour pouvoir interpoler, puis reconversion.
  const swimPaceToSeconds = (str) => {
    const m = String(str || '').match(/(\d+):(\d{2})/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const secondsToSwimPace = (sec) => {
    if (!Number.isFinite(sec)) return null;
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  };
  const currentSwimSec = swimPaceToSeconds(physio.nat100);
  const targetSwimSec = swimPaceToSeconds(targetPhysio.targetSwimPace100);
  const swimPaceForPrescription = currentSwimSec && targetSwimSec
    ? secondsToSwimPace(interpolateTowardTarget(currentSwimSec, targetSwimSec, currentPhaseKey))
    : null;
  // Vélo : pas d'unité commune fiable entre FTP (watts, mesuré) et vitesse cible (km/h,
  // déduite du temps visé) sans modèle poids/aéro qu'on refuse d'inventer — la vitesse
  // cible reste donc une référence informative pour les séances "allure de course" plutôt
  // qu'une valeur interpolée en watts (les zones de puissance restent basées sur la FTP
  // actuelle, dont l'intensité relative augmente déjà naturellement par phase — voir
  // lib/periodization.js PHASE_GUIDANCE).

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
--- Zones d'allure course à pied ---
${computeRunZones(physio.vma, manualPaceZones)}
--- Zones de puissance vélo (% FTP, méthode Coggan) ---
${computeBikeZones(physio.ftp)}
--- Zones d'allure natation (% CSS) ---
${computeSwimZones(physio.nat100)}`
    : `--- Zones de fréquence cardiaque (Karvonen) ---
${computeHrZones(physio.fcMax, physio.fcRepos)}
--- Zones d'allure course à pied ---
${computeRunZones(physio.vma, manualPaceZones)}`;

  const progressionBlock = trend.direction !== 'stable'
    ? `\nÉVOLUTION DU NIVEAU (à prendre en compte, ne pas ignorer) :\n${trend.label}\n`
    : '';

  // PROGRESSIVITÉ VERS L'OBJECTIF (AJOUTÉE) : sans ce bloc, le plan restait figé sur les
  // allures/watts ACTUELS de l'athlète du premier jour de la préparation jusqu'au dernier —
  // aucune trajectoire réelle vers le temps visé à l'étape 3 du questionnaire. C'est
  // précisément le rôle des tests terrain (VMA, CSS, FTP) injectés en semaine N quand une
  // métrique manque (voir plus bas, injectPhysioTestSessions) : sans niveau actuel MESURÉ,
  // impossible de savoir d'où partir pour construire cette trajectoire vers la cible.
  const hasTarget = targetPhysio.targetVma || targetPhysio.targetBikeSpeedKmh || targetPhysio.targetSwimPace100;
  const progressionTargetBlock = hasTarget
    ? `\n═══════════ PROGRESSIVITÉ VERS L'OBJECTIF (RÈGLE ABSOLUE) ═══════════
L'athlète ne vise pas seulement à "tenir" son niveau actuel jusqu'au jour J : il vise un temps CIBLE
(voir OBJECTIF ci-dessous), donc un niveau de performance supérieur à son niveau actuel. Le plan doit
donc faire progresser réellement les allures/watts/puissances prescrits au fil des semaines vers cette
cible — jamais rester figé sur les valeurs "actuelles" ci-dessus du premier jour au dernier, et jamais
non plus sauter directement à la cible dès cette semaine (surcharge progressive obligatoire).
${targetPhysio.targetVma ? `- VMA : niveau actuel ${fmtMetric(physio.vma, ' km/h')} → cible ${targetPhysio.targetVma} km/h (${targetPhysio.targetVmaSource}). Pour LA PHASE ACTUELLE (${currentPhaseKey}), utilise une VMA de prescription intermédiaire d'environ ${vmaForPrescription ?? '—'} km/h pour calculer les allures course à pied de séance (ni le niveau actuel brut, ni la cible finale) — les zones précalculées ci-dessous en tiennent déjà compte.` : ''}
${targetPhysio.targetSwimPace100 ? `- Natation : allure actuelle ${physio.nat100 ? `${physio.nat100}/100m` : 'non mesurée'} → cible ${targetPhysio.targetSwimPace100}/100m (${targetPhysio.targetSwimPaceSource}). Pour la phase actuelle, vise une allure de prescription d'environ ${swimPaceForPrescription ?? physio.nat100 ?? '—'}/100m.` : ''}
${targetPhysio.targetBikeSpeedKmh ? `- Vélo : vitesse moyenne CIBLE ~${targetPhysio.targetBikeSpeedKmh} km/h (${targetPhysio.targetBikeSpeedSource}) — utilise cette vitesse comme repère pour les séances "allure de course"/simulation en phase spécifique/pic, en gardant les zones de puissance ci-dessous (basées sur la FTP actuelle) pour le reste des séances.` : ''}
Plus la phase avance (base → développement → pic → affûtage), plus les séances clés (allure spécifique,
simulation de course) doivent se rapprocher de la cible — c'est la SOURCE de la progressivité du plan,
pas une suggestion facultative.
═══════════════════════════════════════════════════════════════════`
    : `\n(Aucun temps cible chiffré exploitable pour l'instant — objectif probablement non renseigné en détail à l'étape 3. Utilise des repères RPE/progression qualitative.)\n`;

  const workoutSchema = buildWorkoutSchema({
    maxSessionsPerWeek: wizardData.maxSessionsPerWeek,
    offDays: wizardData.offDays,
    sportType: wizardData.sportType,
    fitnessLevel: wizardData.fitnessLevel,
    trainingExperience: wizardData.trainingExperience,
    runningSubtype: wizardData.runningSubtype,
    hoursPerWeek: wizardData.hoursPerWeek,
    triathlonFormat: wizardData.triathlonFormat,
    ppgEnabled: wizardData.ppgEnabled !== false,
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
Genre ${wizardData.gender}, poids ${wizardData.weight || profile.weight}kg, niveau déclaré ${wizardData.fitnessLevel}/5 (${fitnessLabel}), expérience d'entraînement : ${EXPERIENCE_LABELS[wizardData.trainingExperience] || EXPERIENCE_LABELS.intermediaire}.
${physioBlock}
${progressionBlock}
${hrvBlock}
${injuryBlock}
${raceCalendarBlock}
${cyclePhaseBlock}
${progressionTargetBlock}
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

  let data = await callAIJSON(prompt, provider);

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
    const fixData = await callAIJSON(fixPrompt, provider);
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

  // ROBUSTESSE (même logique que cycles ci-dessus) : la date d'objectif pilote le compte à
  // rebours de l'onglet "Objectif" (computeRaceStats exige un format ISO strict pour être
  // parsable) — on ne fait donc JAMAIS confiance à ce que l'IA a recopié dans sa réponse
  // (déjà vu : reformatée en texte libre, ou simplement omise), on la fixe de façon
  // déterministe depuis la date choisie au questionnaire, seule source fiable.
  data.trainingPlan.date = wizardData.targetDate;

  const resolvedProfile = {
    ...profile,
    vma: physio.vma,
    fcMax: physio.fcMax,
    fcRepos: physio.fcRepos,
    ...(isTriathlon ? { ftp: physio.ftp, nat100: physio.nat100 } : {}),
    weight: Number(wizardData.weight) || profile.weight,
    // Cible de progression (voir resolveTargetPhysiology) — exposée au profil pour que
    // l'onglet Objectif puisse afficher "niveau actuel testé → cible visée" côte à côte.
    targetPhysio,
    progressionFactor,
    // BUG RÉEL CORRIGÉ (test VMA deux fois de suite) : `physioTestProposedAt` doit être
    // reporté depuis le profil existant (sinon il est perdu à chaque génération et le
    // cooldown ci-dessous ne sert à rien) — voir plus bas où il est mis à jour uniquement
    // pour les métriques réellement (re)testées cette fois-ci.
    physioTestProposedAt: { ...(profile?.physioTestProposedAt || {}) },
  };

  // Variante UNIQUEMENT interne (jamais renvoyée au client, voir `return` en fin de
  // fonction qui expose `resolvedProfile` sans ce champ) : `paceZones` est déjà persisté
  // côté client sous sa propre clé de storage (voir lib/storage.js, components/
  // ZoneCharts.js) — le dupliquer dans le profil renvoyé créerait une deuxième source de
  // vérité qui pourrait devenir périmée. On l'ajoute donc seulement ici, pour que
  // sanitizeWorkout/checkZoneRangeWarnings (garde-fous déterministes ci-dessous)
  // appliquent la même priorité aux zones calibrées manuellement que le prompt IA
  // (voir zonesBlock/computeRunZones plus haut).
  const profileForSanitize = { ...resolvedProfile, paceZones: manualPaceZones };

  let sanitized = {
    // ensureAllDaysPresent AVANT sanitizeWorkout : si la réponse brute de l'IA ne couvre
    // pas les 7 jours (réponse incomplète, ça arrive), on comble les jours manquants par
    // un REPOS neutre ICI, avant que checkSessionCountCoherence/enforceSessionCount et
    // toute la chaîne de garde-fous ci-dessous n'opèrent — sinon enforceSessionCount ne
    // voit que les quelques jours réellement présents et empile toutes les séances
    // manquantes dessus au lieu de les répartir sur la semaine entière (bug réel
    // observé : jusqu'à 7 séances sur un seul jour pendant que le reste restait vide).
    N: ensureAllDaysPresent(data.workouts?.N || []).map((w) => sanitizeWorkout(w, profileForSanitize)),
    'N+1': ensureAllDaysPresent(data.workouts?.['N+1'] || []).map((w) => sanitizeWorkout(w, profileForSanitize)),
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
      sanitized[weekKey] = enforceSessionCount(sanitized[weekKey], wizardData.maxSessionsPerWeek, wizardData.offDays, profileForSanitize, wizardData.sportType);
    }
    // Filet de sécurité INDÉPENDANT du nombre total de séances : même quand le total
    // est correct, l'IA génère parfois deux séances de la même discipline sur un même
    // jour double (ex: 2x natation) — ce que enforceSessionCount ne voit pas s'il n'est
    // pas déclenché (nombre total déjà correct). On corrige systématiquement, AVANT le
    // dédoublonnage de titres identiques ci-dessous (ordre important : le rebalance peut
    // déplacer une séance vers un jour qui devient alors le nouveau doublon à dédupliquer).
    sanitized[weekKey] = rebalanceSameDisciplineDoubles(sanitized[weekKey], wizardData.sportType, wizardData.offDays, wizardData.maxSessionsPerWeek);
    // Filet de sécurité INDÉPENDANT du nombre total de séances et du précédent : même
    // quand aucune discipline n'est strictement dupliquée, l'IA empile parfois 3-4
    // séances distinctes sur un même jour (ex: sortie longue course + vélo + natation
    // PUIS un brick course le même samedi) — aucune cohérence, et un enchaînement ne
    // doit jamais cohabiter avec une autre séance le même jour puisqu'il combine déjà
    // 2 disciplines. On replafonne à 2 séances/jour (1 si le jour contient un brick, 3
    // si >12 séances/semaine visées — voir enforceMaxSessionsPerDay), puis on relance le
    // rebalance ci-dessus au cas où le déplacement recréerait un doublon de discipline sur
    // le jour de destination. Enfin, sur les journées à triple séance ainsi conservées, on
    // force la 3e séance (la plus courte) en peu intensive — règle explicite de l'athlète.
    sanitized[weekKey] = enforceMaxSessionsPerDay(sanitized[weekKey], wizardData.offDays, wizardData.sportType, wizardData.maxSessionsPerWeek);
    sanitized[weekKey] = rebalanceSameDisciplineDoubles(sanitized[weekKey], wizardData.sportType, wizardData.offDays, wizardData.maxSessionsPerWeek);
    sanitized[weekKey] = enforceThirdSessionLowIntensity(sanitized[weekKey]);
    // Filet de sécurité INDÉPENDANT du nombre total de séances : même quand le total
    // est correct, l'IA génère parfois deux séances quasi identiques sur un même
    // jour double (ex: 2x le même footing). On corrige systématiquement.
    sanitized[weekKey] = dedupeIdenticalSameDaySessions(sanitized[weekKey]).map((w) => sanitizeWorkout(w, profileForSanitize));

    // ROBUSTESSE : même logique que ci-dessus pour le nombre de séances — la progressivité
    // pour un niveau débutant/novice (fitnessLevel <= 2) est trop importante pour dépendre
    // uniquement de l'obéissance de l'IA au prompt (voir describeAthleteAdaptation). On
    // plafonne donc ici, de façon déterministe, les séances trop exigeantes pour ce profil
    // en phase base/développement (jamais en peak/taper).
    sanitized[weekKey] = enforceBeginnerProgression(sanitized[weekKey], wizardData.fitnessLevel, currentPhaseKey, wizardData.trainingExperience);

    // ROBUSTESSE (AJOUTÉE) : un débutant complet/novice qui démarre son TOUT PREMIER plan
    // (aucun historique de ressenti) ne doit pas se voir imposer d'emblée le volume/nombre
    // de séances cible déclaré au questionnaire — la progressivité doit aussi jouer sur le
    // VOLUME GLOBAL des toutes premières semaines, pas seulement sur le plafonnement séance
    // par séance ci-dessus. Sans historique, enforceBeginnerProgression seul ne réduit que
    // les séances individuellement trop dures/longues, jamais le total hebdomadaire.
    sanitized[weekKey] = applyBeginnerFirstPlanRamp(sanitized[weekKey], wizardData.fitnessLevel, wizardData.trainingExperience, feedbackHistory, weekKey);

    // ROBUSTESSE (AJOUTÉE) : garantit un volume de natation minimum cohérent avec le niveau
    // déclaré — voir enforceSwimVolumeFloor dans lib/workouts.js pour le détail (le prompt
    // seul ne suffisait pas à empêcher des séances quasi réduites à l'échauffement pour un
    // niveau expert).
    sanitized[weekKey] = enforceSwimVolumeFloor(sanitized[weekKey], wizardData.fitnessLevel, wizardData.trainingExperience, currentPhaseKey);

    // ROBUSTESSE (AJOUTÉE) : même principe pour les sorties longues course/vélo — un profil
    // confirmé/expert a régulièrement obtenu des sorties longues plafonnées à ~2h vélo /
    // <1h30 course, très en dessous des standards réels de préparation longue distance à ce
    // niveau (voir enforceLongSessionFloor dans lib/workouts.js pour le détail des repères).
    sanitized[weekKey] = enforceLongSessionFloor(sanitized[weekKey], wizardData.trainingExperience, currentPhaseKey);

    // ROBUSTESSE : double seuil hors critères (niveau/volume insuffisant, voir
    // buildEnduranceExpertRules) — corrigé déterministiquement, jamais laissé à la seule
    // obéissance du prompt.
    sanitized[weekKey] = enforceDoubleThresholdEligibility(sanitized[weekKey], wizardData.fitnessLevel, wizardData.hoursPerWeek, wizardData.trainingExperience);

    // ROBUSTESSE : volume forcé à la baisse en phase d'affûtage (40-60% de réduction attendue).
    sanitized[weekKey] = enforceTaperVolume(sanitized[weekKey], currentPhaseKey, wizardData.hoursPerWeek);

    // ROBUSTESSE : signal de fatigue remonté par l'athlète (ressenti récent plus dur que prévu)
    // ET/OU par sa VFC (en baisse notable vs sa propre moyenne, voir hrvTrend ci-dessus) -> on
    // n'attend pas la prochaine génération pour réagir, on allège dès cette semaine.
    sanitized[weekKey] = applyFatigueAutoRegulation(sanitized[weekKey], { trendHarder: trend.direction === 'harder', hrvLow: hrvTrend.low });

    // ROBUSTESSE (AJOUTÉE) : symétrique de la ligne précédente — un ressenti récent
    // nettement PLUS FACILE que prévu doit aussi se traduire en une correction déterministe
    // (densifier une séance clé) et pas seulement en un indice textuel laissé à l'appréciation
    // de l'IA (voir progressionBlock plus bas, qui ne faisait auparavant que "suggérer").
    sanitized[weekKey] = applyEasierTrendProgression(sanitized[weekKey], trend.direction);
  }

  // ROBUSTESSE (AJOUTÉE) : quand une métrique physiologique (VMA/FTP/CSS) manque, on
  // n'attend pas que l'IA le "suggère" dans une description (peu fiable, voir bug corrigé
  // dans lib/workouts.js) — on injecte une VRAIE séance de test terrain en semaine N,
  // à la place d'une séance neutre déjà présente pour cette discipline.
  //
  // BUG RÉEL CORRIGÉ (deux séances de test VMA à la suite) : tant que l'athlète n'a pas
  // reporté le résultat du test dans son profil, `physio.vmaSource` reste "non renseignée"
  // à CHAQUE génération suivante (nouvelle semaine, replanification...) — sans garde-fou,
  // une nouvelle séance de test était donc réinjectée à chaque fois, y compris la semaine
  // suivant immédiatement le test précédent. Un test terrain (effort maximal) ne doit pas
  // se répéter chaque semaine : on applique un cooldown (le temps que l'athlète récupère
  // ET ait l'occasion de reporter son résultat) avant d'en reproposer un pour la même
  // métrique, même si elle est toujours "non renseignée" derrière.
  const TEST_COOLDOWN_DAYS = 12;
  const DISCIPLINE_METRIC_KEY = { 'C.A.P': 'vma', CYCLISME: 'ftp', NATATION: 'css' };
  const candidateDisciplines = [];
  if (physio.vmaSource?.startsWith('non renseignée')) candidateDisciplines.push('C.A.P');
  if (isTriathlon && physio.ftpSource?.startsWith('non renseignée')) candidateDisciplines.push('CYCLISME');
  if (isTriathlon && physio.nat100Source?.startsWith('non renseignée')) candidateDisciplines.push('NATATION');
  const now = Date.now();
  const missingMetrics = candidateDisciplines.filter((d) => {
    const lastProposed = resolvedProfile.physioTestProposedAt[DISCIPLINE_METRIC_KEY[d]];
    if (!lastProposed) return true;
    const daysSince = (now - new Date(lastProposed).getTime()) / 86_400_000;
    return daysSince >= TEST_COOLDOWN_DAYS;
  });
  sanitized.N = injectPhysioTestSessions(sanitized.N, missingMetrics, { bikeTestEquipment: wizardData.bikeTestEquipment });
  // On horodate uniquement les métriques réellement (re)proposées cette fois-ci — pas
  // toutes les `candidateDisciplines`, sinon une métrique déjà "en cooldown" verrait son
  // horodatage rafraîchi sans qu'aucun test n'ait été réellement reproposé.
  missingMetrics.forEach((d) => {
    resolvedProfile.physioTestProposedAt[DISCIPLINE_METRIC_KEY[d]] = new Date(now).toISOString();
  });

  // ROBUSTESSE : enchaînement de deux séances difficiles consécutives, y compris à cheval sur la
  // frontière semaine N / semaine N+1 (dimanche -> lundi) — ne peut être vérifié qu'une fois les
  // deux semaines assemblées.
  const hardDaysFixed = enforceNoConsecutiveHardDays(sanitized.N, sanitized['N+1']);
  sanitized.N = hardDaysFixed.N;
  sanitized['N+1'] = hardDaysFixed['N+1'];

  // PASSE DE RELECTURE DE COHÉRENCE (AJOUTÉE) — voir reviewPlanCoherenceWithAI ci-dessus pour
  // le détail des 3 niveaux vérifiés. S'exécute en dernier, sur le plan déjà passé par TOUS les
  // garde-fous déterministes ci-dessus, pour relire l'état réellement final.
  const reviewed = await reviewPlanCoherenceWithAI({ sanitized, wizardData, resolvedProfile, phase, currentPhaseKey, isTriathlon, provider });
  sanitized.N = reviewed.N;
  sanitized['N+1'] = reviewed['N+1'];

  // AVERTISSEMENTS non bloquants (jamais de correction automatique hasardeuse ici) : volume
  // hebdo hors fourchette, semaines N/N+1 quasi identiques, monotonie de charge élevée, valeurs
  // chiffrées (allure/watts) incohérentes avec le profil réel — remontés à l'utilisateur/au chat
  // pour objectiver un doute plutôt que silencieusement ignorés. Ce sont des points qui restent
  // À TRAITER (rien n'a corrigé le plan pour ceux-là) : distincts des `autoFixNotes` ci-dessous.
  const qualityWarnings = [
    checkWeeklyVolumeWarning(sanitized.N, wizardData.hoursPerWeek, 'N'),
    checkWeeklyVolumeWarning(sanitized['N+1'], wizardData.hoursPerWeek, 'N+1'),
    checkWeekSimilarityWarning(sanitized.N, sanitized['N+1']),
    checkMonotonyWarning(sanitized.N, 'N'),
    checkMonotonyWarning(sanitized['N+1'], 'N+1'),
    checkPolarizationWarning(sanitized.N, 'N'),
    checkPolarizationWarning(sanitized['N+1'], 'N+1'),
    checkTrailElevationWarning(sanitized.N, sanitized['N+1'], wizardData.sportType, wizardData.runningSubtype),
    ...checkZoneRangeWarnings(sanitized.N, profileForSanitize, 'N'),
    ...checkZoneRangeWarnings(sanitized['N+1'], profileForSanitize, 'N+1'),
  ].filter(Boolean);

  // BUG UX CORRIGÉ : les incohérences repérées par la relecture IA (`reviewed.reviewIssues`)
  // sont en réalité DÉJÀ corrigées à ce stade — `reviewPlanCoherenceWithAI` a fusionné les
  // séances corrigées dans `sanitized` juste au-dessus. Avant, ces items étaient mélangés tels
  // quels aux vrais avertissements non résolus (`qualityWarnings`), avec un texte au présent
  // ("ne correspond pas", "est incohérente") qui donnait l'impression d'un problème persistant
  // à traiter par l'athlète — alors qu'il n'y avait rien à faire, c'était déjà réglé. On les
  // sépare donc dans leur propre liste, reformulés au passé ("a été ajustée") pour que ce soit
  // explicitement de la transparence sur une correction automatique, pas une alerte.
  const autoFixNotes = reviewed.reviewIssues.map((i) => {
    const weekPart = i.week ? `Semaine ${i.week}` : 'Plan';
    return `${weekPart} : ${i.problem} → ajusté automatiquement.`;
  });

  return { trainingPlan: data.trainingPlan, workouts: sanitized, resolvedProfile, qualityWarnings, autoFixNotes };
}

/**
 * RÉGÉNÉRATION FORCÉE D'UNE SEULE SEMAINE (demande explicite : bouton "Forcer la
 * régénération" dans l'onglet Calendrier — l'athlète a du mal à être sûr que le plan a été
 * généré correctement et veut pouvoir relancer la génération à la demande).
 *
 * Contrairement à `generatePlanWithAI` ci-dessus, qui régénère N ET N+1 ET l'objectif entier
 * (et remet donc à zéro chat/feedback côté client, voir handleWizardComplete), cette fonction :
 *   - ne régénère QUE la semaine `weekKey` ('N' ou 'N+1') ;
 *   - laisse l'AUTRE semaine strictement inchangée (elle est fournie à l'IA comme contexte de
 *     PROGRESSION/VARIATION, jamais renvoyée par l'IA, et les corrections éventuelles de la
 *     relecture de cohérence ciblant l'autre semaine sont ignorées — voir plus bas) ;
 *   - ne touche ni à `trainingPlan.cycles`, ni à l'objectif, ni à l'historique de chat/feedback.
 *
 * Elle réutilise EXACTEMENT la même chaîne de garde-fous déterministes que la boucle
 * `for (const weekKey of ['N', 'N+1'])` de generatePlanWithAI ci-dessus (mêmes fonctions,
 * dans le même ordre) — voir les commentaires détaillés sur chacune plus haut dans ce fichier,
 * non dupliqués ici pour éviter la dérive entre les deux copies.
 */
export async function regenerateWeekWithAI({ weekKey = 'N+1', profile, workouts, trainingPlan, constraints, feedbackHistory, healthHistory, manualPaceZones, injuryLog, raceCalendar, menstrualCycle, language = 'fr', provider = 'gemini' }) {
  if (weekKey !== 'N' && weekKey !== 'N+1') weekKey = 'N+1';
  const otherWeekKey = weekKey === 'N' ? 'N+1' : 'N';
  const wizardData = constraints || {};
  const isTriathlon = wizardData.sportType !== 'running';
  const otherWeekWorkouts = ensureAllDaysPresent(workouts?.[otherWeekKey] || []);

  const goalDescription = describeGoal(wizardData);
  const timeDescription = describeTargetTime(wizardData);
  const { weeksLeft, phase, phases } = computePeriodization(wizardData.targetDate);
  const currentPhaseKey = phases?.[0]?.key || 'base';
  const macrocyclesDescription = formatMacrocyclesForPrompt(phases);
  const sessionAllocation = describeSessionAllocation(wizardData);
  const fitnessAdaptation = describeAthleteAdaptation(wizardData.fitnessLevel, wizardData.trainingExperience);

  const fitnessLabels = { 1: 'débutant', 2: 'novice', 3: 'intermédiaire', 4: 'confirmé', 5: 'expert/compétiteur' };
  const fitnessLabel = fitnessLabels[wizardData.fitnessLevel] || 'intermédiaire';

  let physio = resolveAthletePhysiology(wizardData, profile);
  const trend = summarizeFeedbackTrend(feedbackHistory);
  physio = applyFeedbackTrendToPhysiology(physio, trend);
  const hrvTrend = summarizeHrvTrend(healthHistory);
  const hrvBlock = hrvTrend.direction === 'low'
    ? `\nSIGNAL VFC (à prendre en compte, ne pas ignorer) :\n${hrvTrend.label}\n`
    : '';
  const injuryBlock = buildInjuryBlock(injuryLog);
  const raceCalendarBlock = buildRaceCalendarBlock(raceCalendar);
  const cyclePhaseBlock = buildCyclePhaseBlock(menstrualCycle);

  const targetPhysio = resolveTargetPhysiology(wizardData);
  const progressionFactor = getProgressionFactor(currentPhaseKey);

  const fmtMetric = (value, unit) => (value === null || value === undefined ? 'non renseignée' : `${value}${unit}`);
  const hasUnknown = [physio.vmaSource, physio.ftpSource, physio.nat100Source, physio.fcMaxSource, physio.fcReposSource]
    .filter(Boolean).some((s) => s.startsWith('non renseignée'));
  const physioBlock = isTriathlon
    ? `VMA ${fmtMetric(physio.vma, ' km/h')} (${physio.vmaSource}), FTP ${fmtMetric(physio.ftp, 'W')} (${physio.ftpSource}), CSS natation ${physio.nat100 ? `${physio.nat100}/100m` : 'non renseignée'} (${physio.nat100Source}), FC max ${fmtMetric(physio.fcMax, ' bpm')} (${physio.fcMaxSource}), FC repos ${fmtMetric(physio.fcRepos, ' bpm')} (${physio.fcReposSource}).${hasUnknown ? ' Pour toute métrique "non renseignée", reste prudent (repères RPE plutôt que valeurs chiffrées précises pour cette discipline).' : ''}`
    : `VMA ${fmtMetric(physio.vma, ' km/h')} (${physio.vmaSource}), FC max ${fmtMetric(physio.fcMax, ' bpm')} (${physio.fcMaxSource}), FC repos ${fmtMetric(physio.fcRepos, ' bpm')} (${physio.fcReposSource}).${hasUnknown ? ' Pour toute métrique "non renseignée", reste prudent (repères RPE plutôt que valeurs chiffrées précises).' : ''}`;

  const zonesBlock = isTriathlon
    ? `--- Zones de fréquence cardiaque (Karvonen) ---
${computeHrZones(physio.fcMax, physio.fcRepos)}
--- Zones d'allure course à pied ---
${computeRunZones(physio.vma, manualPaceZones)}
--- Zones de puissance vélo (% FTP, méthode Coggan) ---
${computeBikeZones(physio.ftp)}
--- Zones d'allure natation (% CSS) ---
${computeSwimZones(physio.nat100)}`
    : `--- Zones de fréquence cardiaque (Karvonen) ---
${computeHrZones(physio.fcMax, physio.fcRepos)}
--- Zones d'allure course à pied ---
${computeRunZones(physio.vma, manualPaceZones)}`;

  const workoutSchema = buildWorkoutSchema({
    maxSessionsPerWeek: wizardData.maxSessionsPerWeek,
    offDays: wizardData.offDays,
    sportType: wizardData.sportType,
    fitnessLevel: wizardData.fitnessLevel,
    trainingExperience: wizardData.trainingExperience,
    runningSubtype: wizardData.runningSubtype,
    hoursPerWeek: wizardData.hoursPerWeek,
    triathlonFormat: wizardData.triathlonFormat,
    ppgEnabled: wizardData.ppgEnabled !== false,
  });

  const prompt = `Tu es un entraîneur de triathlon et de course à pied EXPERT, diplômé, avec 15 ans d'expérience
d'encadrement d'athlètes du débutant au compétiteur. Tu appliques rigoureusement la méthodologie ACSM,
les principes de périodisation classique (base → développement → affûtage), le principe de surcharge
progressive, la règle des 80/20, et tu es intraitable sur la prévention des blessures par surcharge.

${languageInstruction(language)}
═══════════ PROFIL DE L'ATHLÈTE ═══════════
${wizardData.firstName ? `Prénom : ${wizardData.firstName}.` : ''}
Genre ${wizardData.gender}, poids ${wizardData.weight || profile.weight}kg, niveau déclaré ${wizardData.fitnessLevel}/5 (${fitnessLabel}), expérience d'entraînement : ${EXPERIENCE_LABELS[wizardData.trainingExperience] || EXPERIENCE_LABELS.intermediaire}.
${physioBlock}
${hrvBlock}
${injuryBlock}
${raceCalendarBlock}
${cyclePhaseBlock}
ADAPTATION AU NIVEAU (obligatoire, ne pas ignorer) :
${fitnessAdaptation}

TABLES DE ZONES PRÉCALCULÉES POUR CE PROFIL (utilise EXCLUSIVEMENT ces valeurs) :
${zonesBlock}

═══════════ OBJECTIF ═══════════
${goalDescription}
${timeDescription}
Date de l'objectif : ${wizardData.targetDate} (${weeksLeft} semaines restantes)
Phase de périodisation actuelle : ${phase}
STRUCTURE MACRO (déjà fixée, ne la recalcule pas, ne la renvoie pas) :
${macrocyclesDescription}

RÉPARTITION DES SÉANCES PAR DISCIPLINE (obligatoire) :
${sessionAllocation}

═══════════ CONTRAINTES DE L'ATHLÈTE ═══════════
Disponibilités : ~${wizardData.hoursPerWeek}h/semaine réparties sur EXACTEMENT ${wizardData.maxSessionsPerWeek} séances/semaine.
Repos obligatoire le ${wizardData.offDays}.

${workoutSchema}

═══════════ RÉGÉNÉRATION CIBLÉE — SEMAINE "${weekKey}" UNIQUEMENT ═══════════
L'athlète a explicitement demandé, via un bouton dédié, de régénérer ENTIÈREMENT la semaine "${weekKey}"
(7 jours), parce qu'il/elle a un doute sur sa cohérence (nombre de séances, séances empilées le même
jour, brick mal placé, etc.). L'AUTRE semaine ("${otherWeekKey}") reste STRICTEMENT INCHANGÉE — ne la
renvoie PAS dans ta réponse, elle t'est donnée ci-dessous UNIQUEMENT pour assurer une progression ou
variation réelle et logique par rapport à elle (${otherWeekKey === 'N' ? "elle précède la semaine à régénérer" : "elle suit la semaine à régénérer"}) :
${JSON.stringify(otherWeekWorkouts)}

Réponds UNIQUEMENT avec ce JSON (UN SEUL tableau de 7 entrées, pour la semaine "${weekKey}" seulement) :
{ "workouts": { "${weekKey}": [ /* 7 entrées : séances + repos, phase: ${phase.split(' :')[0]} */ ] } }
`;

  let data = await callAIJSON(prompt, provider);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    const rawList = { [weekKey]: data.workouts?.[weekKey] || [] };
    const incomplete = getIncompleteWorkouts(rawList);
    if (incomplete.length === 0) break;
    const fixPrompt = `Complète ces séances incomplètes avec un contenu précis et spécifique (jamais générique).
Champs manquants ou insuffisants : ${JSON.stringify(incomplete)}
Séances actuelles : ${JSON.stringify(rawList)}
${workoutSchema}
Réponds UNIQUEMENT avec les séances corrigées (tu peux ne renvoyer QUE les jours concernés) :
{ "workouts": { "${weekKey}": [...] } }`;
    const fixData = await callAIJSON(fixPrompt, provider);
    data = { ...data, workouts: { [weekKey]: mergeWeekFix(rawList[weekKey], fixData.workouts?.[weekKey]) } };
  }

  const resolvedProfile = {
    ...profile,
    vma: physio.vma,
    fcMax: physio.fcMax,
    fcRepos: physio.fcRepos,
    ...(isTriathlon ? { ftp: physio.ftp, nat100: physio.nat100 } : {}),
  };
  const profileForSanitize = { ...resolvedProfile, paceZones: manualPaceZones };

  // Même chaîne de garde-fous déterministes que generatePlanWithAI (voir plus haut pour le
  // détail commenté de chaque étape), appliquée uniquement à la semaine régénérée.
  let target = ensureAllDaysPresent(data.workouts?.[weekKey] || []).map((w) => sanitizeWorkout(w, profileForSanitize));
  const issues = checkSessionCountCoherence(target, wizardData.maxSessionsPerWeek, wizardData.offDays);
  if (issues.length > 0) {
    target = enforceSessionCount(target, wizardData.maxSessionsPerWeek, wizardData.offDays, profileForSanitize, wizardData.sportType);
  }
  target = rebalanceSameDisciplineDoubles(target, wizardData.sportType, wizardData.offDays, wizardData.maxSessionsPerWeek);
  target = enforceMaxSessionsPerDay(target, wizardData.offDays, wizardData.sportType, wizardData.maxSessionsPerWeek);
  target = rebalanceSameDisciplineDoubles(target, wizardData.sportType, wizardData.offDays, wizardData.maxSessionsPerWeek);
  target = enforceThirdSessionLowIntensity(target);
  target = dedupeIdenticalSameDaySessions(target).map((w) => sanitizeWorkout(w, profileForSanitize));
  target = enforceBeginnerProgression(target, wizardData.fitnessLevel, currentPhaseKey, wizardData.trainingExperience);
  target = applyBeginnerFirstPlanRamp(target, wizardData.fitnessLevel, wizardData.trainingExperience, feedbackHistory, weekKey);
  target = enforceSwimVolumeFloor(target, wizardData.fitnessLevel, wizardData.trainingExperience, currentPhaseKey);
  target = enforceLongSessionFloor(target, wizardData.trainingExperience, currentPhaseKey);
  target = enforceDoubleThresholdEligibility(target, wizardData.fitnessLevel, wizardData.hoursPerWeek, wizardData.trainingExperience);
  target = enforceTaperVolume(target, currentPhaseKey, wizardData.hoursPerWeek);
  target = applyFatigueAutoRegulation(target, { trendHarder: trend.direction === 'harder', hrvLow: hrvTrend.low });
  target = applyEasierTrendProgression(target, trend.direction);

  // Enchaînement de séances difficiles à cheval sur la frontière N/N+1 : on vérifie contre
  // l'autre semaine (inchangée), mais on ne garde QUE la correction sur la semaine régénérée.
  const hardDaysFixed = weekKey === 'N'
    ? enforceNoConsecutiveHardDays(target, otherWeekWorkouts)
    : enforceNoConsecutiveHardDays(otherWeekWorkouts, target);
  target = hardDaysFixed[weekKey];

  // Relecture de cohérence IA (best-effort) — voir reviewPlanCoherenceWithAI ci-dessus. On
  // lui donne les 2 semaines pour le contexte de progression N->N+1, mais on IGNORE toute
  // correction qu'elle proposerait sur l'autre semaine : elle doit rester strictement intacte.
  const sanitizedForReview = weekKey === 'N' ? { N: target, 'N+1': otherWeekWorkouts } : { N: otherWeekWorkouts, 'N+1': target };
  const reviewed = await reviewPlanCoherenceWithAI({ sanitized: sanitizedForReview, wizardData, resolvedProfile, phase, currentPhaseKey, isTriathlon, provider });
  target = reviewed[weekKey];

  const qualityWarnings = [
    checkWeeklyVolumeWarning(target, wizardData.hoursPerWeek, weekKey),
    checkWeekSimilarityWarning(weekKey === 'N' ? target : otherWeekWorkouts, weekKey === 'N' ? otherWeekWorkouts : target),
    checkMonotonyWarning(target, weekKey),
    checkPolarizationWarning(target, weekKey),
    checkTrailElevationWarning(weekKey === 'N' ? target : otherWeekWorkouts, weekKey === 'N' ? otherWeekWorkouts : target, wizardData.sportType, wizardData.runningSubtype),
    ...checkZoneRangeWarnings(target, profileForSanitize, weekKey),
  ].filter(Boolean);

  const newWorkouts = { ...workouts, [weekKey]: target };

  return { workouts: newWorkouts, resolvedProfile, qualityWarnings };
}

export async function chatWithCoach({ message, profile, workouts, trainingPlan, intent, sportType, constraints, feedbackHistory, healthHistory, manualPaceZones, injuryLog, raceCalendar, menstrualCycle, language = 'fr', provider = 'gemini' }) {
  const intentInstruction = intent === 'add'
    ? `L'athlète veut AJOUTER une séance supplémentaire, PAS remplacer une séance existante. Chaque patch doit avoir "patchMode": "add" et un "id" nouveau (jamais l'id d'une séance existante).
${constraints?.maxSessionsPerWeek ? `⚠️ Ajouter une séance fait dépasser les ${constraints.maxSessionsPerWeek} séances/semaine déclarées au questionnaire — précise-le clairement à l'athlète dans ta réponse et propose plutôt d'alléger une séance existante si le volume ${constraints.hoursPerWeek ? `(${constraints.hoursPerWeek}h/sem déclarées) ` : ''}ne permet pas d'en absorber une de plus, sauf si l'athlète insiste explicitement.` : ''}`
    : intent === 'modify'
      ? `L'athlète veut MODIFIER une séance existante. Chaque patch doit avoir "patchMode": "modify" et reprendre le "id" ou le "day" exact de la séance visée. Ne change JAMAIS le nombre total de séances/semaine sans que l'athlète le demande explicitement.`
      : `Déduis toi-même s'il s'agit d'un ajout ("patchMode": "add") ou d'une modification ("patchMode": "modify") d'après le message. Par défaut, ne change JAMAIS le nombre total de séances/semaine ni les jours de repos obligatoires sans demande explicite de l'athlète.`;

  const trend = summarizeFeedbackTrend(feedbackHistory);
  // SIGNAL VFC (AJOUTÉ) : même signal que dans generatePlanWithAI (voir lib/feedback.js), en
  // simple information textuelle ici (le chat ne pilote pas applyFatigueAutoRegulation, qui ne
  // s'applique qu'à la génération d'un plan complet) — utile si l'athlète demande par exemple
  // "pourquoi tu me proposes d'alléger ?" ou une action d'allègement via le chat.
  const hrvTrend = summarizeHrvTrend(healthHistory);
  const injuryBlock = buildInjuryBlock(injuryLog);
  const raceCalendarBlock = buildRaceCalendarBlock(raceCalendar);
  const cyclePhaseBlock = buildCyclePhaseBlock(menstrualCycle);
  const trendParts = [
    trend.direction !== 'stable' ? `TENDANCE RÉCENTE DE L'ATHLÈTE (à prendre en compte pour calibrer tes propositions) :\n${trend.label}` : '',
    hrvTrend.direction === 'low' ? `SIGNAL VFC (à prendre en compte) :\n${hrvTrend.label}` : '',
    injuryBlock ? injuryBlock.trim() : '',
    raceCalendarBlock ? raceCalendarBlock.trim() : '',
    cyclePhaseBlock ? cyclePhaseBlock.trim() : '',
  ].filter(Boolean);
  const trendInstruction = trendParts.length ? `\n${trendParts.join('\n\n')}\n` : '';

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
    fitnessLevel: constraints?.fitnessLevel,
    trainingExperience: constraints?.trainingExperience,
    runningSubtype: constraints?.runningSubtype,
    hoursPerWeek: constraints?.hoursPerWeek,
    triathlonFormat: constraints?.triathlonFormat,
    ppgEnabled: constraints?.ppgEnabled !== false,
  });

  // Zones précalculées (mêmes fonctions que generatePlanWithAI/regenerateWeekWithAI,
  // voir plus haut) — sans ce bloc, un ajustement demandé via le chat (ex: "allège ma
  // sortie de dimanche") ignorait les zones d'allure course calibrées manuellement par
  // l'athlète dans l'onglet Profil (voir components/ZoneCharts.js) : `manualPaceZones`
  // n'était même pas reçu par cette fonction jusqu'ici. Zones FC/vélo/natation incluses
  // aussi pour rester cohérent avec le reste des séances déjà générées.
  const zonesBlock = sportType === 'triathlon'
    ? `--- Zones de fréquence cardiaque (Karvonen) ---
${computeHrZones(profile?.fcMax, profile?.fcRepos)}
--- Zones d'allure course à pied ---
${computeRunZones(profile?.vma, manualPaceZones)}
--- Zones de puissance vélo (% FTP, méthode Coggan) ---
${computeBikeZones(profile?.ftp)}
--- Zones d'allure natation (% CSS) ---
${computeSwimZones(profile?.nat100)}`
    : `--- Zones de fréquence cardiaque (Karvonen) ---
${computeHrZones(profile?.fcMax, profile?.fcRepos)}
--- Zones d'allure course à pied ---
${computeRunZones(profile?.vma, manualPaceZones)}`;

  const prompt = `Tu es TRI COACH, coach triathlon personnel. Réponds en ${AI_LANGUAGE_NAMES[language] || 'français'}, ton motivant et concis.
${profile?.firstName ? `Tu t'adresses à ${profile.firstName} — utilise son prénom naturellement dans ta réponse (sans en abuser).` : ''}
${languageInstruction(language)}${constraintsBlock}${trendInstruction}
Profil : ${JSON.stringify(profile)}
${Object.entries(profile || {}).some(([k, v]) => ['vma', 'ftp', 'nat100', 'fcMax', 'fcRepos'].includes(k) && (v === null || v === undefined)) ? "⚠️ Un ou plusieurs champs physiologiques du profil ci-dessus sont null (non renseignés) : n'invente JAMAIS de valeur à leur place. Pour toute allure/puissance/bpm concernant un champ null, utilise uniquement des repères RPE (ressenti)." : ''}
${zonesBlock}
Plan : ${JSON.stringify(trainingPlan)}
Séances actuelles : ${JSON.stringify(workouts)}
Message athlète : "${message}"
${workoutSchema}
${intentInstruction}
Si l'athlète demande un ajustement (décaler, alléger, remplacer, douleur, séance en plus, etc.),
renvoie des patches ciblés avec TOUS les champs remplis, en respectant les zones précalculées
ci-dessus (notamment l'allure course, qui doit tomber dans les zones fournies). Sinon patches vide.
Réponds UNIQUEMENT avec :
{
  "reply": "réponse coach concise et motivante",
  "patches": [ /* chaque patch inclut patchMode: "add"|"modify" */ ]
}`;

  const data = await callAIJSON(prompt, provider);
  if (data.patches?.length) {
    for (const patch of data.patches) {
      // sanitizeWorkout corrige les champs INVALIDES (pas seulement vides) —
      // par ex. une allure donnée en km/h par erreur est convertie en min/km,
      // contrairement à un simple "champ || valeur par défaut" qui ne corrige
      // que les champs vides et laisserait passer une valeur fausse mais non-vide.
      const profileForSanitize = manualPaceZones ? { ...profile, paceZones: manualPaceZones } : profile;
      const sanitized = sanitizeWorkout(patch, profileForSanitize);
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

export async function callGeminiText(prompt) {
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
 * `provider` sélectionne Gemini ou Groq (voir lib/coGeneration.js:coGenerateNutritionAdvice/
 * coAnswerNutritionQuestion, qui appellent cette chaîne deux fois — une par IA — pour le
 * double-check inter-IA, en plus de ce garde-fou intra-IA déjà existant).
 */
async function generateVerifiedAdvice(prompt, provider = 'gemini') {
  let text = await callAIText(prompt, provider);
  let check = validateNutritionText(text);
  if (!check.valid) {
    const fixPrompt = `${NUTRITION_GUARDRAILS}
Ta réponse précédente contient une recommandation dangereuse détectée automatiquement :
"""${text}"""
Corrige et régénère une réponse complète, sûre et conforme, tout aussi concise.`;
    text = await callAIText(fixPrompt, provider);
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
export async function generateNutritionAdvice({ profile, trainingPlan, sportType, raceProfile, language = 'fr', provider = 'gemini' }) {
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
    generateVerifiedAdvice(trainingPrompt, provider),
    generateVerifiedAdvice(racePrompt, provider),
  ]);

  return {
    trainingAdvice: training.text,
    raceAdvice: race.text,
    verified: training.verified && race.verified,
  };
}

export async function answerNutritionQuestion({ profile, trainingPlan, question, raceProfile, planSummary, language = 'fr', provider = 'gemini' }) {
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
  const { text, verified } = await generateVerifiedAdvice(prompt, provider);
  return { answer: text, verified };
}

// --- ANALYSE D'ACTIVITÉ STRAVA (prévu vs réalisé) -----------------------------
// Appelée automatiquement dès qu'une activité Strava est reçue par le webhook
// (voir pages/api/strava/webhook.js), désormais via coAnalyzeStravaActivity dans
// lib/coGeneration.js pour le double-check Gemini + Groq (demande explicite de
// l'athlète : "mêmes règles que pour la génération des séances"). `plannedWorkout`
// est null si aucune séance du plan n'a pu être associée automatiquement (voir
// lib/stravaMatch.js) : dans ce cas l'IA commente uniquement la séance réalisée,
// sans comparaison.
//
// Réponse JSON stricte (et non plus texte libre) : le champ "verdict" est l'ancre
// déterministe comparée entre les deux IA par coAnalyzeStravaActivity — l'équivalent,
// pour une analyse d'activité, du "type de jour" comparé entre deux séances générées
// (voir compareDay dans lib/coGeneration.js).
export async function analyzeStravaActivity({ activity, plannedWorkout, profile, language = 'fr', provider = 'gemini', laps = null }) {
  const langNote = language !== 'fr' ? `Rédige le champ "analysis" entièrement en ${AI_LANGUAGE_NAMES[language] || 'français'}.\n` : '';

  const realizedBlock = `Séance RÉALISÉE (données Strava) :
- Type : ${activity.sport_type || activity.type || '?'}
- Nom donné par l'athlète : "${activity.name || '-'}"
- Distance : ${activity.distance_m ? `${(activity.distance_m / 1000).toFixed(1)} km` : 'N/A'}
- Durée en mouvement : ${activity.moving_time_s ? `${Math.round(activity.moving_time_s / 60)} min` : 'N/A'}
- Dénivelé positif : ${activity.total_elevation_m ? `${Math.round(activity.total_elevation_m)} m` : 'N/A'}
- FC moyenne/max : ${activity.average_heartrate ? `${Math.round(activity.average_heartrate)} bpm` : 'N/A'} / ${activity.max_heartrate ? `${Math.round(activity.max_heartrate)} bpm` : 'N/A'}
- Puissance moyenne/max : ${activity.average_watts ? `${Math.round(activity.average_watts)} W` : 'N/A'} / ${activity.max_watts ? `${Math.round(activity.max_watts)} W` : 'N/A'}
- Vitesse moyenne : ${activity.average_speed_ms ? `${(activity.average_speed_ms * 3.6).toFixed(1)} km/h` : 'N/A'}`;

  // Détail lap par lap (FC/vitesse/cadence/puissance/dénivelé, structure effort/récup/
  // répétitions déjà détectée de façon déterministe) — voir lib/lapsAnalysis.js. Permet à
  // l'IA de décortiquer VRAIMENT la séance (ex: reconnaître un fractionné 6x3min) plutôt
  // que de commenter uniquement les moyennes globales ci-dessus. Absent si l'activité n'a
  // pas de laps exploitables (webhook uniquement, voir pages/api/strava/webhook.js).
  const lapsText = describeLaps(laps, activity.sport_type || activity.type);
  const lapsBlock = lapsText ? `\nDétail lap par lap (données Strava, structure déjà pré-analysée) :\n${lapsText}` : '';

  const plannedBlock = plannedWorkout
    ? `Séance PRÉVUE au plan (à comparer) :
- Type : ${plannedWorkout.type}, titre : "${plannedWorkout.title}"
- Durée prévue : ${plannedWorkout.duration}
- Allure/puissance cible : ${plannedWorkout.intensity}
- Zone cardio cible : ${plannedWorkout.cardio}
- Structure : ${plannedWorkout.structure}`
    : `Aucune séance du plan n'a pu être associée automatiquement à cette activité (jour/discipline sans correspondance) : commente uniquement la séance réalisée elle-même, sans prétendre la comparer à un objectif précis.`;

  const profileBlock = `Profil athlète : VMA ${profile?.vma || 'non renseignée'}, FTP ${profile?.ftp || 'non renseignée'}, FC max ${profile?.fcMax || 'non renseignée'}.`;

  const verdictInstruction = plannedWorkout
    ? `"on_track" si la séance réalisée correspond globalement à ce qui était prévu (durée/allure/puissance/FC dans les clous), "below_target" si elle est nettement EN-DESSOUS de l'objectif prévu (trop courte, trop facile), "above_target" si elle est nettement AU-DESSUS (trop longue, trop intense par rapport à ce qui était demandé)`
    : `toujours "no_comparison" (aucune séance prévue à comparer)`;

  const lapsInstruction = lapsText
    ? "0) Appuie-toi EN PRIORITÉ sur le détail lap par lap ci-dessus (déjà pré-analysé : structure, effort vs récup, répétitions) pour décrire PRÉCISÉMENT ce qui a été fait — nombre de répétitions, durée/allure/FC de chaque phase d'effort, durée/intensité de récupération entre elles. Ne te limite pas aux moyennes globales de l'activité : un athlète qui a fait 6x3min veut lire \"6 répétitions\", pas juste une FC moyenne lissée sur toute la séance.\n"
    : '';

  const prompt = `Tu es TRI COACH, coach triathlon/course à pied personnel et bienveillant.
${langNote}${profileBlock}

${realizedBlock}${lapsBlock}

${plannedBlock}

Rédige une analyse ${lapsText ? 'DÉTAILLÉE mais dense (8-12 lignes MAXIMUM)' : 'COURTE (5-8 lignes MAXIMUM)'} de cette séance, ton motivant mais honnête :
${lapsInstruction}${plannedWorkout ? "1) La séance réalisée correspond-elle à ce qui était prévu (allure/puissance/FC/durée, ET structure si des répétitions étaient prévues) ? Sois précis et chiffré si les données le permettent, sans inventer de valeur absente.\n2) Un point positif concret.\n3) Un point de vigilance ou conseil pour la suite, seulement s'il y a une vraie raison de le mentionner (jamais de remarque inventée juste pour en avoir une)." : "Commente la séance réalisée (effort, régularité perçue via FC/puissance/allure si dispo, structure des répétitions si détectée) et donne un conseil de récupération ou d'enchaînement adapté."}
N'utilise JAMAIS de markdown (pas de **gras**, pas de listes à puces) dans "analysis" : du texte simple, en phrases.

Réponds STRICTEMENT en JSON, sans aucun texte autour : {"verdict": "on_track"|"below_target"|"above_target"|"no_comparison", "analysis": "le texte de l'analyse"}
Le champ "verdict" doit valoir ${verdictInstruction}.`;

  const json = await callAIJSON(prompt, provider);
  const text = typeof json?.analysis === 'string' ? json.analysis.trim() : '';
  if (!text) {
    const err = new Error('Réponse IA vide ou invalide pour l\'analyse d\'activité.');
    err.code = 'PARSE_ERROR';
    throw err;
  }
  const validVerdicts = ['on_track', 'below_target', 'above_target', 'no_comparison'];
  const verdict = validVerdicts.includes(json?.verdict) ? json.verdict : (plannedWorkout ? 'on_track' : 'no_comparison');

  return { analysis: text, verdict, status: 'ok' };
}

// --- VÉRIFICATION IA DE PLAUSIBILITÉ DES ZONES (double-check Gemini + Groq) ------
// Demande explicite de l'athlète : avant d'enregistrer des bornes de zone éditées à la
// main (basse ET haute désormais indépendantes, voir components/ZoneCharts.js), les
// deux IA du protocole de co-génération (voir coCheckZoneBounds dans lib/coGeneration.js)
// doivent aussi se prononcer sur leur plausibilité PHYSIOLOGIQUE — l'absence de
// chevauchement est déjà garantie de façon déterministe côté client (voir
// findZoneOverlaps, lib/zones.js) AVANT même d'arriver ici ; ce contrôle-ci porte sur
// autre chose : une Z2 "Aérobie" à 250-400 bpm est structurellement valide (zones
// croissantes, pas de chevauchement) mais absurde pour un humain. Réponse JSON stricte,
// jamais de prose libre, pour rester 100% automatisable.
export async function checkZoneBoundsWithAI({ zones, metric, discipline, profile, language = 'fr', provider = 'gemini' }) {
  const langNote = language !== 'fr' ? `Réponds dans le champ "note" en ${AI_LANGUAGE_NAMES[language] || 'français'}.\n` : '';
  const unit = metric === 'hr' ? 'bpm' : metric === 'power' ? 'W' : 'km/h';
  const zonesDesc = (zones || [])
    .map((z) => `${z.zone} (${z.label}) : ${z.min}${Number.isFinite(z.max) ? `–${z.max}` : ' et plus'} ${unit}`)
    .join('\n');
  const profileNote = metric === 'hr'
    ? `FC max déclarée : ${profile?.fcMax || 'non renseignée'} bpm.`
    : metric === 'power'
      ? `FTP déclarée : ${profile?.ftp || 'non renseignée'} W.`
      : `VMA déclarée : ${profile?.vma || 'non renseignée'} km/h.`;
  const prompt = `${langNote}Tu es un coach sportif. Un(e) athlète (discipline : ${discipline === 'bike' ? 'vélo' : 'course à pied'}) vient d'éditer manuellement ses zones d'intensité "${
    metric === 'hr' ? 'fréquence cardiaque' : metric === 'power' ? 'puissance' : 'allure/vitesse'
  }".
${profileNote}
Zones proposées (déjà vérifiées automatiquement : ordre croissant, aucun chevauchement) :
${zonesDesc}

Ces bornes sont-elles PHYSIOLOGIQUEMENT plausibles pour un être humain pratiquant ce sport (débutant comme très entraîné) ? Ne rejette QUE si une borne est manifestement aberrante (ex: FC de zone au-delà de ~230 bpm, valeur négative ou nulle, allure irréaliste type >30 km/h en continu, puissance délirante). Reste permissif sur tout ce qui reste dans le domaine du possible humain, y compris un profil atypique.
Réponds STRICTEMENT en JSON, sans aucun texte autour : {"plausible": true|false, "note": "une phrase courte expliquant ton avis"}`;

  const json = await callAIJSON(prompt, provider);
  return {
    plausible: json?.plausible !== false,
    note: typeof json?.note === 'string' ? json.note : '',
  };
}

// --- PLANIFICATEUR DE PARCOURS VÉLO (double-check Gemini + Groq) -----------------
// Demande explicite de l'athlète : tracer un parcours vélo depuis un point de départ et
// une distance, en optimisant le vent (dos/face) et en tenant compte des routes
// populaires (Strava + réseau cyclable OSM, voir lib/routePlanning.js). Le CALCUL
// (candidats, score vent, score popularité) est 100% déterministe — voir
// pages/api/plan-route.js — l'IA n'intervient qu'à la toute fin, sur un rôle qu'un calcul
// pur ne peut pas remplir : choisir/valider parmi un TRÈS PETIT nombre de candidats déjà
// classés (jamais generer elle-même une géométrie de route, ce que les LLM font mal) et
// rédiger une note de stratégie course lisible pour l'athlète (ex: "vent de face à
// l'aller, tu rentreras plus vite" — la même valeur ajoutée qu'un coach humain relisant un
// tableau de chiffres). Réponse JSON stricte, comme checkZoneBoundsWithAI ci-dessus.
export async function pickBestRouteWithAI({ candidates, startPlaceName, distanceKm, language = 'fr', provider = 'gemini' }) {
  const langNote = language !== 'fr' ? `Réponds dans les champs "strategyNote" en ${AI_LANGUAGE_NAMES[language] || 'français'}.\n` : '';
  const candidatesDesc = candidates
    .map((c, i) => `Candidat ${i} : ${c.distanceKm.toFixed(1)}km, dénivelé +${c.ascentM ?? '?'}m — vent : ${c.wind.distTailKm}km de dos, ${c.wind.distHeadKm}km de face, ${c.wind.distCrossKm}km de travers (score net vent : ${c.wind.netScore >= 0 ? '+' : ''}${c.wind.netScore}km) — popularité (segments Strava + réseau cyclable) : ${Math.round(c.popularityScore * 100)}% du tracé — score composite : ${c.compositeScore}`)
    .join('\n');

  const prompt = `${langNote}Tu es un coach cycliste. Un(e) athlète veut une sortie vélo d'environ ${distanceKm}km au départ de ${startPlaceName || 'son point de départ'}. Voici ${candidates.length} boucles candidates déjà générées et déjà notées de façon déterministe (distance, vent, popularité) — CE CLASSEMENT N'EST PAS À REMETTRE EN CAUSE dans son principe, ta tâche est de VALIDER le meilleur candidat (ou signaler un cas limite) et de rédiger une note de stratégie course courte et concrète pour CE candidat :
${candidatesDesc}

Le "score composite" ci-dessus classe déjà les candidats du meilleur au pire (vent 60%, popularité 40%, pondération déjà appliquée) — le candidat 0 est donc déjà le mieux classé. Ne choisis un AUTRE candidat que si le candidat 0 présente un défaut manifeste que le score ne capture pas bien (ex: dénivelé disproportionné par rapport aux autres, quasiment 0% de couverture routes populaires alors qu'un autre candidat très proche en score vent en a beaucoup plus).

Réponds STRICTEMENT en JSON, sans aucun texte autour :
{"pickedIndex": 0, "strategyNote": "1-2 phrases concrètes sur la stratégie de vent pour CE parcours (ex: quelle portion est difficile/facile, comment gérer l'effort en conséquence)"}`;

  const json = await callAIJSON(prompt, provider);
  const pickedIndex = Number.isInteger(json?.pickedIndex) && candidates[json.pickedIndex] ? json.pickedIndex : 0;
  return {
    pickedIndex,
    strategyNote: typeof json?.strategyNote === 'string' ? json.strategyNote : '',
  };
}
