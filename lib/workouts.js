// lib/workouts.js

export const DAYS_OF_WEEK = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

export const REQUIRED_FIELDS = ['id', 'title', 'type', 'day', 'duration', 'desc'];

export function isFilled(val) {
  if (val === undefined || val === null) return false;
  if (typeof val === 'string' && val.trim() === '') return false;
  return true;
}

export function normalizeDay(day) {
  if (!day) return 'Lundi';
  const lower = day.toLowerCase();
  const match = DAYS_OF_WEEK.find((d) => d.toLowerCase() === lower);
  return match || day;
}

/**
 * Guarantees a workout has every metric a coach would need to actually
 * execute the session (intensity/pace-or-watts, cadence, cardio zone, RPE),
 * filling any gap with a profile-derived estimate.
 */
export function enrichWorkoutMetrics(w, profile) {
  if (!w) return null;

  const type = (w.type || 'REPOS').toUpperCase();
  const isRest = type === 'REPOS' || type.includes('REPOS');

  let intensity = w.intensity;
  let cadence = w.cadence;
  let cardio = w.cardio;
  let rpe = w.rpe;

  if (isRest) {
    intensity = intensity || 'Récupération';
    cadence = cadence || '-';
    cardio = cardio || 'Repos < 60 bpm';
    rpe = rpe || 'RPE 1/10';
  } else if (type.includes('C.A.P') || type.includes('RUN')) {
    cadence = cadence || '175-180 spm';
    cardio = cardio || 'Z2-Z3 (140-155 bpm)';
    rpe = rpe || 'RPE 6/10';
    if (!isFilled(intensity) && profile?.vma) {
      const speed = (profile.vma * 0.75).toFixed(1);
      intensity = `${speed} km/h (75% VMA)`;
    }
  } else if (type.includes('CYCLISME') || type.includes('VELO') || type.includes('BIKE')) {
    cadence = cadence || '85-95 rpm';
    cardio = cardio || 'Z2-Z4 (130-160 bpm)';
    rpe = rpe || 'RPE 6/10';
    if (!isFilled(intensity) && profile?.ftp) {
      intensity = `${Math.round(profile.ftp * 0.75)}W (75% FTP)`;
    }
  } else if (type.includes('NATATION') || type.includes('SWIM')) {
    cadence = cadence || '32-36 mvt/min';
    cardio = cardio || 'Effort régulier Z2';
    rpe = rpe || 'RPE 6/10';
    if (!isFilled(intensity) && profile?.nat100) {
      intensity = `${profile.nat100} /100m`;
    }
  } else if (type.includes('ENCHAÎNEMENT') || type.includes('ENCHAINEMENT')) {
    cadence = cadence || '90 rpm / 178 spm';
    cardio = cardio || 'Z3 (155-165 bpm)';
    rpe = rpe || 'RPE 7/10';
    intensity = intensity || 'Allure race';
  } else {
    rpe = rpe || 'RPE 6/10';
    intensity = intensity || 'RPE 6';
    cadence = cadence || '-';
    cardio = cardio || 'Z2';
  }

  return {
    ...w,
    type,
    day: normalizeDay(w.day),
    intensity: intensity || 'RPE 6',
    cadence: cadence || '-',
    cardio: cardio || 'Z2',
    rpe: rpe || 'RPE 6/10',
    duration: w.duration || (isRest ? '30 min' : '45 min'),
    desc: w.desc || 'Échauffement, corps de séance, retour au calme.',
    modified: Boolean(w.modified),
  };
}

export function validateWorkout(w) {
  const enriched = { ...w };
  const missing = [];
  for (const field of REQUIRED_FIELDS) {
    if (!isFilled(enriched[field])) missing.push(field);
  }
  const metricFields = (enriched.type || '').toUpperCase().includes('REPOS')
    ? []
    : ['intensity', 'cadence', 'cardio', 'rpe'];
  for (const field of metricFields) {
    if (!isFilled(enriched[field])) missing.push(field);
  }
  if (!DAYS_OF_WEEK.some((d) => d.toLowerCase() === (enriched.day || '').toLowerCase())) {
    missing.push('day');
  }
  return { valid: missing.length === 0, missing, workout: enriched };
}

export function ensureCompleteWorkouts(workouts, profile) {
  const weeks = ['N', 'N+1'];
  const result = {};
  for (const week of weeks) {
    result[week] = (workouts?.[week] || []).map((w) => enrichWorkoutMetrics(w, profile));
  }
  return result;
}

export function getIncompleteWorkouts(workouts) {
  const incomplete = [];
  for (const week of ['N', 'N+1']) {
    for (const w of workouts?.[week] || []) {
      const { valid, missing } = validateWorkout(w);
      if (!valid) incomplete.push({ week, id: w.id, day: w.day, missing });
    }
  }
  return incomplete;
}

function weekSort(workouts) {
  for (const week of ['N', 'N+1']) {
    workouts[week].sort(
      (a, b) =>
        DAYS_OF_WEEK.findIndex((d) => d.toLowerCase() === a.day.toLowerCase()) -
        DAYS_OF_WEEK.findIndex((d) => d.toLowerCase() === b.day.toLowerCase())
    );
  }
}

export function mergeWorkoutPatches(current, patches, profile) {
  const next = ensureCompleteWorkouts(current, profile);
  if (!patches?.length) return next;
  for (const patch of patches) {
    const week = patch.week === 'N+1' ? 'N+1' : 'N';
    if (!next[week]) next[week] = [];
    const id = patch.id || patch.workoutId;
    const idx = id
      ? next[week].findIndex((w) => w.id === id)
      : next[week].findIndex((w) => w.day?.toLowerCase() === (patch.day || '').toLowerCase());
    const mergedId = id || (idx >= 0 ? next[week][idx].id : `${week}-${Date.now().toString(36)}`);
    const merged = enrichWorkoutMetrics(
      { ...(idx >= 0 ? next[week][idx] : {}), ...patch, id: mergedId, modified: true },
      profile
    );
    if (idx >= 0) next[week][idx] = merged;
    else next[week].push(merged);
  }
  weekSort(next);
  return next;
}

export function mergeFullWorkouts(current, incoming, profile) {
  if (!incoming) return ensureCompleteWorkouts(current, profile);
  const next = {
    N: incoming.N?.length ? incoming.N.map((w) => enrichWorkoutMetrics(w, profile)) : current.N,
    'N+1': incoming['N+1']?.length ? incoming['N+1'].map((w) => enrichWorkoutMetrics(w, profile)) : current['N+1'],
  };
  weekSort(next);
  return next;
}

/**
 * Days left / weeks left / progress percentage, computed against the real
 * current date (never hard-coded), for the "Objectif" tab gauge.
 */
export function computeRaceStats(trainingPlan) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(trainingPlan.date);
  target.setHours(0, 0, 0, 0);
  const start = new Date(trainingPlan.startDate || trainingPlan.date);
  start.setHours(0, 0, 0, 0);

  const diffTime = target - today;
  const daysLeft = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
  const weeksLeft = Math.max(0, Math.ceil(daysLeft / 7));

  const totalDuration = target - start;
  const elapsed = today - start;
  const progressPct =
    totalDuration <= 0 ? 100 : Math.min(100, Math.max(0, Math.round((elapsed / totalDuration) * 100)));

  return { daysLeft, weeksLeft, progressPct: Number.isNaN(progressPct) ? 0 : progressPct };
}

export function filterWorkoutsBySport(workouts, sportFilter) {
  if (sportFilter === 'ALL') return workouts;
  if (sportFilter === 'ENCHAÎNEMENT') {
    return workouts.filter((w) => (w.type || '').toUpperCase().includes('ENCHAÎN'));
  }
  return workouts.filter((w) => (w.type || '').toUpperCase().includes(sportFilter));
}

/**
 * Checks whether the requested weekly volume (hours) and number of sessions
 * are realistic together, and against the chosen race format. Returns a list
 * of warning strings (empty = coherent).
 */
export function checkPlanCoherence({ hoursPerWeek, maxSessionsPerWeek, sportType, distance, triathlonFormat }) {
  const warnings = [];
  const hours = Number(hoursPerWeek);
  const sessions = Number(maxSessionsPerWeek);

  if (hours > 0 && sessions > 0) {
    const avgMinutes = (hours * 60) / sessions;
    if (avgMinutes < 25) {
      warnings.push(
        `Avec ${sessions} séances pour ${hours}h/semaine, chaque séance ferait ~${Math.round(avgMinutes)} min en moyenne : c'est trop court pour être efficace. Réduis le nombre de séances ou augmente le volume.`
      );
    } else if (avgMinutes > 150) {
      warnings.push(
        `Avec seulement ${sessions} séances pour ${hours}h/semaine, chaque séance ferait ~${Math.round(avgMinutes / 60)}h en moyenne : envisage d'ajouter des séances pour mieux répartir la charge.`
      );
    }
  }

  const isLongRunFormat = distance === 'Marathon';
  const isLongTriFormat = triathlonFormat === 'L' || triathlonFormat === 'XL';
  if ((sportType === 'running' && isLongRunFormat && sessions < 4) ||
      (sportType === 'triathlon' && isLongTriFormat && sessions < 4)) {
    warnings.push('Préparer un format long avec moins de 4 séances par semaine est insuffisant pour un entraînement sécurisé et qualitatif.');
  }

  if (hours > 0 && hours < 3 && sportType === 'triathlon') {
    warnings.push('Moins de 3h/semaine est très juste pour progresser sur 3 disciplines à la fois.');
  }

  return warnings;
}    cadence = cadence || '175-180 spm';
    cardio = cardio || 'Z2-Z3 (140-155 bpm)';
    rpe = rpe || 'RPE 6/10';
    if (!isFilled(intensity) && profile?.vma) {
      const speed = (profile.vma * 0.75).toFixed(1);
      intensity = `${speed} km/h (75% VMA)`;
    }
  } else if (type.includes('CYCLISME') || type.includes('VELO') || type.includes('BIKE')) {
    cadence = cadence || '85-95 rpm';
    cardio = cardio || 'Z2-Z4 (130-160 bpm)';
    rpe = rpe || 'RPE 6/10';
    if (!isFilled(intensity) && profile?.ftp) {
      intensity = `${Math.round(profile.ftp * 0.75)}W (75% FTP)`;
    }
  } else if (type.includes('NATATION') || type.includes('SWIM')) {
    cadence = cadence || '32-36 mvt/min';
    cardio = cardio || 'Effort régulier Z2';
    rpe = rpe || 'RPE 6/10';
    if (!isFilled(intensity) && profile?.nat100) {
      intensity = `${profile.nat100} /100m`;
    }
  } else if (type.includes('ENCHAÎNEMENT') || type.includes('ENCHAINEMENT')) {
    cadence = cadence || '90 rpm / 178 spm';
    cardio = cardio || 'Z3 (155-165 bpm)';
    rpe = rpe || 'RPE 7/10';
    intensity = intensity || 'Allure race';
  } else {
    rpe = rpe || 'RPE 6/10';
    intensity = intensity || 'RPE 6';
    cadence = cadence || '-';
    cardio = cardio || 'Z2';
  }

  return {
    ...w,
    type,
    day: normalizeDay(w.day),
    intensity: intensity || 'RPE 6',
    cadence: cadence || '-',
    cardio: cardio || 'Z2',
    rpe: rpe || 'RPE 6/10',
    duration: w.duration || (isRest ? '30 min' : '45 min'),
    desc: w.desc || 'Échauffement, corps de séance, retour au calme.',
    modified: Boolean(w.modified),
  };
}

export function validateWorkout(w) {
  const enriched = { ...w };
  const missing = [];
  for (const field of REQUIRED_FIELDS) {
    if (field === 'cadence' && (enriched.type || '').toUpperCase().includes('REPOS')) continue;
    if (!isFilled(enriched[field])) missing.push(field);
  }
  if (!DAYS_OF_WEEK.some((d) => d.toLowerCase() === (enriched.day || '').toLowerCase())) {
    missing.push('day');
  }
  return { valid: missing.length === 0, missing, workout: enriched };
}

export function ensureCompleteWorkouts(workouts, profile) {
  const weeks = ['N', 'N+1'];
  const result = {};
  for (const week of weeks) {
    result[week] = (workouts?.[week] || []).map((w) => enrichWorkoutMetrics(w, profile));
  }
  return result;
}

export function getIncompleteWorkouts(workouts) {
  const incomplete = [];
  for (const week of ['N', 'N+1']) {
    for (const w of workouts?.[week] || []) {
      const { valid, missing } = validateWorkout(w);
      if (!valid) incomplete.push({ week, id: w.id, day: w.day, missing });
    }
  }
  return incomplete;
}

export function mergeWorkoutPatches(current, patches, profile) {
  const next = ensureCompleteWorkouts(current, profile);
  if (!patches?.length) return next;
  for (const patch of patches) {
    const week = patch.week === 'N+1' ? 'N+1' : 'N';
    const id = patch.id || patch.workoutId;
    if (!id) continue;
    const idx = next[week].findIndex((w) => w.id === id);
    const merged = enrichWorkoutMetrics(
      { ...(idx >= 0 ? next[week][idx] : {}), ...patch, id, modified: true },
      profile
    );
    if (idx >= 0) next[week][idx] = merged;
    else next[week].push(merged);
  }
  weekSort(next);
  return next;
}

function weekSort(workouts) {
  for (const week of ['N', 'N+1']) {
    workouts[week].sort(
      (a, b) =>
        DAYS_OF_WEEK.findIndex((d) => d.toLowerCase() === a.day.toLowerCase()) -
        DAYS_OF_WEEK.findIndex((d) => d.toLowerCase() === b.day.toLowerCase())
    );
  }
}

export function mergeFullWorkouts(current, incoming, profile) {
  if (!incoming) return ensureCompleteWorkouts(current, profile);
  const next = {
    N: incoming.N?.length ? incoming.N.map((w) => enrichWorkoutMetrics(w, profile)) : current.N,
    'N+1': incoming['N+1']?.length ? incoming['N+1'].map((w) => enrichWorkoutMetrics(w, profile)) : current['N+1'],
  };
  weekSort(next);
  return next;
}

export function computeRaceStats(trainingPlan) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(trainingPlan.date);
  target.setHours(0, 0, 0, 0);
  const start = new Date(trainingPlan.startDate);
  start.setHours(0, 0, 0, 0);
  const diffTime = target - today;
  const daysLeft = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
  const weeksLeft = Math.max(0, Math.ceil(daysLeft / 7));
  const totalDuration = target - start;
  const elapsed = today - start;
  const progressPct =
    totalDuration <= 0
      ? 100
      : Math.min(100, Math.max(0, Math.round((elapsed / totalDuration) * 100)));
  return { daysLeft, weeksLeft, progressPct: Number.isNaN(progressPct) ? 0 : progressPct };
}

export function filterWorkoutsBySport(workouts, sportFilter) {
  if (sportFilter === 'ALL') return workouts;
  if (sportFilter === 'ENCHAÎNEMENT') {
    return workouts.filter((w) => (w.type || '').toUpperCase().includes('ENCHAÎN'));
  }
  return workouts.filter((w) => (w.type || '').toUpperCase().includes(sportFilter));
}
