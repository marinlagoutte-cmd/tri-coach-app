// lib/swimPlanning.js
//
// NATATION : volume réaliste, densité des séances, séance longue.
//
// Constat (plan réel, triathlète expert en format S, 20 h/semaine) : 4 natations de 1500 à
// 2600 m, 8,3 km dans la semaine, dont 3 séances « technique » légères (1500 m en 45 min).
// Trois causes dans l'app : la consigne invitait à faire court les séances technique, le
// plancher de volume ignorait les séances « technique/allégée », et le contrôle
// distance/durée tolérait une densité très faible.
//
// Repères utilisés (voir REVUE_IA_2026-09.md) :
//   - triathlète de classe mondiale (préparation olympique) : ~25 km/semaine, ~6 séances,
//     répartition d'intensité ~74 % sous le seuil, ~16 % au seuil, ~10 % au-dessus ;
//   - amateurs de niveau intermédiaire : 8-12 km/semaine en 3-4 séances de 2-3 km et plus ;
//   - séances club d'une heure « tout compris » : ~2,4-2,5 km, dense et structurée.
// D'où : une séance doit être DENSE pour sa durée (plutôt qu'un chiffre fixe, pour respecter
// les créneaux d'une heure), le volume HEBDOMADAIRE suit le niveau et les heures, et une
// séance LONGUE (> 4 km) est prévue chez les confirmés/experts en base/développement.
// Ces valeurs sont des repères d'entraînement, pas des résultats d'étude : regroupés ici pour
// être ajustés.

const EXPERIENCE_RANK = { debutant: 1, novice: 2, intermediaire: 3, confirme: 4, expert: 5 };

// Allure CSS par défaut (min/100 m) si la CSS n'est pas connue.
const DEFAULT_CSS_MIN = { debutant: 2.5, novice: 2.25, intermediaire: 2.0, confirme: 1.75, expert: 1.6 };

// Volume hebdomadaire de référence à ~15 h/semaine (m), par format et niveau.
const WEEKLY_REF = {
  XS: { debutant: 3500, novice: 4200, intermediaire: 6000, confirme: 7500, expert: 9000 },
  S: { debutant: 4000, novice: 5000, intermediaire: 7000, confirme: 9000, expert: 11000 },
  M: { debutant: 4500, novice: 5500, intermediaire: 8000, confirme: 10000, expert: 12000 },
  // L / XL : pas plus que le M — sur longue distance la natation pèse moins dans le temps de
  // course ; le surplus d'heures va au vélo et à la course.
  L: { debutant: 4500, novice: 5500, intermediaire: 8000, confirme: 10000, expert: 12000 },
  XL: { debutant: 4500, novice: 5500, intermediaire: 8000, confirme: 10000, expert: 12000 },
};

// Rapport durée totale / temps de nage à la CSS (échauffement plus lent, récupérations,
// éducatifs) : même facteur que le contrôle du validateur.
const DURATION_FACTOR = 1.25;
export const MIN_DENSITY = 0.85;

export function cssMinutes(nat100) {
  const m = String(nat100 || '').match(/(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) + Number(m[2]) / 60 : null;
}

export function swimPaceMinutes(nat100, trainingExperience) {
  return cssMinutes(nat100) || DEFAULT_CSS_MIN[trainingExperience] || DEFAULT_CSS_MIN.intermediaire;
}

/** Distance réaliste (m, arrondie à 50) pour une séance de `durationMin`, tout compris. */
export function realisticSwimMeters(durationMin, cssMin) {
  if (!durationMin || !cssMin) return null;
  return Math.round(((durationMin / (cssMin * DURATION_FACTOR)) * 100) / 50) * 50;
}

/** Durée (min, arrondie à 5) nécessaire pour nager `meters`, tout compris. */
export function minutesForSwimMeters(meters, cssMin) {
  return Math.round(((meters / 100) * cssMin * DURATION_FACTOR) / 5) * 5;
}

/**
 * Volume natation cible de la semaine (m) : niveau × format, mis à l'échelle des heures
 * (0,5 à 1,3 × la référence à 15 h) et de la nature de la semaine (weekHours / hoursPerWeek).
 */
export function weeklySwimTarget(wizardData = {}, weekHours = null) {
  const table = WEEKLY_REF[wizardData.triathlonFormat] || WEEKLY_REF.M;
  const ref = table[wizardData.trainingExperience] || table.intermediaire;
  const hours = Number(wizardData.hoursPerWeek) || 10;
  const scale = Math.min(1.3, Math.max(0.5, hours / 15));
  const weekFactor = weekHours && hours ? Math.min(1.1, weekHours / hours) : 1;
  return Math.round((ref * scale * weekFactor) / 100) * 100;
}

/** Séance longue attendue (m) ou null : confirmés/experts, semaine de charge ou normale en base/développement. */
export function longSwimTarget(wizardData = {}, weekCtx = null, weeklyTarget = null) {
  const rank = EXPERIENCE_RANK[wizardData.trainingExperience] || 3;
  if (rank < 4 || (Number(wizardData.hoursPerWeek) || 0) < 10) return null;
  if (weekCtx && (!['charge', 'normal'].includes(weekCtx.kind) || !['base', 'build'].includes(weekCtx.phaseKey))) return null;
  const target = Math.max(4000, Math.round(((weeklyTarget || 12000) * 0.28) / 100) * 100);
  return Math.min(5000, target);
}

export function isRecoveryOrTestSwim(w) {
  return /récup|recup|recovery|souple|test|allégée|allegee/i.test(`${w?.title || ''}`);
}
