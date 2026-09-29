// lib/sport.js
//
// Types de sport gérés et tests sémantiques. Le code distinguait historiquement
// "running" et "triathlon" avec des tests du type `sportType !== 'running'` qui voulaient
// dire tantôt « a du vélo », tantôt « a de la natation ». Le duathlon (course → vélo →
// course, sans natation) casse cette équivalence : on nomme donc explicitement le sens.

export const SPORT_TYPES = ['running', 'triathlon', 'duathlon'];

export function normalizeSportType(st) {
  return SPORT_TYPES.includes(st) ? st : 'triathlon';
}

export const hasSwim = (st) => st === 'triathlon';
export const hasBike = (st) => st === 'triathlon' || st === 'duathlon';
export const isMultisport = hasBike;

export function sportLabel(st) {
  if (st === 'running') return 'course à pied';
  if (st === 'duathlon') return 'duathlon';
  return 'triathlon';
}

// Distances de référence (km) course 1 / vélo / course 2. Le format S (5 / 20 / 2,5) est le
// plus courant ; XS et M suivent la convention de doublement des formats FFTri — les
// organisateurs adaptent souvent les distances, elles restent modifiables dans l'assistant.
export const DUATHLON_FORMATS = {
  XS: { label: 'XS', run: 2.5, bike: 10, run2: 1.25 },
  S: { label: 'S', run: 5, bike: 20, run2: 2.5 },
  M: { label: 'M', run: 10, bike: 40, run2: 5 },
};

/** Distances { run, bike, run2 } d'un format (sans la clé d'affichage `label`). */
export function duathlonDistances(fmt) {
  const f = DUATHLON_FORMATS[fmt] || DUATHLON_FORMATS.S;
  return { run: f.run, bike: f.bike, run2: f.run2 };
}
