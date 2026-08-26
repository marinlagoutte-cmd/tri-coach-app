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

import { generatePlanWithAI, regenerateWeekWithAI } from './gemini';
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

function soloNote(failedProvider, failureReason) {
  const label = failedProvider === 'gemini' ? 'Gemini' : 'Groq';
  return `Double-check indisponible cette fois (${label} injoignable : ${failureReason || 'erreur inconnue'}) — plan généré par une seule IA, à vérifier avec un peu plus d'attention.`;
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
    const note = soloNote(round1.failedProvider, round1.failureReason);
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
    const note = soloNote(round2.failedProvider, round2.failureReason);
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
    const note = soloNote(round1.failedProvider, round1.failureReason);
    return { ...round1.result, qualityWarnings: [...(round1.result.qualityWarnings || []), note] };
  }

  const disagreements = compareWeek(round1.gemini.workouts[weekKey], round1.groq.workouts[weekKey]);
  if (disagreements.length === 0) {
    return round1.gemini;
  }

  const round2 = await runBothProviders(regenerateWeekWithAI, args);
  if (round2.solo) {
    const note = soloNote(round2.failedProvider, round2.failureReason);
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
