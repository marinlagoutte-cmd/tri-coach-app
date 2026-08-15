// lib/workouts.js

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export function enrichWorkoutMetrics(workout, profile) {
  if (!workout) return workout;
  let { type, intensity, cadence, cardio, rpe, effortZone, avgBpm, restTime, structure } = workout;
  type = (type || '').toUpperCase();
  const fcMax = profile?.fcMax || 190;
  const fcRepos = profile?.fcRepos || 55;
  const isInterval = /\d+\s*[x×]\s*\d+/i.test(`${workout.title || ''} ${workout.desc || ''}`);

  if (type.includes('C.A.P') || type.includes('RUN')) {
    if (!intensity || intensity.includes('VMA') || /km\/h/i.test(intensity)) {
      const speedKmh = profile && profile.vma ? profile.vma * 0.75 : 12.0;
      const paceMin = 60 / speedKmh;
      const min = Math.floor(paceMin);
      const sec = Math.round((paceMin - min) * 60);
      intensity = `${min}:${String(sec).padStart(2, '0')} /km (75% VMA)`;
    }
    cadence = cadence || '175-180 spm';
    effortZone = effortZone || 'Z2-Z3';
    avgBpm = avgBpm || `${Math.round(fcRepos + (fcMax - fcRepos) * 0.65)} bpm`;
    cardio = cardio || `${effortZone} (${avgBpm})`;
    rpe = rpe || 'RPE 6/10';
    restTime = restTime || (isInterval ? "Récup. trot 1' à 2' entre les répétitions (50-100% du temps d'effort)" : '-');
    structure = structure || (isInterval
      ? `Échauffement 15min Z1-Z2 + corps de séance (allure cible ${intensity}) + retour au calme 10min Z1`
      : `Échauffement 10min progressif puis allure continue ${intensity}, retour au calme 5min`);
  } else if (type.includes('CYCLISME') || type.includes('VELO') || type.includes('BIKE')) {
    if (!intensity || intensity.includes('FTP')) {
      const power = profile && profile.ftp ? Math.round(profile.ftp * 0.75) : 210;
      intensity = `${power}W (75% FTP)`;
    }
    cadence = cadence || '85-95 rpm';
    effortZone = effortZone || 'Z2-Z4';
    avgBpm = avgBpm || `${Math.round(fcRepos + (fcMax - fcRepos) * 0.6)} bpm`;
    cardio = cardio || `${effortZone} (${avgBpm})`;
    rpe = rpe || 'RPE 6/10';
    restTime = restTime || (isInterval ? "Récup. souple 3' à 5' entre les blocs (cadence libre, faible résistance)" : '-');
    structure = structure || (isInterval
      ? `Échauffement 15min progressif + blocs à ${intensity} + retour au calme 10min souple`
      : `Échauffement 10-15min progressif puis allure continue ${intensity}, retour au calme 10min`);
  } else if (type.includes('NATATION') || type.includes('SWIM')) {
    intensity = intensity || (profile && profile.nat100 ? `${profile.nat100} /100m` : '1:35 /100m');
    cadence = cadence || '34-38 mvt/min';
    effortZone = effortZone || 'Z2-Z3';
    cardio = cardio || effortZone;
    rpe = rpe || 'RPE 5/10';
    restTime = restTime || (isInterval ? "15 à 30s de repos entre les séries de 100m" : '-');
    structure = structure || (isInterval
      ? `Échauffement 300-400m souple + série principale à ${intensity} + retour au calme 200m`
      : `Nage continue à allure ${intensity}, technique surveillée`);
  } else {
    intensity = intensity || 'Récupération';
    cadence = cadence || '-';
    effortZone = effortZone || 'Repos';
    cardio = cardio || `< ${Math.round(fcRepos + 5)} bpm`;
    rpe = rpe || 'RPE 1/10';
    restTime = restTime || '-';
    structure = structure || 'Repos complet ou mobilité légère / étirements.';
  }

  return { ...workout, intensity, cadence, cardio, rpe, effortZone, avgBpm, restTime, structure };
}

/**
 * DOUBLE CHECK COHÉRENCE : contrôle et corrige automatiquement les valeurs
 * générées par l'IA avant tout affichage (bornes physiologiques réalistes).
 */
export function checkWorkoutCoherence(workout, profile) {
  const issues = [];
  if (!workout) return { valid: false, issues: ['Séance vide'] };
  const type = (workout.type || '').toUpperCase();
  const fcMax = profile?.fcMax || 190;
  const fcRepos = profile?.fcRepos || 55;

  // Chaque issue est taguée avec le(s) champ(s) fautif(s), pour ne corriger
  // QUE ce qui pose problème (jamais effacer une séance entière déjà correcte).
  const bpmMatch = String(workout.avgBpm || workout.cardio || '').match(/(\d{2,3})/);
  if (bpmMatch) {
    const bpm = Number(bpmMatch[1]);
    if (bpm < fcRepos - 5 || bpm > fcMax + 5) {
      issues.push({ message: `BPM incohérent (${bpm})`, fields: ['avgBpm', 'cardio'] });
    }
  }

  if (type.includes('CYCLISME') || type.includes('VELO') || type.includes('BIKE')) {
    const wMatch = String(workout.intensity || '').match(/(\d{2,4})\s*W/i);
    const ftp = profile?.ftp || 280;
    if (wMatch && (Number(wMatch[1]) < 40 || Number(wMatch[1]) > ftp * 1.3)) {
      issues.push({ message: `Puissance incohérente (${wMatch[1]}W)`, fields: ['intensity'] });
    }
  }
  if (type.includes('C.A.P') || type.includes('RUN')) {
    // Allure attendue au format min/km (ex: "4:30 /km"), jamais en km/h.
    const paceMatch = String(workout.intensity || '').match(/(\d+):(\d{2})\s*\/?\s*km/i);
    const vma = profile?.vma || 16;
    if (!paceMatch) {
      issues.push({ message: 'Format allure course invalide (attendu min/km)', fields: ['intensity'] });
    } else {
      const paceMin = Number(paceMatch[1]) + Number(paceMatch[2]) / 60;
      const speedKmh = 60 / paceMin;
      if (speedKmh < 5 || speedKmh > vma * 1.15) {
        issues.push({ message: `Allure incohérente (${paceMatch[0]})`, fields: ['intensity'] });
      }
    }
  }
  if (type.includes('NATATION') || type.includes('SWIM')) {
    if (!/^\d:\d{2}/.test(String(workout.intensity || ''))) {
      issues.push({ message: 'Format allure natation invalide (attendu min/100m)', fields: ['intensity'] });
    }
  }

  // GARDE-FOU EXPERT : une séance par intervalles (ex: "6x800m", "10x30/30") doit
  // impérativement préciser sa structure (échauffement / corps / retour au calme)
  // et un temps de repos explicite entre répétitions — sinon la séance est incomplète
  // pour l'athlète, même si les champs "obligatoires" sont techniquement remplis.
  const isInterval = /\d+\s*[x×]\s*\d+/i.test(`${workout.title || ''} ${workout.desc || ''}`);
  if (isInterval && (!workout.restTime || workout.restTime === '-')) {
    issues.push({ message: 'Séance par intervalles sans temps de repos précisé', fields: ['restTime'] });
  }
  if (isInterval && (!workout.structure || workout.structure.length < 15)) {
    issues.push({ message: 'Structure de séance manquante ou trop vague', fields: ['structure'] });
  }
  return { valid: issues.length === 0, issues };
}

/**
 * Corrige automatiquement une séance dont la cohérence a échoué,
 * en ne ré-enrichissant QUE les champs fautifs (jamais toute la séance),
 * pour ne pas écraser un contenu généré par l'IA qui était correct.
 */
export function sanitizeWorkout(workout, profile) {
  const enriched = enrichWorkoutMetrics(workout, profile);
  const { valid, issues } = checkWorkoutCoherence(enriched, profile);
  if (valid) return enriched;
  const fieldsToReset = new Set(issues.flatMap((i) => i.fields || []));
  const reset = { ...enriched };
  fieldsToReset.forEach((f) => { reset[f] = null; });
  return enrichWorkoutMetrics(reset, profile);
}

const REQUIRED_WORKOUT_FIELDS = ['id', 'day', 'type', 'title', 'duration', 'intensity', 'cadence', 'cardio', 'rpe', 'desc', 'structure'];

export function validateWorkout(workout) {
  const missing = REQUIRED_WORKOUT_FIELDS.filter(
    (field) => !workout || workout[field] === undefined || workout[field] === null || String(workout[field]).trim() === ''
  );
  return { valid: missing.length === 0, missing };
}

export function ensureCompleteWorkouts(workoutsObj, profile) {
  if (!workoutsObj) return { N: [], 'N+1': [] };
  return {
    N: (workoutsObj.N || []).map(w => sanitizeWorkout(w, profile)),
    'N+1': (workoutsObj['N+1'] || []).map(w => sanitizeWorkout(w, profile)),
  };
}

export function getIncompleteWorkouts(workoutsObj) {
  const incomplete = [];
  const checkList = [...(workoutsObj.N || []), ...(workoutsObj['N+1'] || [])];
  checkList.forEach(w => {
    const isInterval = /\d+\s*[x×]\s*\d+/i.test(`${w.title || ''} ${w.desc || ''}`);
    const missingCore = !w.intensity || !w.duration;
    const missingIntervalDetail = isInterval && (!w.restTime || w.restTime === '-' || !w.structure || w.structure.length < 15);
    if (missingCore || missingIntervalDetail) {
      incomplete.push(w);
    }
  });
  return incomplete;
}

// Libellés courts et cohérents utilisés PARTOUT dans l'app (calendrier, détail, filtres, chat)
export function shortLabel(type) {
  switch (type?.toUpperCase()) {
    case 'NATATION':
    case 'SWIM':
      return 'SWIM';
    case 'CYCLISME':
    case 'VELO':
    case 'BIKE':
      return 'BIKE';
    case 'C.A.P':
    case 'RUN':
      return 'RUN';
    case 'ENCHAÎNEMENT':
    case 'BRICK':
      return 'BRICK';
    case 'REPOS':
      return 'REPOS';
    default:
      return type?.slice(0, 5) || '-';
  }
}

/**
 * Champs de détail à afficher pour une séance, adaptés à la discipline
 * (RUN : zone d'effort / allure / BPM moyen — BIKE : watts / effort / cardio —
 * SWIM : zone d'effort / allure), avec le temps de repos toujours inclus.
 */
export function getDetailFields(workout) {
  const label = shortLabel(workout.type);
  const rest = { label: 'TEMPS DE REPOS', value: workout.restTime || '-' };  if (label === 'BIKE') {
    return [
      { label: 'WATTS', value: workout.intensity || '-' },
      { label: 'EFFORT (RPE)', value: workout.rpe || '-' },
      { label: 'CARDIO', value: workout.cardio || workout.avgBpm || '-' },
      rest,
    ];
  }
  if (label === 'SWIM') {
    return [
      { label: "ZONE D'EFFORT", value: workout.effortZone || workout.cardio || '-' },
      { label: 'ALLURE', value: workout.intensity || '-' },
      rest,
    ];
  }
  if (label === 'RUN' || label === 'BRICK') {
    return [
      { label: "ZONE D'EFFORT", value: workout.effortZone || '-' },
      { label: 'ALLURE', value: workout.intensity || '-' },
      { label: 'BPM MOYEN', value: workout.avgBpm || '-' },
      rest,
    ];
  }
  return [
    { label: 'INTENSITÉ', value: workout.intensity || '-' },
    { label: 'CARDIO', value: workout.cardio || '-' },
    rest,
  ];
}

/**
 * Applique les patches du coach IA aux séances.
 * - patchMode 'add'    : ajoute TOUJOURS une nouvelle séance (jamais d'écrasement), utile pour un jour double.
 * - patchMode 'modify' (défaut) : remplace la séance existante du jour en conservant l'ancienne
 *   version dans `previous` pour comparaison avant/après.
 */
export function mergeWorkoutPatches(workoutsObj, patches, profile) {
  if (!patches || !Array.isArray(patches)) return workoutsObj;
  const copy = {
    N: [...(workoutsObj.N || [])],
    'N+1': [...(workoutsObj['N+1'] || [])],
  };

  patches.forEach(patch => {
    const weekKey = patch.week || 'N';
    if (!copy[weekKey]) return;
    const mode = patch.patchMode === 'add' ? 'add' : 'modify';

    if (mode === 'add') {
      copy[weekKey].push(sanitizeWorkout({
        id: patch.id || 'w_' + Math.random().toString(36).substring(2, 7),
        day: patch.day || 'Lundi',
        type: patch.type || 'AUTRE',
        title: patch.title || 'Séance ajoutée',
        duration: patch.duration || '45 min',
        desc: patch.desc || 'Séance ajoutée par le coach.',
        modified: true,
        added: true,
        ...patch,
      }, profile));
      return;
    }

    const index = copy[weekKey].findIndex(w => w.id === patch.id || w.day?.toLowerCase() === patch.day?.toLowerCase());
    if (index !== -1) {
      const previous = { ...copy[weekKey][index] };
      copy[weekKey][index] = sanitizeWorkout({
        ...previous,
        ...patch,
        previous,
        modified: true,
      }, profile);
    } else {
      copy[weekKey].push(sanitizeWorkout({
        id: patch.id || 'w_' + Math.random().toString(36).substring(2, 7),
        day: patch.day || 'Lundi',
        type: patch.type || 'AUTRE',
        title: patch.title || 'Séance ajustée',
        duration: patch.duration || '1h00',
        desc: patch.desc || '',
        modified: true,
        ...patch,
      }, profile));
    }
  });

  return copy;
}

export function computeRaceStats(trainingPlan) {
  // trainingPlan.date = date de l'objectif/course (compte à rebours).
  // trainingPlan.startDate = date de début du plan (sert uniquement à calculer la progression).
  const raceDateStr = trainingPlan?.date || '2026-05-01';
  const startDateStr = trainingPlan?.startDate;

  const raceTimeMs = new Date(raceDateStr).getTime();
  const nowMs = Date.now();
  const diffDays = Math.ceil((raceTimeMs - nowMs) / (1000 * 60 * 60 * 24));
  const daysLeft = diffDays > 0 ? diffDays : 0;
  const weeksLeft = Math.ceil(daysLeft / 7);

  let progressPct = 0;
  const startTimeMs = startDateStr ? new Date(startDateStr).getTime() : NaN;
  if (!Number.isNaN(startTimeMs) && raceTimeMs > startTimeMs) {
    const totalDuration = raceTimeMs - startTimeMs;
    const elapsed = nowMs - startTimeMs;
    progressPct = Math.round(clamp((elapsed / totalDuration) * 100, 0, 100));
  }

  return {
    daysLeft,
    weeksLeft,
    progressPct,
  };
}

export function checkPlanCoherence(wizardData) {
  const warnings = [];
  if (wizardData && wizardData.hoursPerWeek > 15) {
    warnings.push('Volume horaire très élevé (>15h), attention au surentraînement.');
  }
  return warnings;
}
