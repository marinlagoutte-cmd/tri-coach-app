// lib/workouts.js
import { DAYS_OF_WEEK } from './defaults';

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

// BUG CORRIGÉ : le calendrier (CalendarView) affiche une séance dans une colonne
// UNIQUEMENT si `workout.day` correspond exactement (insensible à la casse) à un des
// 7 jours de DAYS_OF_WEEK. Or le coach IA ne renvoie pas toujours ce format exact pour
// une séance ajoutée via le chat (accents/espaces en trop, abréviation "Lun.", jour mal
// orthographié...). Une telle séance était bien ajoutée en mémoire (donc comptée) mais
// n'apparaissait dans AUCUNE colonne du calendrier — elle semblait "disparaître". On
// normalise donc systématiquement `day` vers une valeur canonique de DAYS_OF_WEEK avant
// de l'enregistrer, avec un repli explicite (jamais un jour perdu silencieusement).
function normalizeDayName(day, fallback = DAYS_OF_WEEK[0]) {
  const raw = String(day || '').trim();
  if (!raw) return fallback;
  const strip = (s) => s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // retire les accents
    .toLowerCase();
  const target = strip(raw);
  const exact = DAYS_OF_WEEK.find((d) => strip(d) === target);
  if (exact) return exact;
  // Repli sur les 3 premières lettres (ex: "Lun", "lundi.", "Lun 12/05") : couvre les
  // abréviations et les jours renvoyés avec une date accolée sans dépendre d'un format précis.
  const prefixMatch = DAYS_OF_WEEK.find((d) => target.startsWith(strip(d).slice(0, 3)));
  return prefixMatch || fallback;
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
    const normalizedDay = normalizeDayName(patch.day);

    if (mode === 'add') {
      copy[weekKey].push(sanitizeWorkout({
        id: patch.id || 'w_' + Math.random().toString(36).substring(2, 7),
        day: normalizedDay,
        type: patch.type || 'AUTRE',
        title: patch.title || 'Séance ajoutée',
        duration: patch.duration || '45 min',
        desc: patch.desc || 'Séance ajoutée par le coach.',
        modified: true,
        added: true,
        ...patch,
        day: normalizedDay,
      }, profile));
      return;
    }

    const index = copy[weekKey].findIndex(w => w.id === patch.id || w.day?.toLowerCase() === normalizedDay.toLowerCase());
    if (index !== -1) {
      const previous = { ...copy[weekKey][index] };
      copy[weekKey][index] = sanitizeWorkout({
        ...previous,
        ...patch,
        day: normalizeDayName(patch.day, previous.day),
        previous,
        modified: true,
      }, profile);
    } else {
      copy[weekKey].push(sanitizeWorkout({
        id: patch.id || 'w_' + Math.random().toString(36).substring(2, 7),
        day: normalizedDay,
        type: patch.type || 'AUTRE',
        title: patch.title || 'Séance ajustée',
        duration: patch.duration || '1h00',
        desc: patch.desc || '',
        modified: true,
        ...patch,
        day: normalizedDay,
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
// Catalogue de séances "complémentaires" VARIÉES par discipline — utilisé quand il
// faut ajouter une séance sur un jour double. Le but : ne JAMAIS proposer deux fois
// la même séance sur un même jour (ce qui donnait par ex. "2x le même footing" en
// mono-discipline course à pied) — chaque entrée a un titre, une durée et une
// intensité différents, pour un vrai travail structuré et réparti.
const COMPLEMENTARY_TEMPLATES = {
  'C.A.P': [
    { title: 'Footing récupération', duration: '25 min', desc: 'Footing très souple en Z1, décontraction complète, aucune notion de performance.', cardio: 'Z1', rpe: 'RPE 3/10' },
    { title: 'Footing endurance fondamentale', duration: '45 min', desc: 'Footing continu en endurance fondamentale (Z2), allure conversationnelle.', cardio: 'Z2', rpe: 'RPE 5/10' },
    { title: 'Côtes courtes', duration: '35 min', desc: 'Échauffement 15min + 8x20s en côte forte (récupération en descente) + retour au calme 10min.', cardio: 'Z4', rpe: 'RPE 7/10' },
    { title: 'Technique de course & gainage', duration: '30 min', desc: "Éducatifs de course (montées de genoux, talons-fesses, foulées bondissantes) + circuit gainage.", cardio: 'Z1-Z2', rpe: 'RPE 4/10' },
    { title: 'Fractionné court VMA', duration: '40 min', desc: 'Échauffement 15min + 8x30/30 à VMA (récupération trot 30s) + retour au calme 10min.', cardio: 'Z5', rpe: 'RPE 8/10' },
  ],
  CYCLISME: [
    { title: 'Vélo récupération active', duration: '30 min', desc: 'Rythme très souple en Z1, cadence élevée (>95rpm), zéro friction.', cardio: 'Z1', rpe: 'RPE 3/10' },
    { title: 'Vélo endurance', duration: '1h00', desc: 'Roulage continu en Z2, cadence libre, focus posture aérodynamique.', cardio: 'Z2', rpe: 'RPE 5/10' },
    { title: 'Home trainer — force sous cadence', duration: '40 min', desc: "Échauffement 10min + 6x3min en côte simulée à cadence <65rpm (récupération 2min) + retour au calme.", cardio: 'Z3', rpe: 'RPE 6/10' },
    { title: 'Vélo sweetspot', duration: '50 min', desc: "Échauffement 15min + 2x12min en sweetspot (88-92% FTP, récupération 5min) + retour au calme.", cardio: 'Z3-Z4', rpe: 'RPE 7/10' },
  ],
  NATATION: [
    { title: 'Natation récupération', duration: '25 min', desc: 'Nage continue très souple, focus glisse et respiration, sans notion de vitesse.', cardio: 'Z1', rpe: 'RPE 3/10' },
    { title: 'Natation technique', duration: '35 min', desc: 'Éducatifs (battements, catch-up, doigts traînants) + nage continue en Z2.', cardio: 'Z1-Z2', rpe: 'RPE 4/10' },
    { title: 'Natation allure spécifique', duration: '40 min', desc: 'Échauffement 300m + 10x100m allure spécifique (repos 20s) + retour au calme 200m.', cardio: 'Z3', rpe: 'RPE 6/10' },
  ],
};

/**
 * Construit une nouvelle séance "double" cohérente pour `targetDay` et la discipline
 * `nextType` déjà décidée par l'appelant (voir enforceSessionCount) : choisit un type de
 * séance (récupération / endurance / côtes / technique / fractionné) différent de ceux
 * déjà présents ce jour-là pour cette discipline, jamais un doublon du même contenu.
 */
function buildComplementaryWorkout(targetDay, list, nextType, seed) {
  const sessionsOnDay = list.filter((w) => w.day === targetDay && w.type !== 'REPOS');

  const templates = COMPLEMENTARY_TEMPLATES[nextType] || COMPLEMENTARY_TEMPLATES['C.A.P'];
  const usedTitles = new Set(sessionsOnDay.filter((w) => classifyDiscipline(w.type) === nextType).map((w) => w.title));
  const available = templates.filter((t) => !usedTitles.has(t.title));
  const pool = available.length > 0 ? available : templates;
  const chosen = pool[seed % pool.length];

  return {
    id: `auto-${targetDay}-${Date.now()}-${seed}`,
    day: targetDay,
    type: nextType,
    title: chosen.title,
    duration: chosen.duration,
    cardio: chosen.cardio,
    rpe: chosen.rpe,
    modified: false,
    desc: `${chosen.desc} (séance ajoutée automatiquement pour atteindre le nombre de séances/semaine déclaré au questionnaire — jour double.)`,
  };
}

/**
 * Filet de sécurité final : si — pour n'importe quelle raison, IA comprise — deux
 * séances d'un même jour se retrouvent quasi identiques (même discipline + même
 * titre), on modifie la seconde pour qu'elle ne soit jamais un pur doublon
 * (contenu ET durée différents), plutôt que de laisser deux fois "la même séance"
 * s'afficher dans le calendrier.
 */
export function dedupeIdenticalSameDaySessions(weekWorkouts) {
  const byDay = {};
  const list = weekWorkouts.map((w) => ({ ...w }));
  list.forEach((w) => {
    if (w.type === 'REPOS') return;
    byDay[w.day] = byDay[w.day] || [];
    byDay[w.day].push(w);
  });

  Object.values(byDay).forEach((sessionsOnDay) => {
    const seenPerDiscipline = {};
    sessionsOnDay.forEach((w, idx) => {
      const disc = classifyDiscipline(w.type);
      const key = `${disc}::${(w.title || '').trim().toLowerCase()}`;
      if (!seenPerDiscipline[disc]) seenPerDiscipline[disc] = new Set();
      if (seenPerDiscipline[disc].has(key.split('::')[1])) {
        // Doublon détecté : on remplace par un template complémentaire différent.
        const templates = COMPLEMENTARY_TEMPLATES[disc] || COMPLEMENTARY_TEMPLATES['C.A.P'];
        const usedTitles = new Set(sessionsOnDay.map((s) => (s.title || '').trim().toLowerCase()));
        const alt = templates.find((t) => !usedTitles.has(t.title.toLowerCase())) || templates[(idx + 1) % templates.length];
        w.title = alt.title;
        w.duration = alt.duration;
        w.cardio = alt.cardio;
        w.rpe = alt.rpe;
        w.desc = `${alt.desc} (ajusté automatiquement pour éviter un doublon avec une autre séance du même jour.)`;
      }
      seenPerDiscipline[disc].add((w.title || '').trim().toLowerCase());
    });
  });

  return list;
}

/**
 * Filet de sécurité STRUCTUREL (au-delà du doublon "identique" traité par
 * dedupeIdenticalSameDaySessions ci-dessus) : en triathlon, avoir DEUX séances de la
 * MÊME discipline le même jour (ex: 2x natation), même avec des contenus différents,
 * n'a aucun sens — un jour double doit être un enchaînement de disciplines DIFFÉRENTES
 * (brick : nat+vélo, vélo+course...). On déplace la séance en trop vers un autre jour
 * éligible qui n'a pas encore cette discipline (en priorité le jour le moins chargé),
 * sans jamais toucher aux jours de repos obligatoires ni supprimer de séance. En course
 * à pied mono-discipline, où une seule discipline existe, ce cas est inévitable au-delà
 * d'un certain volume/semaine : on ne touche donc à rien (sportType === 'running').
 */
export function rebalanceSameDisciplineDoubles(weekWorkouts, sportType, offDays) {
  if (sportType === 'running') return weekWorkouts;
  const list = weekWorkouts.map((w) => ({ ...w }));
  const mandatoryOffDays = String(offDays || '').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
  const allDays = [...new Set(list.map((w) => w.day))];

  const disciplineOf = (w) => classifyDiscipline(w.type);
  const sessionsOn = (day) => list.filter((w) => w.day === day && w.type !== 'REPOS');

  let guard = 0;
  while (guard < 30) {
    guard += 1;
    // Cherche un jour avec 2+ séances de la même discipline.
    let offender = null;
    for (const day of allDays) {
      const sessions = sessionsOn(day);
      const byDisc = {};
      sessions.forEach((w) => { byDisc[disciplineOf(w)] = (byDisc[disciplineOf(w)] || []).concat(w); });
      const dup = Object.values(byDisc).find((arr) => arr.length > 1);
      if (dup) { offender = dup[dup.length - 1]; break; } // on déplace la dernière (la plus "en trop")
    }
    if (!offender) break;

    const disc = disciplineOf(offender);
    // Jour d'accueil : éligible (≠ repos obligatoire, ≠ jour d'origine), sans cette
    // discipline aujourd'hui, en priorité le moins chargé.
    const candidates = allDays
      .filter((day) => day !== offender.day)
      .filter((day) => !mandatoryOffDays.includes(String(day).toLowerCase()))
      .filter((day) => !sessionsOn(day).some((w) => disciplineOf(w) === disc))
      .map((day) => ({ day, count: sessionsOn(day).length }))
      .sort((a, b) => a.count - b.count);

    if (candidates.length === 0) break; // aucune destination possible : on laisse tel quel (best effort)

    const destDay = candidates[0].day;
    const restIdx = list.findIndex((w) => w.day === destDay && w.type === 'REPOS');
    const idx = list.findIndex((w) => w.id === offender.id);
    if (idx === -1) break;

    if (restIdx !== -1) {
      // Le jour d'accueil était repos (non obligatoire) : on y déplace directement la séance.
      list[restIdx] = { ...list[idx], day: destDay };
      list.splice(idx, 1);
    } else {
      list[idx] = { ...list[idx], day: destDay };
    }
  }

  return list;
}

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

      // Discipline la moins représentée cette semaine (parmi celles autorisées) — décidée
      // AVANT le jour, pour pouvoir choisir un jour qui ne l'a pas déjà (vrai enchaînement
      // type brick : natation+vélo, vélo+course... jamais 2x la même discipline un même jour,
      // sauf impossibilité totale — seul cas légitime : plan course à pied mono-discipline).
      const nextType = [...disciplineCycle].sort((a, b) => countByDiscipline(a) - countByDiscipline(b))[0];

      // Jour cible : en priorité un jour éligible qui n'a PAS déjà cette discipline
      // aujourd'hui (pour garantir la variété/brick) ; parmi ceux-là, celui qui a
      // actuellement le moins de séances (pour ne pas empiler 3-4 séances sur un seul jour).
      // Si aucun jour éligible n'est libre de cette discipline (seulement possible en
      // mono-discipline, où il n'y a qu'un seul type disponible), on retombe sur le jour
      // ayant le moins de séances tout court.
      const daysWithoutDiscipline = eligibleDays.filter(
        (day) => !list.some((w) => w.day === day && w.type !== 'REPOS' && classifyDiscipline(w.type) === nextType)
      );
      const pool = daysWithoutDiscipline.length > 0 ? daysWithoutDiscipline : eligibleDays;

      const sessionsPerDay = pool.map((day) => ({
        day,
        count: list.filter((w) => w.day === day && w.type !== 'REPOS').length,
      }));
      sessionsPerDay.sort((a, b) => a.count - b.count);
      const targetDay = sessionsPerDay[0]?.day;
      if (!targetDay) break;

      const restIdx = list.findIndex((w) => w.day === targetDay && w.type === 'REPOS');
      const newWorkout = buildComplementaryWorkout(targetDay, list, nextType, guard);

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

  // Filet de sécurité final, quelle que soit la branche exécutée ci-dessus (et même
  // si aucune correction de quota n'a été nécessaire) : jamais deux séances de la même
  // discipline (rebalance) ni deux séances identiques (dedupe) sur le même jour.
  const rebalanced = rebalanceSameDisciplineDoubles(list, sportType, offDays);
  return dedupeIdenticalSameDaySessions(rebalanced).map((w) => sanitizeWorkout(w, profile));
}

// BUG CORRIGÉ : l'ancienne implémentation cherchait un motif "chiffres + m" totalement
// indépendant du motif "chiffres + h", donc un format ultra-courant dans l'app comme
// "1h30" (sans le mot "min" ni un "m" isolé) ne matchait JAMAIS le second regex — les
// minutes étaient silencieusement remises à 0 (ex: "2h45" -> 120min au lieu de 165min,
// "1h20" -> 60min au lieu de 80min). Sur une semaine complète, cette perte se cumule sur
// toutes les séances formatées "XhYY" et rend le volume affiché (graphe "Volume prévu"
// de l'onglet Profil, sortie longue de 21km, etc.) nettement sous-estimé et incohérent.
// On capture maintenant les minutes DANS LA MÊME EXPRESSION que les heures (juste après
// le "h"), qu'elles soient suivies ou non de "m"/"min" — et seulement une valeur "m"/"min"
// isolée (sans "h" avant) est traitée comme des minutes pures.
export function parseDurationMinutes(duration) {
  const str = String(duration || '').trim();
  if (!str) return 0;

  const hAndM = str.match(/(\d+(?:[.,]\d+)?)\s*h\s*(\d{1,2})?/i);
  if (hAndM) {
    const hours = Number(String(hAndM[1]).replace(',', '.')) || 0;
    const mins = hAndM[2] ? Number(hAndM[2]) : 0;
    return Math.round(hours * 60 + mins);
  }

  const minOnly = str.match(/(\d+(?:[.,]\d+)?)\s*(?:min|m)\b/i);
  if (minOnly) return Math.round(Number(String(minOnly[1]).replace(',', '.')) || 0);

  return Number(str.replace(',', '.')) || 0;
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

// --- GARDE-FOU DÉTERMINISTE : PROGRESSIVITÉ POUR UN NIVEAU DE FORME FAIBLE ---
// Même principe que enforceSessionCount / phasesToCycles : le prompt IA demande déjà
// (lib/gemini.js -> describeFitnessAdaptation) une charge très prudente pour un niveau
// débutant/novice (fitnessLevel <= 2), mais on ne peut pas dépendre uniquement de
// l'obéissance du modèle — un débutant niveau 2/5 qui reçoit une séance de seuil
// 3x10min et une sortie longue de 2h dès la phase de base est un vrai risque de
// blessure/décrochage. On corrige donc ICI, de façon déterministe, les séances qui
// dépassent des bornes de durée raisonnables pour ce profil, en phase base/développement
// (jamais en phase "peak"/"taper" où l'intensité proche de l'objectif est normale).
const BEGINNER_DURATION_CAPS_MIN = {
  'C.A.P': { hard: 40, long: 75 }, // séance à haute intensité (Z4/Z5/seuil) / sortie longue
  CYCLISME: { hard: 50, long: 120 },
  NATATION: { hard: 40, long: 60 },
};

// Rang numérique de l'expérience d'entraînement déclarée au questionnaire (axe distinct de la
// forme physique du moment — voir describeAthleteAdaptation dans lib/gemini.js pour le détail du
// raisonnement). Une expérience non reconnue est traitée comme "intermédiaire" par défaut.
const EXPERIENCE_RANK = { debutant: 1, novice: 2, intermediaire: 3, confirme: 4, expert: 5 };

export function isHardSession(workout) {
  // GARDE-FOU CASCADE : une séance déjà allégée par un garde-fou précédent (enforceBeginnerProgression,
  // enforceDoubleThresholdEligibility, enforceTaperVolume, applyFatigueAutoRegulation...) porte
  // TOUJOURS le suffixe "(allégée)" dans son titre (voir ces fonctions) — sans ce court-circuit, le
  // titre/desc d'origine ("Séance de seuil...") continuerait de matcher les mots-clés ci-dessous même
  // après avoir été rebasculée en endurance fondamentale (cardio Z2), ce qui ferait ré-alléger la même
  // séance en boucle par plusieurs garde-fous successifs (empilement de notes redondantes dans desc) et
  // fausserait enforceNoConsecutiveHardDays (une séance déjà easy resterait comptée "difficile").
  if (/\(allégée\)/i.test(workout.title || '')) return false;
  const cardio = String(workout.cardio || workout.effortZone || '').toUpperCase();
  const label = `${workout.title || ''} ${workout.desc || ''}`.toLowerCase();
  return /Z4|Z5/.test(cardio) || /seuil|vma|sweetspot|fractionn/i.test(label);
}

function isLongSession(workout) {
  const label = `${workout.title || ''}`.toLowerCase();
  return /longue|long\b/.test(label);
}

// --- GARDE-FOUS DÉTERMINISTES SUPPLÉMENTAIRES (physiologie de l'entraînement) ---
// Même logique que enforceBeginnerProgression ci-dessus : les règles d'expert injectées dans le
// prompt (lib/gemini.js -> buildEnduranceExpertRules) donnent le cadre à l'IA, mais rien ne
// garantit qu'elle les respecte à 100%. Ces fonctions vérifient/corrigent le JSON généré, APRÈS
// coup, de façon fiable — indépendamment de l'obéissance du modèle.

/**
 * Aucune séance difficile (Z4/Z5, seuil, VMA...) ne doit suivre directement une autre séance
 * difficile de la veille — principe de récupération entre séances à haute intensité. Opère sur
 * les 14 jours (N puis N+1) dans l'ordre chronologique, y compris à la frontière dimanche N /
 * lundi N+1, pour ne pas laisser passer un enchaînement à cheval sur les deux semaines.
 */
export function enforceNoConsecutiveHardDays(weekN, weekNPlus1) {
  const seq = [...(weekN || []), ...(weekNPlus1 || [])];
  for (let i = 1; i < seq.length; i += 1) {
    const prev = seq[i - 1];
    if (prev.type === 'REPOS' || seq[i].type === 'REPOS') continue;
    if (isHardSession(prev) && isHardSession(seq[i])) {
      seq[i] = {
        ...seq[i],
        title: `${seq[i].title} (allégée)`,
        intensity: 'Endurance fondamentale (allégé automatiquement)',
        effortZone: 'Z2',
        cardio: 'Z2',
        modified: true,
        desc: `${seq[i].desc || ''} (Intensité réduite automatiquement : deux séances difficiles consécutives détectées, récupération nécessaire entre deux séances à haute intensité.)`.trim(),
      };
    }
  }
  const nLen = (weekN || []).length;
  return { N: seq.slice(0, nLen), 'N+1': seq.slice(nLen) };
}

/**
 * Un double seuil (2 séances de qualité seuil/intensité la même journée) n'est physiologiquement
 * pertinent que pour un profil confirmé avec un volume suffisant pour l'absorber (voir
 * buildEnduranceExpertRules). Si l'IA en propose un hors de ces critères, on allège la seconde
 * séance difficile du jour concerné.
 */
export function enforceDoubleThresholdEligibility(weekWorkouts, fitnessLevel, hoursPerWeek, trainingExperience) {
  const expRank = EXPERIENCE_RANK[trainingExperience] || 3;
  const eligible = (Number(fitnessLevel) || 3) >= 4 && expRank >= 4 && Number(hoursPerWeek) >= 8;
  if (eligible || !Array.isArray(weekWorkouts)) return weekWorkouts;
  const byDay = {};
  weekWorkouts.forEach((w) => { (byDay[w.day] = byDay[w.day] || []).push(w); });
  const secondHardIds = new Set();
  Object.values(byDay).forEach((dayList) => {
    const hard = dayList.filter((w) => w.type !== 'REPOS' && isHardSession(w));
    if (hard.length >= 2) secondHardIds.add(hard[1].id);
  });
  if (secondHardIds.size === 0) return weekWorkouts;
  return weekWorkouts.map((w) => (secondHardIds.has(w.id) ? {
    ...w,
    title: `${w.title} (allégée)`,
    intensity: 'Endurance fondamentale (allégé automatiquement)',
    effortZone: 'Z2',
    cardio: 'Z2',
    modified: true,
    desc: `${w.desc || ''} (Double séance de seuil réservée aux profils confirmés avec volume suffisant : intensité réduite automatiquement pour ce profil.)`.trim(),
  } : w));
}

/**
 * En phase d'affûtage, le volume doit chuter nettement (40-60%) tout en gardant quelques touches
 * d'intensité courtes — jamais forcé côté prompt seul. On réduit ici, de façon déterministe, la
 * durée des séances (hors REPOS et hors séances déjà courtes ≤25min, pour ne jamais supprimer les
 * touches d'intensité) jusqu'à viser ~50% du volume hebdo déclaré.
 */
export function enforceTaperVolume(weekWorkouts, phaseKey, hoursPerWeek) {
  if (phaseKey !== 'taper' || !Array.isArray(weekWorkouts) || !hoursPerWeek) return weekWorkouts;
  const targetMin = Number(hoursPerWeek) * 60 * 0.5;
  const totalMin = weekWorkouts.reduce((s, w) => s + (w.type !== 'REPOS' ? parseDurationMinutes(w.duration) : 0), 0);
  if (!totalMin || totalMin <= targetMin) return weekWorkouts;
  const ratio = targetMin / totalMin;
  return weekWorkouts.map((w) => {
    if (w.type === 'REPOS') return w;
    const currentMin = parseDurationMinutes(w.duration);
    if (currentMin <= 25) return w;
    const newMin = Math.max(20, Math.round(currentMin * ratio));
    if (newMin >= currentMin) return w;
    const h = Math.floor(newMin / 60);
    const m = newMin % 60;
    return {
      ...w,
      duration: h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m} min`,
      modified: true,
      desc: `${w.desc || ''} (Volume réduit automatiquement : phase d'affûtage, intensité conservée.)`.trim(),
    };
  });
}

/**
 * Filet de sécurité "signal de fatigue" : si la tendance de ressenti récente indique que
 * l'athlète trouve ses séances plus dures que prévu (voir summarizeFeedbackTrend), on ne
 * dépend pas uniquement du prompt — on allège directement la séance difficile la moins
 * structurante de la semaine s'il y en a plus d'une.
 */
export function applyFatigueAutoRegulation(weekWorkouts, trendDirection) {
  if (trendDirection !== 'harder' || !Array.isArray(weekWorkouts)) return weekWorkouts;
  const hard = weekWorkouts.filter((w) => w.type !== 'REPOS' && isHardSession(w));
  if (hard.length <= 1) return weekWorkouts;
  const toEase = [...hard].sort((a, b) => parseDurationMinutes(a.duration) - parseDurationMinutes(b.duration))[0];
  return weekWorkouts.map((w) => (w.id === toEase.id ? {
    ...w,
    title: `${w.title} (allégée)`,
    intensity: 'Endurance fondamentale (allégé automatiquement)',
    effortZone: 'Z2',
    cardio: 'Z2',
    modified: true,
    desc: `${w.desc || ''} (Intensité réduite automatiquement : ressenti récent plus dur que prévu, vigilance surcharge.)`.trim(),
  } : w));
}

// --- AVERTISSEMENTS (non bloquants, non corrigés automatiquement) ---
// Ces vérifications signalent un risque plausible sans modifier le plan : une correction
// automatique serait ici trop hasardeuse (ex: redécouper un volume horaire au hasard), mieux
// vaut remonter l'info que l'IA/l'utilisateur pourra objectiver.

export function checkWeeklyVolumeWarning(weekWorkouts, hoursPerWeek, weekLabel) {
  if (!Array.isArray(weekWorkouts) || !hoursPerWeek) return null;
  const totalMin = weekWorkouts.reduce((s, w) => s + (w.type !== 'REPOS' ? parseDurationMinutes(w.duration) : 0), 0);
  const targetMin = Number(hoursPerWeek) * 60;
  if (!targetMin) return null;
  const deltaPct = ((totalMin - targetMin) / targetMin) * 100;
  if (Math.abs(deltaPct) > 15) {
    return `Semaine ${weekLabel} : volume généré (~${Math.round((totalMin / 60) * 10) / 10}h) s'écarte de plus de 15% des ${hoursPerWeek}h déclarées (${deltaPct > 0 ? '+' : ''}${Math.round(deltaPct)}%).`;
  }
  return null;
}

export function checkWeekSimilarityWarning(weekN, weekNPlus1) {
  const signature = (week) => (week || [])
    .map((w) => `${w.type}:${Math.round(parseDurationMinutes(w.duration) / 15) * 15}:${(w.intensity || '').slice(0, 6)}`)
    .join('|');
  const sigN = signature(weekN);
  const sigN1 = signature(weekNPlus1);
  if (sigN && sigN === sigN1) {
    return "Les semaines N et N+1 semblent quasi identiques (mêmes types/durées/intensités) : pas de réelle progression ni variation détectée entre les deux semaines.";
  }
  return null;
}

function sessionLoad(w) {
  if (w.type === 'REPOS') return 0;
  const durMin = parseDurationMinutes(w.duration) || 30;
  let factor = isHardSession(w) ? 1.5 : 0.8;
  if (isLongSession(w)) factor += 0.3;
  return Math.round(durMin * factor);
}

/**
 * Monotonie d'entraînement (indice de Foster : charge moyenne / écart-type des charges
 * journalières). Une monotonie élevée (jours quasi tous identiques en charge) est associée à un
 * risque accru de surcharge/blessure même quand le volume total semble raisonnable.
 */
export function checkMonotonyWarning(weekWorkouts, weekLabel) {
  if (!Array.isArray(weekWorkouts) || weekWorkouts.length < 5) return null;
  const loads = weekWorkouts.map(sessionLoad);
  const mean = loads.reduce((a, b) => a + b, 0) / loads.length;
  if (mean === 0) return null;
  const variance = loads.reduce((s, v) => s + (v - mean) ** 2, 0) / loads.length;
  const stddev = Math.sqrt(variance);
  const monotony = stddev === 0 ? mean : mean / stddev;
  if (monotony > 2.5) {
    return `Semaine ${weekLabel} : charge d'entraînement peu variée entre les jours (monotonie élevée) — plus de contraste entre séances faciles et difficiles limiterait le risque de surcharge (indice de Foster).`;
  }
  return null;
}

function intensityBucket(w) {
  // Même garde-fou cascade que isHardSession ci-dessus : une séance déjà allégée reste classée
  // "low" même si son titre d'origine contenait un mot-clé d'intensité (le cardio a réellement
  // été rebasculé en Z2 par le garde-fou qui l'a allégée).
  if (/\(allégée\)/i.test(w.title || '')) return 'low';
  const cardio = String(w.cardio || w.effortZone || '').toUpperCase();
  const label = `${w.title || ''} ${w.desc || ''}`.toLowerCase();
  if (/Z3|Z4|Z5|Z6/.test(cardio) || /seuil|vma|sweetspot|fractionn|tempo/i.test(label)) return 'high';
  return 'low';
}

/**
 * Vérifie le VRAI ratio 80/20 (endurance fondamentale vs intensité Z3+) sur le plan réellement
 * généré, pondéré par la durée de chaque séance — le prompt le demande déjà à l'IA (voir
 * buildWorkoutSchema), mais comme pour le volume total, rien ne garantissait jusqu'ici que le
 * JSON reçu le respecte vraiment. Volontairement asymétrique : on n'alerte que sur un EXCÈS
 * d'intensité (risque de surcharge), jamais sur un déficit (rester trop en endurance fondamentale
 * n'est jamais dangereux, seulement sous-optimal).
 */
export function checkPolarizationWarning(weekWorkouts, weekLabel) {
  if (!Array.isArray(weekWorkouts)) return null;
  const training = weekWorkouts.filter((w) => w.type !== 'REPOS');
  const totalMin = training.reduce((s, w) => s + parseDurationMinutes(w.duration), 0);
  if (!totalMin) return null;
  const highMin = training
    .filter((w) => intensityBucket(w) === 'high')
    .reduce((s, w) => s + parseDurationMinutes(w.duration), 0);
  const highPct = (highMin / totalMin) * 100;
  if (highPct > 35) {
    return `Semaine ${weekLabel} : part d'intensité (Z3+) trop élevée (~${Math.round(highPct)}% du volume) — le principe 80/20 recommande de garder l'essentiel du volume en endurance fondamentale, même en phase avancée de la préparation.`;
  }
  return null;
}

// --- GARDE-FOU DÉTERMINISTE : COHÉRENCE DU DÉNIVELÉ (D+) EN TRAIL ---
// Même logique que checkPolarizationWarning ci-dessus : le prompt demande déjà (voir
// buildEnduranceExpertRules -> trailBlock dans lib/gemini.js) une sortie longue avec un dénivelé
// cohérent avec l'objectif et jamais deux sorties à fort D+ consécutives, mais rien ne garantit
// que l'IA respecte ces deux invariants dans le JSON réellement généré. Aucun champ structuré
// dédié au dénivelé n'existe dans le schéma des séances : on l'extrait donc du titre/desc par
// regex, comme le fait déjà checkZoneRangeWarnings pour la FC. Non bloquant et non corrigé
// automatiquement (au même titre que checkPolarizationWarning) : une correction à l'aveugle du
// dénivelé texte serait trop hasardeuse, mieux vaut remonter l'info à l'utilisateur/l'IA.
function extractElevationM(workout) {
  const label = `${workout?.title || ''} ${workout?.desc || ''}`;
  // Le nombre peut se trouver avant OU après le marqueur ("600m D+" comme "D+ 600m" ou "D+600m"),
  // et le marqueur textuel peut être "D+" ou "dénivelé" (positif) — on essaie les 4 ordres possibles
  // et on garde la première correspondance valide.
  const patterns = [
    /(\d{2,5})\s*m?\s*(?:de\s*)?d\s*\+/i,
    /(\d{2,5})\s*m?\s*(?:de\s*)?d[ée]nivel[ée]\w*/i,
    /d\s*\+\s*:?\s*(\d{2,5})\s*m?/i,
    /d[ée]nivel[ée]\w*\s*(?:positif\s*)?:?\s*(\d{2,5})\s*m?/i,
  ];
  for (const re of patterns) {
    const m = label.match(re);
    if (m && Number(m[1])) return Number(m[1]);
  }
  return 0;
}

/**
 * TRAIL uniquement (sportType 'running' + runningSubtype 'trail') : vérifie sur les deux semaines
 * assemblées (comme enforceNoConsecutiveHardDays, pour ne pas laisser passer un enchaînement à
 * cheval sur la frontière dimanche N / lundi N+1) que :
 * 1. Au moins une séance des deux semaines porte un dénivelé (D+) chiffré — une préparation trail
 *    sans aucun D+ mentionné ne prépare pas au dénivelé cumulé réel de la course.
 * 2. Deux sorties à fort dénivelé (seuil arbitraire mais raisonnable : ≥400m D+, pour ne pas
 *    déclencher sur une simple sortie vallonnée) ne s'enchaînent jamais sur deux jours consécutifs
 *    (récupération musculaire excentrique, spécifique à la descente, nécessaire entre deux sorties
 *    à fort D+).
 */
export function checkTrailElevationWarning(weekN, weekNPlus1, sportType, runningSubtype) {
  if (sportType !== 'running' || runningSubtype !== 'trail') return null;
  if (!Array.isArray(weekN) || !Array.isArray(weekNPlus1)) return null;

  const seq = [...weekN, ...weekNPlus1];
  const training = seq.filter((w) => w.type !== 'REPOS');
  if (training.length === 0) return null;

  const elevations = seq.map(extractElevationM);
  const hasAnyElevation = elevations.some((e) => e > 0);
  if (!hasAnyElevation) {
    return "Trail : aucune séance des semaines N/N+1 ne mentionne de dénivelé (D+) chiffré — une préparation trail devrait intégrer au moins une sortie avec un dénivelé cumulé cohérent avec l'objectif de course (D+/D- déclarés au questionnaire).";
  }

  const SIGNIFICANT_ELEVATION_M = 400;
  for (let i = 1; i < seq.length; i += 1) {
    const prev = seq[i - 1];
    const cur = seq[i];
    if (prev.type === 'REPOS' || cur.type === 'REPOS') continue;
    if (elevations[i - 1] >= SIGNIFICANT_ELEVATION_M && elevations[i] >= SIGNIFICANT_ELEVATION_M) {
      return `Trail : deux sorties à fort dénivelé (≥${SIGNIFICANT_ELEVATION_M}m D+ chacune) s'enchaînent sur deux jours consécutifs (${prev.day || '?'} → ${cur.day || '?'}) — la récupération musculaire spécifique à la descente (travail excentrique) recommande d'espacer ces sorties.`;
    }
  }
  return null;
}

/**
 * Plafonne la durée des séances trop exigeantes pour un athlète débutant/novice
 * (fitnessLevel déclaré <= 2) en phase base/développement. Ne touche JAMAIS aux
 * séances déjà dans des bornes raisonnables, ni aux niveaux >= 3, ni aux phases
 * peak/taper (où une charge plus proche de l'objectif est normale et attendue).
 */
/**
 * Plafonne la durée des séances trop exigeantes pour un profil peu progressif — déclenché si la
 * FORME actuelle est faible (fitnessLevel <=2) OU si l'EXPÉRIENCE d'entraînement est faible
 * (trainingExperience débutant/novice), la plus prudente des deux règles prime (voir
 * describeAthleteAdaptation dans lib/gemini.js). Ne touche JAMAIS aux séances déjà dans des
 * bornes raisonnables, ni aux profils confirmés, ni aux phases peak/taper (où une charge plus
 * proche de l'objectif est normale et attendue).
 */
export function enforceBeginnerProgression(weekWorkouts, fitnessLevel, phaseKey, trainingExperience) {
  const level = Number(fitnessLevel) || 3;
  const expRank = EXPERIENCE_RANK[trainingExperience] || 3;
  if (level > 2 && expRank > 2) return weekWorkouts;
  if (!Array.isArray(weekWorkouts)) return weekWorkouts;
  if (phaseKey === 'peak' || phaseKey === 'taper') return weekWorkouts;

  return weekWorkouts.map((w) => {
    const discipline = classifyDiscipline(w.type);
    const caps = BEGINNER_DURATION_CAPS_MIN[discipline];
    if (!caps) return w;

    const currentMin = parseDurationMinutes(w.duration);
    let capMin = null;
    if (isHardSession(w) && currentMin > caps.hard) capMin = caps.hard;
    else if (isLongSession(w) && currentMin > caps.long) capMin = caps.long;
    if (capMin === null) return w;

    const h = Math.floor(capMin / 60);
    const m = capMin % 60;
    const newDuration = h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m} min`;
    return {
      ...w,
      duration: newDuration,
      modified: true,
      desc: `${w.desc || ''}${w.desc ? ' ' : ''}(Durée réduite automatiquement : forme ${level}/5 et/ou expérience d'entraînement limitée, progressivité de la phase "${phaseKey}" respectée.)`.trim(),
    };
  });
}
