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

/**
 * Signal de fatigue basé sur la VFC (HRV) déclarée par l'athlète — champ `vfc` du profil,
 * historisé dans healthHistory (voir components/ProfileHealth.js). Complète
 * summarizeFeedbackTrend ci-dessus (ressenti subjectif post-séance) par un signal
 * physiologique : une baisse notable de la VFC récente vs sa propre moyenne habituelle est
 * un indicateur courant de fatigue/stress accumulé, AVANT même que l'athlète ne le ressente
 * consciemment en séance. On compare toujours l'athlète à LUI-MÊME (moyenne récente vs
 * moyenne antérieure), jamais à un seuil générique — sa VFC de base peut être 40 ou 90 ms
 * selon la personne, seule la variation compte.
 *
 * Ne calcule un signal QUE sur des mesures réellement saisies par l'athlète (aucune valeur
 * interpolée/devinée) — s'il n'y a pas assez de mesures, on le dit explicitement plutôt que
 * de forcer un signal peu fiable.
 */
export function summarizeHrvTrend(healthHistory, recentSize = 3) {
  const points = [...(healthHistory || [])]
    .filter((h) => h?.metric === 'vfc' && Number.isFinite(h.value))
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  if (points.length < recentSize + 2) {
    return { direction: 'stable', low: false, sampleSize: points.length, label: 'Historique VFC insuffisant pour dégager une tendance.' };
  }

  const recent = points.slice(-recentSize);
  const baseline = points.slice(0, -recentSize);
  const avg = (arr) => arr.reduce((sum, h) => sum + h.value, 0) / arr.length;
  const recentAvg = avg(recent);
  const baselineAvg = avg(baseline);
  if (!baselineAvg) {
    return { direction: 'stable', low: false, sampleSize: points.length, label: 'Historique VFC insuffisant pour dégager une tendance.' };
  }

  const pctChange = (recentAvg - baselineAvg) / baselineAvg;
  // Seuil indicatif courant (~10%) pour distinguer une variation normale de mesure à mesure
  // d'une baisse qui mérite d'être prise en compte — pas un diagnostic, un signal parmi d'autres.
  const low = pctChange <= -0.1;
  const high = pctChange >= 0.1;
  const direction = low ? 'low' : high ? 'high' : 'stable';

  const label = low
    ? `VFC moyenne des ${recentSize} dernières mesures (${Math.round(recentAvg)} ms) en baisse de ${Math.abs(Math.round(pctChange * 100))}% vs sa moyenne antérieure (${Math.round(baselineAvg)} ms) : signal de fatigue accumulée, à prendre en compte pour la charge à venir.`
    : high
      ? `VFC moyenne des ${recentSize} dernières mesures (${Math.round(recentAvg)} ms) en hausse de ${Math.round(pctChange * 100)}% vs sa moyenne antérieure (${Math.round(baselineAvg)} ms) : pas de signal de fatigue côté VFC.`
      : `VFC stable (${Math.round(recentAvg)} ms récents vs ${Math.round(baselineAvg)} ms de moyenne antérieure) : pas de signal de fatigue côté VFC.`;

  return {
    direction,
    low,
    sampleSize: points.length,
    recentAvg: Math.round(recentAvg),
    baselineAvg: Math.round(baselineAvg),
    pctChange: Math.round(pctChange * 100),
    label,
  };
}

/**
 * Même principe que summarizeHrvTrend mais pour le sommeil (`sleepHours`, alimenté
 * manuellement ou automatiquement — voir pages/api/wearables/sync.js). Un manque de
 * sommeil récurrent est un facteur de fatigue au moins aussi parlant que la VFC seule ;
 * exposé séparément plutôt que fusionné pour que le coach IA (et l'athlète) sache PRÉCISÉMENT
 * quel signal est en cause.
 */
export function summarizeSleepTrend(healthHistory, recentSize = 3) {
  const points = [...(healthHistory || [])]
    .filter((h) => h?.metric === 'sleepHours' && Number.isFinite(h.value))
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  if (points.length < recentSize + 2) {
    return { direction: 'stable', low: false, sampleSize: points.length, label: 'Historique sommeil insuffisant pour dégager une tendance.' };
  }

  const recent = points.slice(-recentSize);
  const baseline = points.slice(0, -recentSize);
  const avg = (arr) => arr.reduce((sum, h) => sum + h.value, 0) / arr.length;
  const recentAvg = avg(recent);
  const baselineAvg = avg(baseline);
  if (!baselineAvg) {
    return { direction: 'stable', low: false, sampleSize: points.length, label: 'Historique sommeil insuffisant pour dégager une tendance.' };
  }

  const pctChange = (recentAvg - baselineAvg) / baselineAvg;
  const low = pctChange <= -0.1 || recentAvg < 6.5; // seuil absolu (6h30) en plus du relatif
  const high = pctChange >= 0.1;
  const direction = low ? 'low' : high ? 'high' : 'stable';

  const label = low
    ? `Sommeil moyen des ${recentSize} dernières nuits (${recentAvg.toFixed(1)}h) en retrait vs sa moyenne antérieure (${baselineAvg.toFixed(1)}h) : signal de récupération incomplète, à prendre en compte pour la charge à venir.`
    : high
      ? `Sommeil moyen des ${recentSize} dernières nuits (${recentAvg.toFixed(1)}h) en hausse vs sa moyenne antérieure (${baselineAvg.toFixed(1)}h) : pas de signal de manque de sommeil.`
      : `Sommeil stable (${recentAvg.toFixed(1)}h récentes vs ${baselineAvg.toFixed(1)}h de moyenne antérieure) : pas de signal de manque de sommeil.`;

  return {
    direction,
    low,
    sampleSize: points.length,
    recentAvg: Math.round(recentAvg * 10) / 10,
    baselineAvg: Math.round(baselineAvg * 10) / 10,
    pctChange: Math.round(pctChange * 100),
    label,
  };
}
