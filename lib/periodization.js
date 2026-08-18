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

/** Convertit les phases calculées dans le format attendu par trainingPlan.cycles (UI). */
export function phasesToCycles(phases) {
  return phases.map((p) => ({ id: p.id, name: p.name, dates: p.dates, status: p.status }));
}
