// lib/periodization.js
//
// PÉRIODISATION — structure MACRO complète de la préparation.
//
// Avant : le plan ne calculait que la phase de la SEMAINE EN COURS (base / développement /
// affûtage) et laissait l'IA "inventer" librement le tableau `trainingPlan.cycles` affiché dans
// l'onglet Objectif — résultat : l'IA ne proposait quasi jamais qu'un seul macrocycle, ce qui
// viole le principe même de la périodisation (une préparation sérieuse s'organise TOUJOURS en
// plusieurs mésocycles enchaînés : base → développement spécifique → [pic/spécifique] → affûtage).
//
// Maintenant : cette découpe est calculée ICI, de façon déterministe (jamais laissée à l'appréciation
// de l'IA), à partir du nombre de semaines réellement disponibles avant l'objectif — exactement le
// même principe de robustesse que `enforceSessionCount` ou `sanitizeWorkout` dans lib/workouts.js :
// l'IA reste libre sur le CONTENU des séances, jamais sur la STRUCTURE macro de la préparation.

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function formatShort(date) {
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function toISODate(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * Découpe le nombre total de semaines disponibles en mésocycles classiques.
 * Renvoie une liste ordonnée de segments { key, label, weeks }.
 */
function segmentWeeks(totalWeeks) {
  if (totalWeeks <= 2) {
    return [{ key: 'taper', label: 'Affûtage final', weeks: totalWeeks }];
  }
  if (totalWeeks <= 4) {
    const taper = totalWeeks <= 3 ? 1 : 2;
    return [
      { key: 'build', label: 'Développement spécifique', weeks: totalWeeks - taper },
      { key: 'taper', label: 'Affûtage', weeks: taper },
    ];
  }
  if (totalWeeks <= 8) {
    const taper = 1;
    const remaining = totalWeeks - taper;
    const base = Math.max(2, Math.round(remaining * 0.5));
    const build = Math.max(1, remaining - base);
    return [
      { key: 'base', label: 'Développement foncier (base)', weeks: base },
      { key: 'build', label: 'Développement spécifique', weeks: build },
      { key: 'taper', label: 'Affûtage', weeks: taper },
    ];
  }
  // Préparation longue (>8 semaines) : 4 mésocycles, le modèle de périodisation
  // linéaire classique (Bompa / ACSM) le plus enseigné en triathlon/course à pied.
  const taper = totalWeeks <= 16 ? 2 : 3;
  const remaining = totalWeeks - taper;
  const base = Math.max(2, Math.round(remaining * 0.45));
  const build = Math.max(2, Math.round(remaining * 0.35));
  const peak = Math.max(1, remaining - base - build);
  return [
    { key: 'base', label: 'Développement foncier (base)', weeks: base },
    { key: 'build', label: 'Développement spécifique', weeks: build },
    { key: 'peak', label: 'Spécifique / pré-compétitif', weeks: peak },
    { key: 'taper', label: 'Affûtage', weeks: taper },
  ];
}

/**
 * Construit la structure macro complète (tous les mésocycles, du jour J jusqu'à l'objectif),
 * avec dates réelles et statut (Terminé / En cours / À venir).
 */
export function buildPeriodizationPlan(targetDateStr, referenceDate = new Date()) {
  const target = new Date(targetDateStr);
  const now = new Date(referenceDate);
  const totalWeeks = Math.max(1, Math.ceil((target.getTime() - now.getTime()) / (7 * 24 * 3600 * 1000)));

  const segments = segmentWeeks(totalWeeks).filter((s) => s.weeks > 0);

  let cursor = new Date(now);
  const phases = segments.map((seg, idx) => {
    const start = new Date(cursor);
    const end = addDays(start, seg.weeks * 7 - 1);
    cursor = addDays(end, 1);
    return {
      id: `phase-${idx + 1}`,
      key: seg.key,
      name: seg.label,
      weeks: seg.weeks,
      startDate: toISODate(start),
      endDate: toISODate(end),
      dates: `${formatShort(start)} → ${formatShort(end)} (${seg.weeks} sem.)`,
      // Seule la première phase (celle qui commence aujourd'hui) est "En cours" au moment
      // de la génération — les suivantes sont "À venir". Un plan régénéré plus tard recalculera
      // naturellement une nouvelle répartition à partir de la nouvelle date du jour.
      status: idx === 0 ? 'En cours' : 'À venir',
    };
  });

  return { totalWeeks, phases, currentPhase: phases[0] };
}

const PHASE_GUIDANCE = {
  base: "Base / développement foncier : volume progressif, dominante endurance fondamentale (Z1-Z2), intensité limitée — on construit les fondations aérobies, techniques et musculo-tendineuses avant d'ajouter de l'intensité.",
  build: "Développement spécifique : volume élevé, part d'intensité et de séances spécifiques à l'objectif en hausse (seuil, sweetspot, allure course) — la surcharge progressive s'accentue.",
  peak: "Spécifique / pré-compétitif : séances à allure/puissance cible de course, simulations d'épreuve, le volume commence à légèrement refluer au profit de la qualité.",
  taper: "Affûtage (taper) : réduction progressive du volume (-20 à -60% selon la proximité de l'objectif), intensité relative maintenue voire légèrement rehaussée sur de courts blocs, priorité absolue à la fraîcheur pour être au sommet le jour J.",
};

export function describePhaseGuidance(phaseKey) {
  return PHASE_GUIDANCE[phaseKey] || PHASE_GUIDANCE.build;
}

/** Formate la structure macro complète pour injection dans le prompt IA. */
export function formatMacrocyclesForPrompt(phases) {
  return phases
    .map((p, idx) => `${idx + 1}. "${p.name}" — ${p.dates} — statut : ${p.status}\n   → ${describePhaseGuidance(p.key)}`)
    .join('\n');
}

/**
 * Convertit les phases calculées dans le format attendu par trainingPlan.cycles (UI).
 * BUG CORRIGÉ : cette fonction ne gardait que {id, name, dates, status} — la description
 * de CHAQUE phase (objectif, filière énergétique visée, ce qui change par rapport à la
 * phase précédente) était déjà calculée par describePhaseGuidance() et injectée dans le
 * prompt IA, mais jamais transmise jusqu'à l'onglet Objectif : l'athlète ne voyait qu'un
 * nom + des dates, sans jamais savoir CE QUI allait réellement se passer dans chaque
 * phase ni POURQUOI. On expose maintenant `guidance` (texte déjà existant, réutilisé tel
 * quel) pour que l'UI puisse l'afficher sous chaque mésocycle.
 */
export function phasesToCycles(phases) {
  return phases.map((p) => ({
    id: p.id,
    key: p.key,
    name: p.name,
    dates: p.dates,
    status: p.status,
    guidance: describePhaseGuidance(p.key),
  }));
}

// Facteur de PROGRESSIVITÉ indicatif par phase : quelle part de l'écart entre le niveau
// ACTUEL (mesuré/estimé, voir lib/physiology.js resolveAthletePhysiology) et le niveau
// CIBLE (déduit de l'objectif visé, voir resolveTargetPhysiology) doit déjà être comblée
// aux séances de CETTE phase. 0 = allures/watts encore au niveau actuel, 1 = déjà au
// niveau cible. Progression volontairement non-linéaire : on ne pousse pas vers la cible
// dès la base (risque de blessure/surcharge), on s'en rapproche surtout en développement
// spécifique et en phase pic, puis on NE dépasse PAS ~90% en affûtage (on consolide la
// fraîcheur pour le jour J, on ne cherche pas de nouveau record à l'entraînement).
const PHASE_PROGRESSION_FACTOR = { base: 0.15, build: 0.55, peak: 0.85, taper: 0.9 };

export function getProgressionFactor(phaseKey) {
  return PHASE_PROGRESSION_FACTOR[phaseKey] ?? PHASE_PROGRESSION_FACTOR.build;
}

/**
 * Interpole une valeur numérique (VMA, vitesse vélo...) entre le niveau actuel et le
 * niveau cible selon le facteur de progression de la phase en cours. Retourne `current`
 * tel quel si l'une des deux valeurs manque (pas de cible connue = pas de progression
 * calculable, on ne peut pas interpoler vers du vide).
 */
export function interpolateTowardTarget(current, target, phaseKey) {
  if (!Number.isFinite(current) || !Number.isFinite(target)) return current ?? null;
  const factor = getProgressionFactor(phaseKey);
  return Math.round((current + (target - current) * factor) * 10) / 10;
}

// Facteur de volume indicatif par phase, appliqué à hoursPerWeek (constraints) pour
// donner un ORDRE DE GRANDEUR du volume des semaines N+2/N+3 — volontairement PAS un
// vrai plan séance par séance (celui-ci reste généré par l'IA, uniquement pour N/N+1).
const PHASE_VOLUME_FACTOR = { base: 0.9, build: 1, peak: 0.95, taper: 0.6 };

/**
 * Aperçu déterministe (sans appel IA) des semaines au-delà de N/N+1, pour "anticiper"
 * sans le coût/la complexité d'une génération IA complète sur 4 semaines : dérivé de
 * la même périodisation déjà utilisée pour trainingPlan.cycles (lib/periodization.js),
 * donc toujours cohérent avec l'onglet Objectif. offsets=[2,3] → semaines N+2 et N+3.
 */
export function getWeeksOutlook(targetDate, constraints, offsets = [2, 3], referenceDate = new Date()) {
  if (!targetDate) return [];
  const { phases } = buildPeriodizationPlan(targetDate, referenceDate);
  if (!phases.length) return [];
  const now = new Date(referenceDate);

  return offsets.map((offset) => {
    const weekStart = addDays(now, offset * 7);
    const iso = toISODate(weekStart);
    const phase = phases.find((p) => iso >= p.startDate && iso <= p.endDate) || phases[phases.length - 1];
    const factor = PHASE_VOLUME_FACTOR[phase.key] ?? 1;
    const baseHours = Number(constraints?.hoursPerWeek) || null;
    return {
      offset,
      label: `N+${offset}`,
      weekStartLabel: formatShort(weekStart),
      phaseName: phase.name,
      phaseKey: phase.key,
      guidance: describePhaseGuidance(phase.key),
      estHoursPerWeek: baseHours ? Math.round(baseHours * factor * 10) / 10 : null,
      sessionsTarget: constraints?.maxSessionsPerWeek || null,
    };
  });
}
