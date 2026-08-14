// lib/workouts.js

export function enrichWorkoutMetrics(workout, profile) {
  if (!workout) return workout;
  let { type, intensity, cadence, cardio, rpe } = workout;
  type = (type || '').toUpperCase();

  if (type.includes('C.A.P') || type.includes('RUN')) {
    if (!intensity || intensity.includes('VMA')) {
      const speed = profile && profile.vma ? (profile.vma * 0.75).toFixed(1) : '12.0';
      intensity = `${speed} km/h (75% VMA)`;
    }
    cadence = cadence || '175-180 spm';
    cardio = cardio || 'Z2-Z3 (140-155 bpm)';
    rpe = rpe || 'RPE 6/10';
  } else if (type.includes('CYCLISME') || type.includes('VELO') || type.includes('BIKE')) {
    if (!intensity || intensity.includes('FTP')) {
      const power = profile && profile.ftp ? Math.round(profile.ftp * 0.75) : 210;
      intensity = `${power}W (75% FTP)`;
    }
    cadence = cadence || '85-95 rpm';
    cardio = cardio || 'Z2-Z4 (130-160 bpm)';
    rpe = rpe || 'RPE 6/10';
  } else if (type.includes('NATATION') || type.includes('SWIM')) {
    intensity = intensity || (profile && profile.nat100 ? `${profile.nat100} /100m` : '1:35 /100m');
    cadence = cadence || '34-38 mvt/min';
    cardio = cardio || 'Z2-Z3';
    rpe = rpe || 'RPE 5/10';
  } else {
    intensity = intensity || 'Récupération';
    cadence = cadence || '-';
    cardio = cardio || 'Repos < 60 bpm';
    rpe = rpe || 'RPE 1/10';
  }

  return {
    ...workout,
    intensity,
    cadence,
    cardio,
    rpe,
  };
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
    N: (workoutsObj.N || []).map(w => enrichWorkoutMetrics(w, profile)),
    'N+1': (workoutsObj['N+1'] || []).map(w => enrichWorkoutMetrics(w, profile)),
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

export function mergeWorkoutPatches(workoutsObj, patches, profile) {
  if (!patches || !Array.isArray(patches)) return workoutsObj;
  const copy = {
    N: [...(workoutsObj.N || [])],
    'N+1': [...(workoutsObj['N+1'] || [])],
  };

  patches.forEach(patch => {
    const weekKey = patch.week || 'N';
    if (copy[weekKey]) {
      const index = copy[weekKey].findIndex(w => w.id === patch.id || w.day?.toLowerCase() === patch.day?.toLowerCase());
      if (index !== -1) {
        copy[weekKey][index] = enrichWorkoutMetrics({
          ...copy[weekKey][index],
          ...patch,
          modified: true,
        }, profile);
      } else {
        copy[weekKey].push(enrichWorkoutMetrics({
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
