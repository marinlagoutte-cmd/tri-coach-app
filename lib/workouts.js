// lib/workouts.js

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export function enrichWorkoutMetrics(workout, profile) {
  if (!workout) return workout;
  let { type, intensity, cadence, cardio, rpe, effortZone, avgBpm, restTime } = workout;
  type = (type || '').toUpperCase();
  const fcMax = profile?.fcMax || 190;
  const fcRepos = profile?.fcRepos || 55;

  if (type.includes('C.A.P') || type.includes('RUN')) {
    if (!intensity || intensity.includes('VMA')) {
      const speed = profile && profile.vma ? (profile.vma * 0.75).toFixed(1) : '12.0';
      intensity = `${speed} km/h (75% VMA)`;
    }
    cadence = cadence || '175-180 spm';
    effortZone = effortZone || 'Z2-Z3';
    avgBpm = avgBpm || `${Math.round(fcRepos + (fcMax - fcRepos) * 0.65)} bpm`;
    cardio = cardio || `${effortZone} (${avgBpm})`;
    rpe = rpe || 'RPE 6/10';
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
  } else if (type.includes('NATATION') || type.includes('SWIM')) {
    intensity = intensity || (profile && profile.nat100 ? `${profile.nat100} /100m` : '1:35 /100m');
    cadence = cadence || '34-38 mvt/min';
    effortZone = effortZone || 'Z2-Z3';
    cardio = cardio || effortZone;
    rpe = rpe || 'RPE 5/10';
  } else {
    intensity = intensity || 'Récupération';
    cadence = cadence || '-';
    effortZone = effortZone || 'Repos';
    cardio = cardio || `< ${Math.round(fcRepos + 5)} bpm`;
    rpe = rpe || 'RPE 1/10';
  }

  restTime = restTime || (type === 'REPOS' ? '-' : "1'30 à 3' entre les répétitions selon l'allure");

  return { ...workout, intensity, cadence, cardio, rpe, effortZone, avgBpm, restTime };
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

  const bpmMatch = String(workout.avgBpm || workout.cardio || '').match(/(\d{2,3})/);
  if (bpmMatch) {
    const bpm = Number(bpmMatch[1]);
    if (bpm < fcRepos - 5 || bpm > fcMax + 5) issues.push(`BPM incohérent (${bpm})`);
  }

  if (type.includes('CYCLISME') || type.includes('VELO') || type.includes('BIKE')) {
    const wMatch = String(workout.intensity || '').match(/(\d{2,4})\s*W/i);
    const ftp = profile?.ftp || 280;
    if (wMatch && (Number(wMatch[1]) < 40 || Number(wMatch[1]) > ftp * 1.3)) {
      issues.push(`Puissance incohérente (${wMatch[1]}W)`);
    }
  }
  if (type.includes('C.A.P') || type.includes('RUN')) {
    const kmhMatch = String(workout.intensity || '').match(/([\d.]+)\s*km\/h/i);
    const vma = profile?.vma || 16;
    if (kmhMatch && (Number(kmhMatch[1]) < 5 || Number(kmhMatch[1]) > vma * 1.15)) {
      issues.push(`Allure incohérente (${kmhMatch[1]} km/h)`);
    }
  }
  if (type.includes('NATATION') || type.includes('SWIM')) {
    if (!/^\d:\d{2}/.test(String(workout.intensity || ''))) {
      issues.push('Format allure natation invalide');
    }
  }
  return { valid: issues.length === 0, issues };
}

/**
 * Corrige automatiquement une séance dont la cohérence a échoué,
 * en la ré-enrichissant avec des valeurs par défaut sûres.
 */
export function sanitizeWorkout(workout, profile) {
  const enriched = enrichWorkoutMetrics(workout, profile);
  const { valid } = checkWorkoutCoherence(enriched, profile);
  if (valid) return enriched;
  return enrichWorkoutMetrics({ ...enriched, intensity: null, avgBpm: null, cardio: null }, profile);
}

const REQUIRED_WORKOUT_FIELDS = ['id', 'day', 'type', 'title', 'duration', 'intensity', 'cadence', 'cardio', 'rpe', 'desc'];

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
    if (!w.intensity || !w.duration) {
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
  const rest = { label: 'TEMPS DE REPOS', value: workout.restTime || '-' };
  if (label === 'BIKE') {
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
  const targetDateStr = trainingPlan?.startDate || '2026-05-01';
  const targetTimeMs = new Date(targetDateStr).getTime();
  const nowMs = Date.now();
  const diffDays = Math.ceil((targetTimeMs - nowMs) / (1000 * 60 * 60 * 24));
  const daysLeft = diffDays > 0 ? diffDays : 0;
  const weeksLeft = Math.ceil(daysLeft / 7);
  return {
    daysLeft,
    weeksLeft,
    progressPct: 35,
  };
}

export function checkPlanCoherence(wizardData) {
  const warnings = [];
  if (wizardData && wizardData.hoursPerWeek > 15) {
    warnings.push('Volume horaire très élevé (>15h), attention au surentraînement.');
  }
  return warnings;
}
