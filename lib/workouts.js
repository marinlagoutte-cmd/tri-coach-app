// lib/workouts.js

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export function enrichWorkoutMetrics(workout, profile) {
  if (!workout) return workout;
  let { type, intensity, cadence, cardio, rpe, effortZone, avgBpm, restTime, structure } = workout;
  type = (type || '').toUpperCase();
  // Ne JAMAIS fabriquer une FC max/repos par défaut (190/55) : si l'athlète ne
  // les a pas renseignées, on n'affiche/ne calcule aucun bpm plutôt qu'un chiffre inventé.
  const fcMax = profile?.fcMax || null;
  const fcRepos = profile?.fcRepos || null;
  const isInterval = /\d+\s*[x×]\s*\d+/i.test(`${workout.title || ''} ${workout.desc || ''}`);

  if (type.includes('C.A.P') || type.includes('RUN')) {
    const hasValidPace = /\d+:\d{2}\s*\/?\s*(min\/)?km/i.test(String(intensity || ''));
    if (!hasValidPace) {
      const kmhMatch = String(intensity || '').match(/(\d+(?:[.,]\d+)?)\s*k\s*m\s*\/?\s*h/i);
      if (kmhMatch) {
        // L'IA a donné une vitesse en km/h : on la CONVERTIT en min/km au lieu de la
        // jeter, pour préserver l'allure réellement voulue par l'IA pour cette séance.
        const speedKmh = Number(kmhMatch[1].replace(',', '.'));
        const paceMin = 60 / speedKmh;
        const min = Math.floor(paceMin);
        const sec = Math.round((paceMin - min) * 60);
        intensity = `${min}:${String(sec).padStart(2, '0')} /km`;
      } else if (profile && profile.vma) {
        // Repli sur le profil connu (75% VMA) — jamais une constante générique.
        const speedKmh = profile.vma * 0.75;
        const paceMin = 60 / speedKmh;
        const min = Math.floor(paceMin);
        const sec = Math.round((paceMin - min) * 60);
        intensity = `${min}:${String(sec).padStart(2, '0')} /km (75% VMA)`;
      } else {
        // VMA non renseignée : on n'invente AUCUN chiffre, on retombe sur un
        // repère RPE (ressenti) au lieu d'une allure calculée sur une valeur fictive.
        intensity = 'Allure selon ressenti (RPE 6/10) — VMA non renseignée';
      }
    }
    cadence = cadence || '175-180 spm';
    effortZone = effortZone || 'Z2-Z3';
    avgBpm = (profile?.fcMax && profile?.fcRepos) ? (avgBpm || `${Math.round(fcRepos + (fcMax - fcRepos) * 0.65)} bpm`) : (avgBpm || null);
    cardio = cardio || (avgBpm ? `${effortZone} (${avgBpm})` : effortZone);
    rpe = rpe || 'RPE 6/10';
    restTime = restTime || (isInterval ? "Récup. trot 1' à 2' entre les répétitions (50-100% du temps d'effort)" : '-');
    structure = structure || (isInterval
      ? `Échauffement 15min Z1-Z2 + corps de séance (allure cible ${intensity}) + retour au calme 10min Z1`
      : `Échauffement 10min progressif puis allure continue ${intensity}, retour au calme 5min`);
  } else if (type.includes('CYCLISME') || type.includes('VELO') || type.includes('BIKE')) {
    if (!intensity || intensity.includes('FTP')) {
      if (profile && profile.ftp) {
        intensity = `${Math.round(profile.ftp * 0.75)}W (75% FTP)`;
      } else {
        // FTP non renseignée : pas de watts inventés, repère RPE uniquement.
        intensity = 'Effort selon ressenti (RPE 6/10) — FTP non renseignée';
      }
    }
    cadence = cadence || '85-95 rpm';
    effortZone = effortZone || 'Z2-Z4';
    avgBpm = (profile?.fcMax && profile?.fcRepos) ? (avgBpm || `${Math.round(fcRepos + (fcMax - fcRepos) * 0.6)} bpm`) : (avgBpm || null);
    cardio = cardio || (avgBpm ? `${effortZone} (${avgBpm})` : effortZone);
    rpe = rpe || 'RPE 6/10';
    restTime = restTime || (isInterval ? "Récup. souple 3' à 5' entre les blocs (cadence libre, faible résistance)" : '-');
    structure = structure || (isInterval
      ? `Échauffement 15min progressif + blocs à ${intensity} + retour au calme 10min souple`
      : `Échauffement 10-15min progressif puis allure continue ${intensity}, retour au calme 10min`);
  } else if (type.includes('NATATION') || type.includes('SWIM')) {
    intensity = intensity || (profile && profile.nat100 ? `${profile.nat100} /100m` : 'Allure confortable selon ressenti — CSS non renseignée');
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
    cardio = cardio || (fcRepos ? `< ${Math.round(fcRepos + 5)} bpm` : 'Repos');
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
  // Pas de FC max/repos par défaut inventée : sans donnée réelle, on ne peut
  // simplement pas juger si un bpm est cohérent, donc on ne tente pas le contrôle.
  const fcMax = profile?.fcMax || null;
  const fcRepos = profile?.fcRepos || null;
  // Une intensité exprimée "selon ressenti / RPE" est le format attendu quand la
  // métrique correspondante (VMA/FTP/CSS) n'est pas renseignée — ce n'est PAS une
  // erreur à corriger, contrairement à un format numérique invalide.
  const isRpeBased = /ressenti|rpe/i.test(String(workout.intensity || ''));

  // Chaque issue est taguée avec le(s) champ(s) fautif(s), pour ne corriger
  // QUE ce qui pose problème (jamais effacer une séance entière déjà correcte).
  if (fcMax && fcRepos) {
    const bpmMatch = String(workout.avgBpm || workout.cardio || '').match(/(\d{2,3})/);
    if (bpmMatch) {
      const bpm = Number(bpmMatch[1]);
      if (bpm < fcRepos - 5 || bpm > fcMax + 5) {
        issues.push({ message: `BPM incohérent (${bpm})`, fields: ['avgBpm', 'cardio'] });
      }
    }
  }

  if (!isRpeBased && (type.includes('CYCLISME') || type.includes('VELO') || type.includes('BIKE')) && profile?.ftp) {
    const wMatch = String(workout.intensity || '').match(/(\d{2,4})\s*W/i);
    if (wMatch && (Number(wMatch[1]) < 40 || Number(wMatch[1]) > profile.ftp * 1.3)) {
      issues.push({ message: `Puissance incohérente (${wMatch[1]}W)`, fields: ['intensity'] });
    }
  }
  if (!isRpeBased && (type.includes('C.A.P') || type.includes('RUN')) && profile?.vma) {
    // Allure attendue au format min/km (ex: "4:30 /km"), jamais en km/h.
    const intensityStr = String(workout.intensity || '');
    const hasKmh = /\d+(?:[.,]\d+)?\s*k\s*m\s*\/?\s*h/i.test(intensityStr);
    const paceMatch = intensityStr.match(/(\d+):(\d{2})\s*\/?\s*(?:min\/)?km/i);
    if (hasKmh || !paceMatch) {
      issues.push({
        message: hasKmh
          ? `Allure donnée en km/h au lieu de min/km (${intensityStr})`
          : 'Format allure course invalide (attendu min/km)',
        fields: ['intensity'],
      });
    } else {
      const paceMin = Number(paceMatch[1]) + Number(paceMatch[2]) / 60;
      const speedKmh = 60 / paceMin;
      if (speedKmh < 5 || speedKmh > profile.vma * 1.15) {
        issues.push({ message: `Allure incohérente (${paceMatch[0]})`, fields: ['intensity'] });
      }
    }
  }
  if (!isRpeBased && (type.includes('NATATION') || type.includes('SWIM')) && profile?.nat100) {
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
  if (!workout) return workout;
  // Normalisation du type EN PREMIER : toute la suite (enrichissement, badges,
  // filtres calendrier) se base sur cette valeur canonique — voir classifyDiscipline
  // ci-dessus pour pourquoi c'est nécessaire.
  const canonicalType = classifyDiscipline(workout.type);
  const normalized = canonicalType ? { ...workout, type: canonicalType } : workout;
  const enriched = enrichWorkoutMetrics(normalized, profile);
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

// Classification ROBUSTE de la discipline : l'IA ne respecte pas toujours à la
// lettre l'énumération demandée dans le prompt (ex: "C.A.P/RUN" recopié tel quel,
// "Course à pied" en toutes lettres, "running", etc.) — un simple switch sur la
// valeur exacte laissait alors passer un type non reconnu, ce qui cassait ensuite
// TOUT l'affichage de cette séance (badge, filtre par sport, calendrier : une
// séance de type non reconnu n'est filtrée dans AUCUN sport et disparaît du
// calendrier). Cette fonction reconnaît la discipline quel que soit le texte
// exact renvoyé par l'IA et la ramène TOUJOURS vers une des 5 valeurs canoniques
// utilisées partout dans l'app.
export function classifyDiscipline(type) {
  const t = (type || '').toUpperCase();
  if (!t) return null;
  if (t.includes('REPOS') || t.includes('REST') || t.includes('OFF')) return 'REPOS';
  if (t.includes('ENCHA') || t.includes('BRICK')) return 'ENCHAÎNEMENT';
  if (t.includes('NATATION') || t.includes('SWIM') || t.includes('NAGE') || t.includes('NAT')) return 'NATATION';
  if (t.includes('CYCLISME') || t.includes('VELO') || t.includes('VÉLO') || t.includes('BIKE') || t.includes('CYCL')) return 'CYCLISME';
  if (t.includes('C.A.P') || t.includes('CAP') || t.includes('RUN') || t.includes('COURSE') || t.includes('COURIR')) return 'C.A.P';
  return null; // Type vraiment non identifiable : on ne devine pas au hasard.
}

// Libellés courts et cohérents utilisés PARTOUT dans l'app (calendrier, détail, filtres, chat)
export function shortLabel(type) {
  switch (classifyDiscipline(type)) {
    case 'NATATION':
      return 'SWIM';
    case 'CYCLISME':
      return 'BIKE';
    case 'C.A.P':
      return 'RUN';
    case 'ENCHAÎNEMENT':
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

/**
 * Fusionne une réponse de "correction" de l'IA avec la semaine d'origine SANS
 * jamais pouvoir perdre de jour. Avant, une correction (complétion de champs
 * manquants ou ajustement du nombre de séances) remplaçait la semaine entière
 * par ce que l'IA renvoyait (`data.workouts = fixData.workouts`) — si l'IA ne
 * renvoyait qu'un sous-ensemble des 7 jours (ex: seulement les jours corrigés),
 * la moitié de la semaine disparaissait purement et simplement du calendrier.
 * Ici, on fusionne jour par jour : chaque jour présent dans `fixedWeek` remplace
 * le jour correspondant dans `originalWeek`, mais tout jour ABSENT de la réponse
 * de correction conserve sa version d'origine — jamais de perte.
 */
export function mergeWeekFix(originalWeek, fixedWeek) {
  const original = Array.isArray(originalWeek) ? originalWeek : [];
  const fixed = Array.isArray(fixedWeek) ? fixedWeek : [];
  if (fixed.length === 0) return original;

  const byDay = new Map(original.map((w) => [w.day?.toLowerCase(), w]));
  fixed.forEach((w) => {
    if (w?.day) byDay.set(w.day.toLowerCase(), w);
  });
  // On restitue dans l'ordre des jours d'origine (stable), en ajoutant en fin
  // toute entrée de `fixed` dont le jour n'existait pas déjà (cas limite).
  const result = original.map((w) => byDay.get(w.day?.toLowerCase()) || w);
  const originalDays = new Set(original.map((w) => w.day?.toLowerCase()));
  fixed.forEach((w) => {
    if (w?.day && !originalDays.has(w.day.toLowerCase())) result.push(w);
  });
  return result;
}

// --- COHÉRENCE NOMBRE DE SÉANCES vs QUESTIONNAIRE ------------------------------
// Avant : rien ne garantissait que le nombre de jours réellement entraînés dans
// le plan généré corresponde à `maxSessionsPerWeek`, ni que le jour de repos
// choisi (`offDays`) soit bien un vrai jour REPOS — le prompt le demandait
// "gentiment" mais rien ne le vérifiait ni ne le corrigeait. Ces fonctions
// contrôlent ET corrigent déterministiquement, en dernier recours, si l'IA
// n'a pas respecté la contrainte après ses tentatives de correction.

/**
 * Vérifie, pour une semaine de séances (7 entrées attendues), que :
 *  - le nombre de jours d'entraînement réel == maxSessionsPerWeek
 *  - le(s) jour(s) de repos obligatoire(s) déclaré(s) sont bien de type REPOS
 * Retourne la liste des problèmes détectés (vide = cohérent).
 */
export function checkSessionCountCoherence(weekWorkouts, maxSessionsPerWeek, offDays) {
  const issues = [];
  const list = Array.isArray(weekWorkouts) ? weekWorkouts : [];
  const target = Number(maxSessionsPerWeek);
  if (!target) return issues;

  const trainingDays = list.filter((w) => w.type !== 'REPOS');
  if (trainingDays.length !== target) {
    issues.push({
      message: `${trainingDays.length} jour(s) d'entraînement générés au lieu des ${target} demandés au questionnaire.`,
      actual: trainingDays.length,
      expected: target,
    });
  }

  const mandatoryOffDays = String(offDays || '').split(',').map((d) => d.trim()).filter(Boolean);
  mandatoryOffDays.forEach((day) => {
    const entry = list.find((w) => w.day?.toLowerCase() === day.toLowerCase());
    if (entry && entry.type !== 'REPOS') {
      issues.push({
        message: `Le ${day} devait être un jour de repos obligatoire mais contient une séance (${entry.type}).`,
        day,
      });
    }
  });

  return issues;
}

/**
 * Correction déterministe de dernier recours (utilisée seulement si l'IA n'a
 * toujours pas respecté la contrainte après une tentative de correction via
 * prompt) : ne supprime ni n'invente jamais une séance sans raison — bascule
 * uniquement les jours en trop / manquants pour respecter le nombre demandé,
 * en gardant toujours le(s) jour(s) de repos obligatoire(s) en REPOS et en
 * conservant les séances les plus longues (généralement les plus structurantes
 * de la semaine) quand il faut réduire.
 */
export function enforceSessionCount(weekWorkouts, maxSessionsPerWeek, offDays, profile, sportType) {
  const target = Number(maxSessionsPerWeek);
  if (!target || !Array.isArray(weekWorkouts) || weekWorkouts.length === 0) return weekWorkouts;

  const mandatoryOffDays = String(offDays || '').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
  const list = weekWorkouts.map((w) => ({ ...w }));

  // 1) Le(s) jour(s) de repos obligatoire(s) doivent toujours être REPOS.
  list.forEach((w) => {
    if (mandatoryOffDays.includes(w.day?.toLowerCase()) && w.type !== 'REPOS') {
      w.type = 'REPOS';
      w.title = 'Repos complet';
      w.intensity = 'Récupération';
      w.duration = '0 min';
      w.desc = 'Repos imposé par tes disponibilités (jour de repos obligatoire déclaré au questionnaire).';
    }
  });

  let trainingDays = list.filter((w) => w.type !== 'REPOS');

  // 2) Trop de jours entraînés : on repasse en REPOS les séances les plus
  // courtes en priorité (on garde les séances longues/structurantes).
  if (trainingDays.length > target) {
    const sortedByDurationAsc = [...trainingDays].sort((a, b) => parseDurationMinutes(a.duration) - parseDurationMinutes(b.duration));
    const toDemote = sortedByDurationAsc.slice(0, trainingDays.length - target);
    const demoteIds = new Set(toDemote.map((w) => w.id));
    list.forEach((w) => {
      if (demoteIds.has(w.id)) {
        w.type = 'REPOS';
        w.title = 'Repos complet';
        w.intensity = 'Récupération';
        w.duration = '0 min';
        w.desc = "Repos ajouté automatiquement pour respecter le nombre de séances/semaine déclaré au questionnaire.";
      }
    });
  }

  // 3) Pas assez de jours entraînés (cas fréquent au-delà de ~6-7 séances/semaine :
  // l'IA ne pense pas toujours à doubler des jours) : on complète en ajoutant des
  // séances SUPPLÉMENTAIRES sur les jours déjà entraînés (jours "doubles", ex: brick),
  // jamais sur un jour de repos obligatoire. On ne supprime ni ne remplace jamais une
  // séance existante — uniquement des AJOUTS, en tournant sur la discipline la moins
  // représentée dans la semaine pour garder un minimum d'équilibre.
  if (trainingDays.length < target) {
    const isRunOnly = sportType === 'running';
    const disciplineCycle = isRunOnly ? ['C.A.P'] : ['C.A.P', 'CYCLISME', 'NATATION'];
    const countByDiscipline = (type) => list.filter((w) => classifyDiscipline(w.type) === type).length;

    // Jours éligibles à recevoir une séance supplémentaire : tous sauf repos obligatoire.
    // On répartit en boucle (round-robin) sur les jours ayant le MOINS de séances
    // aujourd'hui, pour éviter d'empiler 4 séances sur un seul jour.
    const eligibleDays = [...new Set(list.map((w) => w.day))].filter(
      (day) => !mandatoryOffDays.includes(String(day).toLowerCase())
    );

    let missing = target - trainingDays.length;
    let guard = 0;
    while (missing > 0 && guard < 30) {
      guard += 1;
      // Jour ayant actuellement le moins de séances (repos y compris = 0 séance "réelle").
      const sessionsPerDay = eligibleDays.map((day) => ({
        day,
        count: list.filter((w) => w.day === day && w.type !== 'REPOS').length,
      }));
      sessionsPerDay.sort((a, b) => a.count - b.count);
      const targetDay = sessionsPerDay[0]?.day;
      if (!targetDay) break;

      // Discipline la moins représentée cette semaine (parmi celles autorisées).
      const nextType = [...disciplineCycle].sort(
        (a, b) => countByDiscipline(a) - countByDiscipline(b)
      )[0];

      const restIdx = list.findIndex((w) => w.day === targetDay && w.type === 'REPOS');
      const newWorkout = {
        id: `auto-${targetDay}-${Date.now()}-${guard}`,
        day: targetDay,
        type: nextType,
        title: `Séance complémentaire ${nextType === 'C.A.P' ? 'course à pied' : nextType === 'CYCLISME' ? 'vélo' : 'natation'}`,
        duration: '35 min',
        modified: false,
        desc: "Séance ajoutée automatiquement pour atteindre le nombre de séances/semaine déclaré au questionnaire (jour double).",
      };

      if (restIdx !== -1) {
        // Le jour choisi était un jour de repos NON obligatoire : on le remplace.
        list[restIdx] = newWorkout;
      } else {
        // Le jour a déjà au moins une séance : on ajoute une vraie séance double.
        list.push(newWorkout);
      }
      missing -= 1;
    }
  }

  return list.map((w) => sanitizeWorkout(w, profile));
}

export function parseDurationMinutes(duration) {
  const str = String(duration || '');
  const hMatch = str.match(/(\d+)\s*h/i);
  const mMatch = str.match(/(\d+)\s*m/i);
  const hours = hMatch ? Number(hMatch[1]) : 0;
  const mins = mMatch ? Number(mMatch[1]) : (hMatch ? 0 : Number(str) || 0);
  return hours * 60 + mins;
}

export function computeRaceStats(trainingPlan) {
  // trainingPlan.date = date de l'objectif/course (compte à rebours).
  // trainingPlan.startDate = date de début du plan (sert uniquement à calculer la progression).
  // Format attendu : ISO (YYYY-MM-DD), seul format que `new Date()` parse de façon fiable
  // et identique dans tous les navigateurs (un format texte comme "15 Juin 2026" donne une
  // Date invalide -> NaN -> compteur silencieusement figé à 0, sans erreur visible).
  const raceDateStr = trainingPlan?.date || '2026-05-01';
  const startDateStr = trainingPlan?.startDate;

  const raceTimeMs = new Date(raceDateStr).getTime();
  const dateIsValid = !Number.isNaN(raceTimeMs);
  const nowMs = Date.now();
  const diffDays = dateIsValid ? Math.ceil((raceTimeMs - nowMs) / (1000 * 60 * 60 * 24)) : null;
  const daysLeft = dateIsValid ? Math.max(0, diffDays) : null;
  const weeksLeft = dateIsValid ? Math.ceil(daysLeft / 7) : null;

  let progressPct = 0;
  const startTimeMs = startDateStr ? new Date(startDateStr).getTime() : NaN;
  if (dateIsValid && !Number.isNaN(startTimeMs) && raceTimeMs > startTimeMs) {
    const totalDuration = raceTimeMs - startTimeMs;
    const elapsed = nowMs - startTimeMs;
    progressPct = Math.round(clamp((elapsed / totalDuration) * 100, 0, 100));
  }

  return {
    daysLeft,
    weeksLeft,
    progressPct,
    dateIsValid,
  };
}

// --- CONSEILS DE COHÉRENCE "COACH EXPERT" ---
// Repères de préparation classiques (littérature coaching triathlon/course à pied) :
// nombre de séances/semaine minimum pour toucher les 3 disciplines correctement,
// volume horaire minimum réaliste, et durée de préparation minimum recommandée.
// Ce ne sont pas des limites strictes (chacun est différent) mais des seuils sous
// lesquels la préparation devient statistiquement risquée (blessure/sous-préparation)
// ou irréaliste vu la charge technique/physiologique du format visé.
const TRIATHLON_DIFFICULTY = {
  XS: { minSessions: 3, minHours: 3, minWeeks: 4, label: 'Format découverte (XS)' },
  S: { minSessions: 4, minHours: 4, minWeeks: 6, label: 'Format S (sprint)' },
  M: { minSessions: 5, minHours: 6, minWeeks: 8, label: 'Format M (olympique)' },
  L: { minSessions: 6, minHours: 8, minWeeks: 12, label: 'Format L (half-distance / 70.3)' },
  XL: { minSessions: 7, minHours: 12, minWeeks: 16, label: 'Format XL (Ironman / distance complète)' },
};

const RUNNING_DIFFICULTY = {
  '5km': { minSessions: 3, minHours: 2, minWeeks: 4 },
  '10km': { minSessions: 3, minHours: 3, minWeeks: 6 },
  'Semi-marathon': { minSessions: 4, minHours: 4, minWeeks: 8 },
  Marathon: { minSessions: 5, minHours: 5, minWeeks: 12 },
};

export function checkPlanCoherence(wizardData) {
  const warnings = [];
  if (!wizardData) return warnings;

  const hours = Number(wizardData.hoursPerWeek) || 0;
  const sessions = Number(wizardData.maxSessionsPerWeek) || 0;
  const fitnessLevel = Number(wizardData.fitnessLevel) || 3;

  if (hours > 15) {
    warnings.push('Volume horaire très élevé (>15h), attention au surentraînement.');
  }

  const weeksToRace = wizardData.targetDate
    ? Math.max(0, Math.round((new Date(wizardData.targetDate).getTime() - Date.now()) / (7 * 24 * 3600 * 1000)))
    : null;

  if (wizardData.sportType === 'triathlon') {
    const fmt = wizardData.triathlonFormat;
    const rules = TRIATHLON_DIFFICULTY[fmt];
    if (rules) {
      if (sessions < rules.minSessions) {
        warnings.push(
          `${rules.label} avec seulement ${sessions} séance(s)/semaine : il faut idéalement au moins ${rules.minSessions} séances pour travailler correctement les 3 disciplines (natation, vélo, course) sans négliger l'une d'elles.`
        );
      }
      if (hours > 0 && hours < rules.minHours) {
        warnings.push(
          `${rules.label} : un volume d'au moins ~${rules.minHours}h/semaine est en général nécessaire pour arriver prêt. ${hours}h risque d'être insuffisant.`
        );
      }
      if (weeksToRace !== null && weeksToRace < rules.minWeeks) {
        warnings.push(
          `Il te reste ${weeksToRace} semaine(s) avant l'objectif — une préparation ${rules.label.toLowerCase()} se construit en général sur au moins ${rules.minWeeks} semaines (base + travail spécifique) pour progresser sans te blesser.`
        );
      }
      if ((fmt === 'L' || fmt === 'XL') && fitnessLevel <= 2) {
        warnings.push(
          `Ton niveau de forme actuel (${fitnessLevel}/5) associé à un ${rules.label.toLowerCase()} demande une vigilance particulière : envisage un format inférieur ou une préparation plus longue et progressive pour limiter le risque de blessure.`
        );
      }
    }
  } else if (wizardData.sportType === 'running') {
    if (wizardData.runningSubtype === 'trail') {
      const km = Number(wizardData.trailKm) || 0;
      if (km >= 80 && sessions < 6) {
        warnings.push(`Un ultra-trail de ${km}km demande en général 6 séances/semaine minimum, avec du dénivelé spécifique régulier.`);
      } else if (km >= 42 && sessions < 5) {
        warnings.push(`Un trail de ${km}km demande en général 5 séances/semaine minimum.`);
      } else if (km >= 21 && sessions < 4) {
        warnings.push(`Un trail de ${km}km demande en général 4 séances/semaine minimum.`);
      }
    } else {
      const rules = RUNNING_DIFFICULTY[wizardData.distance];
      if (rules) {
        if (sessions < rules.minSessions) {
          warnings.push(
            `Pour un ${wizardData.distance}, ${rules.minSessions} séances/semaine minimum sont recommandées pour bien répartir endurance, allure spécifique et récupération. Avec ${sessions} séance(s), la préparation sera limitée.`
          );
        }
        if (hours > 0 && hours < rules.minHours) {
          warnings.push(`Pour un ${wizardData.distance}, prévois plutôt ${rules.minHours}h/semaine minimum.`);
        }
        if (weeksToRace !== null && weeksToRace < rules.minWeeks) {
          warnings.push(`Il te reste ${weeksToRace} semaine(s) — une préparation ${wizardData.distance} classique recommande au moins ${rules.minWeeks} semaines.`);
        }
      }
    }
  }

  return warnings;
}
