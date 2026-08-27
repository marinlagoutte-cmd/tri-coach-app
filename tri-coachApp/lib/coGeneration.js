// CO-GÉNÉRATION Gemini + Groq (double-check gratuit) — demande explicite de l'athlète :
// chaque séance doit être co-générée par 2 IA indépendantes, comparées de façon
// déterministe (aucun 3e appel IA pour arbitrer), avec convergence garantie.
//
// Règles de convergence (décidées avec l'athlète) :
//   1. Les deux IA reçoivent EXACTEMENT le même prompt + la même chaîne de garde-fous
//      déterministes (voir provider dans generatePlanWithAI/regenerateWeekWithAI —
//      lib/gemini.js). Aucun traitement différent avant comparaison.
//   2. Comparaison 100% déterministe en JS : structure du jour (type/discipline),
//      durée (tolérance 25%), volume natation via "Total : XXXXm" (tolérance 30%).
//   3. Accord -> version Gemini retenue (choix arbitraire mais fixe, les deux étant
//      déjà passées par les mêmes garde-fous).
//   4. Désaccord -> UN round complet est relancé (les deux régénèrent entièrement).
//   5. Désaccord encore présent -> compromis déterministe : moyenne numérique arrondie
//      sur durée/volume ; pour une divergence de structure non fusionnable, la version
//      Gemini du jour concerné est conservée. Point de convergence garanti, jamais de
//      boucle infinie (2 rounds maximum).
//   6. Si une seule IA est indisponible (clé absente, quota, panne) : l'autre prend le
//      relais seule, avec une note transparente dans autoFixNotes — jamais un échec
//      silencieux ni un blocage total tant qu'au moins une IA répond.

import { generatePlanWithAI, regenerateWeekWithAI, chatWithCoach, generateNutritionAdvice, answerNutritionQuestion, checkZoneBoundsWithAI, analyzeStravaActivity } from './gemini';
import { parseDurationMinutes } from './workouts';

const DURATION_TOLERANCE = 0.25; // 25%
const SWIM_VOLUME_TOLERANCE = 0.30; // 30%

function extractSwimTotalMeters(desc) {
  const match = String(desc || '').match(/Total\s*:\s*(\d+)\s*m/i);
  return match ? Number(match[1]) : null;
}

function withinTolerance(a, b, tolerance) {
  if (a === b) return true;
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0 || b === 0) return a === b;
  const diff = Math.abs(a - b) / Math.max(a, b);
  return diff <= tolerance;
}

// Compare un jour (une entrée workout) entre les deux versions. Renvoie
// { agree: bool, reason?: string } — reason sert uniquement au log/debug.
function compareDay(dayA, dayB) {
  if (!dayA || !dayB) return { agree: false, reason: 'jour manquant chez une des deux IA' };

  // 1. Structure : même type de séance (REPOS vs séance réelle) et même discipline.
  if ((dayA.type === 'REPOS') !== (dayB.type === 'REPOS')) {
    return { agree: false, reason: 'une IA propose repos, l\'autre une séance' };
  }
  if (dayA.type === 'REPOS' && dayB.type === 'REPOS') {
    return { agree: true };
  }
  if (String(dayA.type).toLowerCase() !== String(dayB.type).toLowerCase()) {
    return { agree: false, reason: `discipline différente (${dayA.type} vs ${dayB.type})` };
  }

  // 2. Durée (tolérance 25%).
  const durA = parseDurationMinutes(dayA.duration);
  const durB = parseDurationMinutes(dayB.duration);
  if (!withinTolerance(durA, durB, DURATION_TOLERANCE)) {
    return { agree: false, reason: `durée trop différente (${durA}min vs ${durB}min)` };
  }

  // 3. Volume natation (tolérance 30%) — uniquement si les deux séances déclarent un total.
  const swimA = extractSwimTotalMeters(dayA.desc);
  const swimB = extractSwimTotalMeters(dayB.desc);
  if (swimA !== null && swimB !== null && !withinTolerance(swimA, swimB, SWIM_VOLUME_TOLERANCE)) {
    return { agree: false, reason: `volume natation trop différent (${swimA}m vs ${swimB}m)` };
  }

  return { agree: true };
}

// Compare une semaine entière (tableau de 7 jours). Renvoie la liste des désaccords
// (index + raison), vide si accord total sur les 7 jours.
function compareWeek(weekA, weekB) {
  const disagreements = [];
  const len = Math.max(weekA?.length || 0, weekB?.length || 0);
  for (let i = 0; i < len; i += 1) {
    const dayA = weekA?.[i];
    const dayB = weekB?.[i];
    const result = compareDay(dayA, dayB);
    if (!result.agree) {
      disagreements.push({ index: i, day: dayA?.day || dayB?.day, reason: result.reason });
    }
  }
  return disagreements;
}

// Compromis déterministe sur un jour en désaccord : moyenne numérique arrondie pour
// durée/volume si la structure est la même (donc fusionnable), sinon on garde la
// version Gemini telle quelle (règle fixée avec l'athlète pour les cas non fusionnables).
function compromiseDay(dayGemini, dayGroq) {
  if (!dayGemini || !dayGroq) return dayGemini || dayGroq;
  const sameStructure = dayGemini.type === dayGroq.type
    && (dayGemini.type === 'REPOS' || String(dayGemini.type).toLowerCase() === String(dayGroq.type).toLowerCase());
  if (!sameStructure || dayGemini.type === 'REPOS') {
    return dayGemini; // non fusionnable (ou repos, rien à moyenner) -> version Gemini conservée
  }

  const durA = parseDurationMinutes(dayGemini.duration);
  const durB = parseDurationMinutes(dayGroq.duration);
  const avgDur = Math.round((durA + durB) / 2);

  const swimA = extractSwimTotalMeters(dayGemini.desc);
  const swimB = extractSwimTotalMeters(dayGroq.desc);

  const compromised = {
    ...dayGemini,
    duration: `${avgDur} min`,
  };

  if (swimA !== null && swimB !== null) {
    const avgSwim = Math.round((swimA + swimB) / 2);
    // Remplace le total annoncé dans desc par la moyenne, sans toucher au reste de la
    // structure textuelle (échauffement/corps de séance restent ceux de Gemini).
    compromised.desc = String(dayGemini.desc || '').replace(/Total\s*:\s*\d+\s*m/i, `Total : ${avgSwim}m`);
  }

  return compromised;
}

function compromiseWeek(weekGemini, weekGroq) {
  const len = Math.max(weekGemini?.length || 0, weekGroq?.length || 0);
  const result = [];
  for (let i = 0; i < len; i += 1) {
    result.push(compromiseDay(weekGemini?.[i], weekGroq?.[i]));
  }
  return result;
}

// Même logique de comparaison que compareWeek/compareDay ci-dessus, appliquée aux
// patches renvoyés par chatWithCoach (ajout/modification d'UNE séance via le chat) —
// demande explicite de l'athlète : un ajustement de séance passé par le chat doit lui
// aussi être double-checké par les deux IA, pas seulement la génération de plan/semaine.
function comparePatches(patchesA, patchesB) {
  const lenA = patchesA?.length || 0;
  const lenB = patchesB?.length || 0;
  if (lenA !== lenB) {
    return { agree: false, reason: `nombre de séances ajustées différent (${lenA} vs ${lenB})` };
  }
  if (lenA === 0) return { agree: true }; // les deux IA ne proposent aucun ajustement (simple question)
  for (let i = 0; i < lenA; i += 1) {
    const result = compareDay(patchesA[i], patchesB[i]);
    if (!result.agree) return result;
  }
  return { agree: true };
}

function compromisePatches(patchesGemini, patchesGroq) {
  const len = Math.max(patchesGemini?.length || 0, patchesGroq?.length || 0);
  const result = [];
  for (let i = 0; i < len; i += 1) {
    result.push(compromiseDay(patchesGemini?.[i], patchesGroq?.[i]));
  }
  return result;
}

// Lance les deux IA en parallèle sur la même fonction de génération (générique : sert
// pour generatePlanWithAI ET regenerateWeekWithAI). Gère le cas "une seule IA dispo".
async function runBothProviders(genFn, args) {
  const [geminiResult, groqResult] = await Promise.allSettled([
    genFn({ ...args, provider: 'gemini' }),
    genFn({ ...args, provider: 'groq' }),
  ]);

  const geminiOk = geminiResult.status === 'fulfilled';
  const groqOk = groqResult.status === 'fulfilled';

  if (!geminiOk && !groqOk) {
    // Les deux IA ont échoué : on remonte l'erreur Gemini (message déjà localisé/classé
    // par lib/gemini.js) comme erreur principale, c'est celle que le front sait afficher.
    throw geminiResult.reason;
  }
  if (!geminiOk) {
    return { solo: 'groq', result: groqResult.value, failedProvider: 'gemini', failureReason: geminiResult.reason?.message };
  }
  if (!groqOk) {
    return { solo: 'gemini', result: geminiResult.value, failedProvider: 'groq', failureReason: groqResult.reason?.message };
  }
  return { solo: null, gemini: geminiResult.value, groq: groqResult.value };
}

function soloNote(failedProvider, failureReason, subject = 'contenu généré') {
  const label = failedProvider === 'gemini' ? 'Gemini' : 'Groq';
  return `Double-check indisponible cette fois (${label} injoignable : ${failureReason || 'erreur inconnue'}) — ${subject} par une seule IA, à vérifier avec un peu plus d'attention.`;
}

/**
 * Co-génère un plan complet (2 semaines N/N+1) avec Gemini + Groq, compare de façon
 * déterministe, relance un round complet en cas de désaccord, puis calcule un
 * compromis déterministe si le désaccord persiste. Signature/retour identiques à
 * generatePlanWithAI (mêmes clés) + autoFixNotes enrichi du statut du double-check.
 */
export async function coGeneratePlan(args) {
  const round1 = await runBothProviders(generatePlanWithAI, args);

  if (round1.solo) {
    const note = soloNote(round1.failedProvider, round1.failureReason, 'plan généré');
    return { ...round1.result, autoFixNotes: [...(round1.result.autoFixNotes || []), note] };
  }

  const disagreementsN = compareWeek(round1.gemini.workouts.N, round1.groq.workouts.N);
  const disagreementsN1 = compareWeek(round1.gemini.workouts['N+1'], round1.groq.workouts['N+1']);

  if (disagreementsN.length === 0 && disagreementsN1.length === 0) {
    return {
      ...round1.gemini,
      autoFixNotes: [...(round1.gemini.autoFixNotes || []), 'Double-check Gemini + Groq : accord dès le 1er essai, plan validé par les deux IA.'],
    };
  }

  // Désaccord -> round 2 : les deux IA régénèrent ENTIÈREMENT le plan.
  const round2 = await runBothProviders(generatePlanWithAI, args);

  if (round2.solo) {
    const note = soloNote(round2.failedProvider, round2.failureReason, 'plan généré');
    return { ...round2.result, autoFixNotes: [...(round2.result.autoFixNotes || []), note] };
  }

  const disagreementsN_r2 = compareWeek(round2.gemini.workouts.N, round2.groq.workouts.N);
  const disagreementsN1_r2 = compareWeek(round2.gemini.workouts['N+1'], round2.groq.workouts['N+1']);

  if (disagreementsN_r2.length === 0 && disagreementsN1_r2.length === 0) {
    return {
      ...round2.gemini,
      autoFixNotes: [...(round2.gemini.autoFixNotes || []), 'Double-check Gemini + Groq : désaccord au 1er essai, accord trouvé après un 2e essai complet.'],
    };
  }

  // Toujours en désaccord après 2 essais complets -> compromis déterministe (point de
  // convergence garanti, jamais de 3e round).
  const compromisedWorkouts = {
    N: compromiseWeek(round2.gemini.workouts.N, round2.groq.workouts.N),
    'N+1': compromiseWeek(round2.gemini.workouts['N+1'], round2.groq.workouts['N+1']),
  };
  const compromisedDays = [...disagreementsN_r2, ...disagreementsN1_r2]
    .map((d) => `${d.day || `jour ${d.index + 1}`}${d.reason ? ` (${d.reason})` : ''}`)
    .join(', ');

  return {
    ...round2.gemini,
    workouts: compromisedWorkouts,
    autoFixNotes: [
      ...(round2.gemini.autoFixNotes || []),
      `Double-check Gemini + Groq : désaccord persistant après 2 essais complets → compromis déterministe appliqué (moyenne durée/volume, structure Gemini conservée si non fusionnable) sur : ${compromisedDays}.`,
    ],
  };
}

/**
 * Même logique que coGeneratePlan, appliquée à la régénération d'une seule semaine
 * (voir regenerateWeekWithAI dans lib/gemini.js).
 */
export async function coRegenerateWeek(args) {
  const { weekKey = 'N+1' } = args;
  const round1 = await runBothProviders(regenerateWeekWithAI, args);

  if (round1.solo) {
    const note = soloNote(round1.failedProvider, round1.failureReason, 'semaine générée');
    return { ...round1.result, qualityWarnings: [...(round1.result.qualityWarnings || []), note] };
  }

  const disagreements = compareWeek(round1.gemini.workouts[weekKey], round1.groq.workouts[weekKey]);
  if (disagreements.length === 0) {
    return round1.gemini;
  }

  const round2 = await runBothProviders(regenerateWeekWithAI, args);
  if (round2.solo) {
    const note = soloNote(round2.failedProvider, round2.failureReason, 'semaine générée');
    return { ...round2.result, qualityWarnings: [...(round2.result.qualityWarnings || []), note] };
  }

  const disagreements_r2 = compareWeek(round2.gemini.workouts[weekKey], round2.groq.workouts[weekKey]);
  if (disagreements_r2.length === 0) {
    return round2.gemini;
  }

  const compromisedWeek = compromiseWeek(round2.gemini.workouts[weekKey], round2.groq.workouts[weekKey]);
  const compromisedDays = disagreements_r2
    .map((d) => `${d.day || `jour ${d.index + 1}`}${d.reason ? ` (${d.reason})` : ''}`)
    .join(', ');

  return {
    ...round2.gemini,
    workouts: { ...round2.gemini.workouts, [weekKey]: compromisedWeek },
    qualityWarnings: [
      ...(round2.gemini.qualityWarnings || []),
      `Double-check Gemini + Groq : désaccord persistant après 2 essais → compromis déterministe appliqué sur : ${compromisedDays}.`,
    ],
  };
}

/**
 * Même logique de double-check que coGeneratePlan/coRegenerateWeek, appliquée à un
 * ajustement de séance demandé via le chat (voir chatWithCoach dans lib/gemini.js) :
 * un "raccourcis ma sortie de dimanche" ou "ajoute une sortie vélo" doit lui aussi être
 * co-généré par Gemini + Groq et comparé, pas seulement la génération de plan initiale.
 * Convergence garantie en 2 rounds max, compromis déterministe sinon — mêmes règles
 * qu'en tête de fichier, transposées à un tableau de patches au lieu d'une semaine.
 */
export async function coChatWithCoach(args) {
  const round1 = await runBothProviders(chatWithCoach, args);

  if (round1.solo) {
    const note = soloNote(round1.failedProvider, round1.failureReason, 'réponse générée');
    return { ...round1.result, reply: `${round1.result.reply}\n\n(${note})` };
  }

  if (comparePatches(round1.gemini.patches, round1.groq.patches).agree) {
    return round1.gemini;
  }

  // Désaccord -> un round complet est relancé (les deux régénèrent entièrement leur
  // réponse/patches), exactement comme pour un plan ou une semaine.
  const round2 = await runBothProviders(chatWithCoach, args);

  if (round2.solo) {
    const note = soloNote(round2.failedProvider, round2.failureReason, 'réponse générée');
    return { ...round2.result, reply: `${round2.result.reply}\n\n(${note})` };
  }

  if (comparePatches(round2.gemini.patches, round2.groq.patches).agree) {
    return round2.gemini;
  }

  // Toujours en désaccord après 2 essais -> compromis déterministe (même logique que
  // compromiseWeek : moyenne durée/volume si fusionnable, sinon version Gemini gardée).
  return {
    ...round2.gemini,
    patches: compromisePatches(round2.gemini.patches, round2.groq.patches),
    reply: `${round2.gemini.reply}\n\n(Double-check Gemini + Groq : léger désaccord entre les deux IA sur cet ajustement — compromis appliqué automatiquement, vérifie la séance concernée.)`,
  };
}

// Choix déterministe entre deux réponses texte (nutrition) — pas de "compromis" possible
// sur de la prose (contrairement à une durée ou un volume numérique), donc la règle de
// convergence ici est : la réponse qui a passé le garde-fou scientifique automatisé
// (validateNutritionText, voir lib/gemini.js) l'emporte ; à garde-fou égal, Gemini est
// gardée par défaut (même tie-break arbitraire mais fixe que pour les séances).
function pickVerifiedResult(geminiRes, groqRes) {
  if (geminiRes.verified && groqRes.verified) return { picked: geminiRes, status: 'both-verified' };
  if (geminiRes.verified) return { picked: geminiRes, status: 'gemini-only-verified' };
  if (groqRes.verified) return { picked: groqRes, status: 'groq-only-verified' };
  return { picked: geminiRes, status: 'neither-verified' };
}

function doubleCheckNoteFor(status) {
  switch (status) {
    case 'both-verified':
      return 'Double-check Gemini + Groq : conseil validé par les deux IA.';
    case 'gemini-only-verified':
      return "Double-check Gemini + Groq : réponse Groq écartée (garde-fou nutrition non validé), réponse Gemini retenue.";
    case 'groq-only-verified':
      return "Double-check Gemini + Groq : réponse Gemini écartée (garde-fou nutrition non validé), réponse Groq retenue.";
    default:
      return "Double-check Gemini + Groq : aucune des deux IA n'a pleinement validé ce conseil automatiquement — vérifie-le avec un peu plus d'attention.";
  }
}

/**
 * Co-génère les conseils nutrition (entraînement + course, voir generateNutritionAdvice
 * dans lib/gemini.js) avec Gemini + Groq — demande explicite de l'athlète : l'onglet
 * Nutrition doit suivre le même protocole double-IA que la génération de plan, pas
 * seulement interroger Gemini. Pas de relance/compromis numérique ici (voir
 * pickVerifiedResult ci-dessus) : la prose ne se "moyenne" pas comme une durée.
 */
export async function coGenerateNutritionAdvice(args) {
  const round = await runBothProviders(generateNutritionAdvice, args);
  if (round.solo) {
    const note = soloNote(round.failedProvider, round.failureReason, 'conseil nutrition généré');
    return { ...round.result, doubleCheckNote: note };
  }
  const { picked, status } = pickVerifiedResult(round.gemini, round.groq);
  return { ...picked, doubleCheckNote: doubleCheckNoteFor(status) };
}

/**
 * Vérifie la plausibilité physiologique de bornes de zone éditées manuellement, avec
 * les DEUX IA du protocole — demande explicite de l'athlète ("les deux IA doivent
 * s'accorder", "vérifier que c'est possible") appliquée à l'édition indépendante des
 * bornes basse/haute (voir components/ZoneCharts.js). S'ajoute, côté serveur, au
 * contrôle déterministe de non-chevauchement déjà fait AVANT cet appel (voir
 * findZoneOverlaps dans lib/zones.js, revérifié aussi dans pages/api/validate-zones.js).
 * Règle de convergence (volontairement prudente — pas de "compromis" possible sur un
 * jugement booléen comme pour une durée/un volume) : si UNE SEULE des deux IA juge les
 * bornes aberrantes, elles sont traitées comme aberrantes dans l'ensemble — mieux vaut
 * redemander confirmation à l'athlète qu'enregistrer une zone absurde qu'une IA sur deux
 * a repérée. Si une seule IA est disponible, son seul avis fait foi (note transparente)
 * plutôt qu'un blocage total tant qu'au moins une IA répond.
 */
export async function coCheckZoneBounds(args) {
  const round = await runBothProviders(checkZoneBoundsWithAI, args);

  if (round.solo) {
    const label = round.failedProvider === 'gemini' ? 'Gemini' : 'Groq';
    return {
      plausible: round.result.plausible,
      note: round.result.note,
      doubleCheckNote: `Double-check indisponible cette fois (${label} injoignable${round.failureReason ? ` : ${round.failureReason}` : ''}) — avis d'une seule IA, à vérifier avec un peu plus d'attention.`,
    };
  }

  const { gemini, groq } = round;
  const bothPlausible = gemini.plausible && groq.plausible;
  const notes = [gemini.note, groq.note].filter(Boolean);

  return {
    plausible: bothPlausible,
    note: notes.join(' '),
    doubleCheckNote: bothPlausible
      ? 'Double-check Gemini + Groq : bornes jugées plausibles par les deux IA.'
      : `Double-check Gemini + Groq : ${
          !gemini.plausible && !groq.plausible
            ? 'les deux IA jugent ces bornes peu plausibles'
            : `une des deux IA (${!gemini.plausible ? 'Gemini' : 'Groq'}) juge ces bornes peu plausibles`
        }.`,
  };
}

/**
 * Co-analyse une activité Strava (prévu vs réalisé, PAR INTERVALLES — voir
 * lib/intervals.js) avec Gemini + Groq — demande explicite de l'athlète : "il faut
 * davantage travailler le feedback des deux IA pour les séances Strava". Comme pour
 * la nutrition (pickVerifiedResult ci-dessus), la prose (`analyse`) ne se "moyenne"
 * pas — mais ici les deux IA renvoient AUSSI un verdict structuré (`respectePlan`,
 * booléen ou null si pas de séance prévue à comparer, voir analyzeStravaActivity)
 * qui, lui, se compare déterministiquement :
 *   - Les deux IA s'accordent sur `respectePlan` (ou toutes les deux `null`, pas de
 *     plan à comparer) -> l'analyse texte de Gemini est retenue (choix arbitraire
 *     mais fixe, même règle que le reste du protocole), avec une note confirmant
 *     l'accord.
 *   - Désaccord sur `respectePlan` (une IA dit "conforme au plan", l'autre "non") ->
 *     on ne tranche PAS silencieusement (contrairement à une durée qu'on peut
 *     moyenner, un verdict "conforme/pas conforme" n'a pas de valeur intermédiaire
 *     sensée) : l'analyse de Gemini est retenue mais la note de double-check
 *     PRÉCISE explicitement le désaccord, pour que l'athlète sache qu'il vaut la
 *     peine de vérifier le détail par lui-même plutôt que de prendre le verdict au
 *     pied de la lettre.
 */
export async function coAnalyzeStravaActivity(args) {
  const round = await runBothProviders(analyzeStravaActivity, args);
  if (round.solo) {
    const note = soloNote(round.failedProvider, round.failureReason, 'analyse générée');
    return { ...round.result, doubleCheckNote: note };
  }
  const { gemini, groq } = round;
  if (gemini.status !== 'ok' && groq.status !== 'ok') {
    return { analysis: null, seanceDetectee: null, respectePlan: null, status: 'error', doubleCheckNote: 'Double-check Gemini + Groq : les deux IA ont échoué, aucune analyse disponible pour cette activité.' };
  }
  if (gemini.status !== 'ok') return { ...groq, doubleCheckNote: 'Double-check Gemini + Groq : Gemini a échoué sur cette activité, analyse Groq retenue seule.' };
  if (groq.status !== 'ok') return { ...gemini, doubleCheckNote: 'Double-check Gemini + Groq : Groq a échoué sur cette activité, analyse Gemini retenue seule.' };

  const agree = gemini.respectePlan === groq.respectePlan;
  const doubleCheckNote = args.plannedWorkout == null
    ? 'Double-check Gemini + Groq : analyse (sans séance prévue à comparer) réalisée par les deux IA.'
    : agree
      ? `Double-check Gemini + Groq : les deux IA s'accordent — séance jugée ${gemini.respectePlan ? 'conforme' : 'non conforme'} au plan prévu.`
      : "Double-check Gemini + Groq : désaccord entre les deux IA sur la conformité au plan prévu — vérifie le détail par intervalles toi-même avant de conclure.";

  return { ...gemini, doubleCheckNote };
}

/**
 * Même logique que coGenerateNutritionAdvice, pour une question libre posée dans l'onglet
 * Nutrition (voir answerNutritionQuestion dans lib/gemini.js).
 */
export async function coAnswerNutritionQuestion(args) {
  const round = await runBothProviders(answerNutritionQuestion, args);
  if (round.solo) {
    const note = soloNote(round.failedProvider, round.failureReason, 'réponse générée');
    return { ...round.result, doubleCheckNote: note };
  }
  const { picked, status } = pickVerifiedResult(round.gemini, round.groq);
  return { ...picked, doubleCheckNote: doubleCheckNoteFor(status) };
}
