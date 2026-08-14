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
export function normalizeDay(day) {
  if (!day) return 'Lundi';
  const lower = day.toLowerCase();
  const match = DAYS_OF_WEEK.find((d) => d.toLowerCase() === lower);
  return match || day;
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
