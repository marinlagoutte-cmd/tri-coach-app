// lib/feedback.js
// Interprétation du ressenti post-séance (dureté / forme physique) et
// comparaison avec ce que le coach avait prévu (RPE cible de la séance).

function parseRpe(rpe) {
  const m = String(rpe || '').match(/(\d+(?:\.\d+)?)\s*\/\s*10/);
  return m ? Number(m[1]) : 5; // valeur neutre si non renseignée
}

/**
 * Calibration personnelle : écart moyen, sur l'historique de l'athlète,
 * entre ce qu'il ressent (difficulty) et ce qui était prévu (RPE cible).
 * Un athlète qui met systématiquement des notes hautes/basses par nature
 * ne doit pas déclencher d'alerte à chaque séance — seul un écart
 * inhabituel PAR RAPPORT À SA PROPRE tendance compte.
 */
export function computeUserBias(history) {
  if (!history || history.length === 0) return 0;
  const diffs = history.map((h) => h.difficulty - h.expectedDifficulty);
  return diffs.reduce((a, b) => a + b, 0) / diffs.length;
}

/**
 * Analyse un ressenti de séance (1-10 dureté, 1-10 forme physique) et
 * détermine si l'écart avec l'attendu justifie de proposer un allègement
 * de la suite de la semaine.
 */
export function analyzeFeedback(workout, feedback, history = []) {
  const expectedDifficulty = parseRpe(workout?.rpe);
  const rawGap = feedback.difficulty - expectedDifficulty;
  const userBias = computeUserBias(history);
  const adjustedGap = rawGap - userBias;

  // Nettement plus dur que la tendance habituelle de l'athlète + forme ressentie faible
  // = signal fort de mauvais jour / séance mal calée pour cette fois-ci.
  const hardAndWeak = adjustedGap >= 2 && feedback.capacity <= 4;
  // Forme très faible sur une séance jugée difficile, même sans grand écart vs attendu.
  const veryWeak = feedback.capacity <= 2 && feedback.difficulty >= 7;
  const needsCheck = hardAndWeak || veryWeak;

  const reason = !needsCheck ? '' : hardAndWeak
    ? `Séance ressentie ${feedback.difficulty}/10 (plus dur que d'habitude pour toi) avec une forme faible (${feedback.capacity}/10) : possible mauvais jour.`
    : `Forme très faible ressentie (${feedback.capacity}/10) sur une séance difficile (${feedback.difficulty}/10).`;

  return {
    expectedDifficulty,
    rawGap,
    userBias: Number(userBias.toFixed(1)),
    adjustedGap: Number(adjustedGap.toFixed(1)),
    needsCheck,
    reason,
  };
}

/**
 * Résume la tendance récente de ressenti pour permettre au coach IA de faire
 * ÉVOLUER le niveau de l'athlète dans le temps (générations suivantes du plan,
 * réponses du chat) au lieu de le figer sur le niveau 1-5 déclaré une seule fois
 * au wizard. Se base sur les N dernières séances validées.
 */
export function summarizeFeedbackTrend(history, sampleSize = 6) {
  const recent = [...(history || [])].sort((a, b) => b.timestamp - a.timestamp).slice(0, sampleSize);
  if (recent.length < 3) {
    return { direction: 'stable', sampleSize: recent.length, label: 'Historique de ressenti insuffisant pour dégager une tendance.' };
  }
  const avgAdjustedGap = recent.reduce((sum, h) => {
    const expected = h.expectedDifficulty ?? 5;
    return sum + (h.difficulty - expected);
  }, 0) / recent.length;

  let direction = 'stable';
  let label;
  if (avgAdjustedGap <= -1.2) {
    direction = 'easier';
    label = `Sur les ${recent.length} dernières séances validées, l'athlète les ressent en moyenne plus faciles que prévu (écart moyen ${avgAdjustedGap.toFixed(1)}) : son niveau a probablement progressé, on peut densifier/intensifier progressivement.`;
  } else if (avgAdjustedGap >= 1.2) {
    direction = 'harder';
    label = `Sur les ${recent.length} dernières séances validées, l'athlète les ressent en moyenne plus dures que prévu (écart moyen +${avgAdjustedGap.toFixed(1)}) : vigilance surcharge, envisager de lever le pied avant d'augmenter à nouveau.`;
  } else {
    label = `Sur les ${recent.length} dernières séances validées, le ressenti correspond globalement à ce qui était prévu (écart moyen ${avgAdjustedGap.toFixed(1)}) : charge actuelle cohérente avec le niveau de l'athlète.`;
  }

  return { direction, sampleSize: recent.length, avgAdjustedGap: Number(avgAdjustedGap.toFixed(1)), label };
}
