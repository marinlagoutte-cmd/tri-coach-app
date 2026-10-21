// lib/powerCurve.js
//
// Courbe de puissance vélo (meilleurs efforts 5s / 1min / 5min / 20min) + records
// personnels course à pied / natation. RÈGLE IDENTIQUE à lib/physiology.js : on ne calcule
// qu'à partir de données RÉELLEMENT synchronisées (activités Strava + leurs streams watts
// mis en cache, voir pages/api/strava/power-curve.js) — jamais un chiffre extrapolé ou
// deviné. Une durée/distance non couverte par une activité réelle reste `null` plutôt que
// d'être interpolée.

// Durées standard analysées pour la courbe de puissance vélo (secondes).
export const POWER_CURVE_DURATIONS = [5, 60, 300, 1200]; // 5s, 1min, 5min, 20min
export const POWER_CURVE_LABELS = { 5: '5 s', 60: '1 min', 300: '5 min', 1200: '20 min' };

// Distances standard suivies pour les records personnels — tolérance en +/- autour de la
// distance nominale pour matcher une activité réelle (les GPS/piscines ne tombent jamais
// pile sur 5.000km ou 400.00m).
export const RUN_PR_DISTANCES = [
  { key: '5k', km: 5, label: '5 km', toleranceKm: 0.3 },
  { key: '10k', km: 10, label: '10 km', toleranceKm: 0.5 },
  { key: 'semi', km: 21.0975, label: 'Semi-marathon', toleranceKm: 1 },
  { key: 'marathon', km: 42.195, label: 'Marathon', toleranceKm: 1.5 },
];
export const SWIM_PR_DISTANCES = [
  { key: '400m', m: 400, label: '400 m', toleranceM: 30 },
  { key: '1000m', m: 1000, label: '1000 m', toleranceM: 75 },
  { key: '1500m', m: 1500, label: '1500 m', toleranceM: 100 },
];

/**
 * Meilleure moyenne glissante de puissance (W) sur une durée donnée, à partir d'UN stream
 * Strava `{ time: { data: [s...] }, watts: { data: [W...] } }` (format `key_by_type=true`,
 * voir lib/strava.js:fetchStravaActivityStreams). `time` est en secondes depuis le début de
 * l'activité, à pas potentiellement irrégulier (le capteur peut sauter des points) — on
 * calcule donc une intégrale réelle (aire sous la courbe, trapèzes) rapportée à la durée
 * réelle de la fenêtre plutôt qu'un simple index glissant, sans quoi un enregistrement à pas
 * variable fausserait la moyenne. Renvoie `null` si l'activité est trop courte ou sans watts.
 */
export function bestAverageForDuration(stream, durationS) {
  const time = stream?.time?.data;
  const watts = stream?.watts?.data;
  if (!Array.isArray(time) || !Array.isArray(watts) || time.length < 2 || watts.length !== time.length) return null;
  if (time[time.length - 1] - time[0] < durationS) return null;

  let best = 0;
  let start = 0;
  let areaWattSeconds = 0;
  for (let end = 1; end < time.length; end++) {
    areaWattSeconds += ((watts[end] + watts[end - 1]) / 2) * (time[end] - time[end - 1]);
    while (start < end - 1 && time[end] - time[start + 1] >= durationS) {
      areaWattSeconds -= ((watts[start + 1] + watts[start]) / 2) * (time[start + 1] - time[start]);
      start++;
    }
    const windowDuration = time[end] - time[start];
    // Tolérance 2% : un capteur qui échantillonne à 1s pile ne retombe pas toujours
    // exactement sur `durationS` (ex: fenêtre de 298s au lieu de 300s pour "5min").
    if (windowDuration >= durationS * 0.98) {
      const avg = areaWattSeconds / windowDuration;
      if (avg > best) best = avg;
    }
  }
  return best > 0 ? Math.round(best) : null;
}

/**
 * Combine les streams de plusieurs activités vélo (déjà en cache, voir
 * pages/api/strava/power-curve.js) en une courbe de puissance globale : pour chaque durée
 * standard, le meilleur effort tous-temps trouvé + l'activité/la date d'origine
 * (traçabilité — jamais un chiffre affiché sans savoir de quelle sortie il vient).
 * `activitiesWithStreams`: [{ id, name, start_date_local, start_date, streams }]
 */
export function computePowerCurve(activitiesWithStreams) {
  const bests = {};
  POWER_CURVE_DURATIONS.forEach((d) => { bests[d] = null; });

  (activitiesWithStreams || []).forEach((act) => {
    if (!act?.streams) return;
    POWER_CURVE_DURATIONS.forEach((d) => {
      const watts = bestAverageForDuration(act.streams, d);
      if (watts && (!bests[d] || watts > bests[d].watts)) {
        bests[d] = {
          watts,
          activityId: act.id,
          activityName: act.name || 'Sortie vélo',
          date: act.start_date_local || act.start_date,
        };
      }
    });
  });

  return bests;
}

/**
 * Estime le FTP à partir de la courbe de puissance disponible — plus fin que le seul test
 * ponctuel "20 min à bloc" quand on dispose AUSSI du meilleur 5 min réel : modèle de
 * Puissance Critique à 2 points (CP = (P1·t1 − P2·t2) / (t1 − t2)), qui neutralise en partie
 * la composante anaérobie du 5min plutôt que de supposer un simple ratio fixe. Si seul le
 * 20min est connu, on retombe sur la règle classique 0.95 × P20 (identique à avant). Ne
 * renvoie JAMAIS de valeur si aucune des deux données sources n'est disponible — même
 * philosophie que resolveAthletePhysiology (lib/physiology.js) : pas de chiffre inventé.
 */
export function estimateFtpFromPowerCurve(bests) {
  const p20 = bests?.[1200]?.watts;
  const p5 = bests?.[300]?.watts;

  if (p5 && p20 && p5 > p20) {
    const t1 = 300;
    const t2 = 1200;
    const cp = (p5 * t1 - p20 * t2) / (t1 - t2);
    const wPrimeKj = Math.round((t1 * (p5 - cp)) / 1000);
    return {
      value: Math.round(cp),
      method: 'modèle Puissance Critique (meilleur 5 min réel + meilleur 20 min réel)',
      wPrimeKj,
      alt20minRule: Math.round(p20 * 0.95),
    };
  }
  if (p20) {
    return { value: Math.round(p20 * 0.95), method: 'règle 0.95 × meilleur 20 min réel', wPrimeKj: null, alt20minRule: null };
  }
  return null;
}

/** Trouve, parmi les activités course à pied réellement synchronisées, la meilleure
 * (temps le plus rapide) pour chaque distance standard — jamais un temps extrapolé, le
 * chrono RÉEL de l'activité la plus proche de la distance (dans la tolérance). */
export function computeRunPRs(activities) {
  const runs = (activities || []).filter((a) => /run/i.test(a.sport_type || a.type || '') && a.distance_m && a.moving_time_s);
  const prs = {};
  RUN_PR_DISTANCES.forEach(({ key, km, label, toleranceKm }) => {
    const candidates = runs.filter((a) => Math.abs(a.distance_m / 1000 - km) <= toleranceKm);
    if (candidates.length === 0) { prs[key] = null; return; }
    const best = candidates.reduce((b, a) => (a.moving_time_s < b.moving_time_s ? a : b));
    prs[key] = {
      label,
      timeS: best.moving_time_s,
      distanceKm: Math.round((best.distance_m / 1000) * 100) / 100,
      date: best.start_date_local || best.start_date,
      activityId: best.id,
      activityName: best.name,
    };
  });
  return prs;
}

/** Idem computeRunPRs mais pour la natation, sur des distances en mètres. */
export function computeSwimPRs(activities) {
  const swims = (activities || []).filter((a) => /swim/i.test(a.sport_type || a.type || '') && a.distance_m && a.moving_time_s);
  const prs = {};
  SWIM_PR_DISTANCES.forEach(({ key, m, label, toleranceM }) => {
    const candidates = swims.filter((a) => Math.abs(a.distance_m - m) <= toleranceM);
    if (candidates.length === 0) { prs[key] = null; return; }
    const best = candidates.reduce((b, a) => (a.moving_time_s < b.moving_time_s ? a : b));
    prs[key] = {
      label,
      timeS: best.moving_time_s,
      distanceM: Math.round(best.distance_m),
      date: best.start_date_local || best.start_date,
      activityId: best.id,
      activityName: best.name,
    };
  });
  return prs;
}

export function formatDuration(totalSeconds) {
  if (totalSeconds === null || totalSeconds === undefined || Number.isNaN(totalSeconds)) return '—';
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.round(totalSeconds % 60);
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}min${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
