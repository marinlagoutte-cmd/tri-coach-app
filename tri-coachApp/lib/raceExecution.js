// lib/raceExecution.js
//
// Point 4 — Plan d'exécution course (façon RaceX de TriDot) : un vrai plan de course
// jour J, du départ à l'arrivée, avec allures/vitesses cibles et minutage par segment —
// distinct du plan d'ENTRAÎNEMENT (semaines N/N+1) déjà généré ailleurs dans l'app.
//
// RÈGLE ABSOLUE (même doctrine que lib/physiology.js — voir son en-tête) : ne JAMAIS
// inventer une valeur physiologique ici. Toutes les allures/vitesses cibles viennent de
// profile.targetPhysio (resolveTargetPhysiology, déjà calculé et déjà affiché ailleurs
// dans l'onglet Objectif) — jamais recalculées différemment. Ce qui manque reste
// explicitement "non disponible" plutôt qu'une estimation masquée en silence.
//
// Le minutage de chaque segment est LITTÉRAL : les temps déclarés par l'athlète au
// questionnaire (constraints.triathlonTimes / constraints.targetTime) — jamais un temps
// recalculé/estimé différemment de ce que l'athlète a lui-même visé.

import { parseAppDuration, classifyTier, getCarbRange, getFluidRange, getSodiumRange } from './nutritionData';
import { vmaPercentForDistance } from './physiology';

const RUNNING_DISTANCE_KM = { '5km': 5, '10km': 10, 'Semi-marathon': 21.0975, Marathon: 42.195 };

function fmtClock(totalMin) {
  if (!Number.isFinite(totalMin) || totalMin < 0) return '—';
  const h = Math.floor(totalMin / 60);
  const m = Math.round(totalMin % 60);
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m}min`;
}

function paceMinPerKmToStr(paceMin) {
  if (!Number.isFinite(paceMin) || paceMin <= 0) return null;
  const m = Math.floor(paceMin);
  const s = Math.round((paceMin - m) * 60);
  return `${m}:${String(s).padStart(2, '0')} /km`;
}

/**
 * Repère nutrition d'un segment, réutilisant EXACTEMENT les mêmes fonctions/seuils que
 * l'onglet Nutrition (lib/nutritionData.js) — pour que les chiffres affichés ici et là-bas
 * ne divergent jamais. Segment trop court (<20min) : pas de vraie stratégie nutrition à
 * établir, on renvoie null plutôt qu'un repère qui n'a pas de sens sur si peu de temps.
 */
function nutritionHint(durationMin, heat = 'mild') {
  if (!durationMin || durationMin < 20) return null;
  const tier = classifyTier(durationMin);
  const carb = getCarbRange(tier);
  const fluid = getFluidRange(heat);
  const sodium = getSodiumRange(tier, heat);
  return {
    tier,
    carbText: carb.max > 0 ? `${carb.min}-${carb.max}g glucides/h${carb.note ? ` (${carb.note})` : ''}` : 'pas de glucides nécessaires sur ce segment',
    fluidText: `${fluid.min}-${fluid.max}ml/h`,
    sodiumText: durationMin >= 60 ? `${sodium.min}-${sodium.max}mg sodium/h` : null,
  };
}

/**
 * Construit le plan d'exécution TRIATHLON — un segment par discipline + transitions,
 * dans l'ordre de course.
 */
export function buildTriathlonExecutionPlan({ constraints, profile, heat = 'mild' }) {
  const times = constraints?.triathlonTimes || {};
  const targetPhysio = profile?.targetPhysio || {};

  const swimMin = parseAppDuration(times.swim);
  const t1Min = parseAppDuration(times.transition_t1);
  const bikeMin = parseAppDuration(times.bike);
  const t2Min = parseAppDuration(times.transition_t2);
  const runMin = parseAppDuration(times.run);
  const totalMin = parseAppDuration(times.total)
    ?? [swimMin, t1Min, bikeMin, t2Min, runMin].reduce((s, v) => s + (v || 0), 0);

  if (!swimMin && !bikeMin && !runMin) return null; // rien de déclaré au questionnaire

  let elapsed = 0;
  const segments = [];
  const pushSegment = (seg) => {
    if (!seg.durationMin) return; // segment non déclaré (ex: pas de temps de transition saisi)
    const startAt = elapsed;
    elapsed += seg.durationMin;
    segments.push({ ...seg, startAtLabel: fmtClock(startAt), endAtLabel: fmtClock(elapsed) });
  };

  pushSegment({
    key: 'swim',
    icon: '🏊',
    label: 'Natation',
    durationMin: swimMin,
    target: targetPhysio.targetSwimPace100 ? `${targetPhysio.targetSwimPace100} /100m` : null,
    targetSource: targetPhysio.targetSwimPace100 ? targetPhysio.targetSwimPaceSource : 'non disponible — temps visé natation non renseigné au questionnaire',
    strategy: "Départ maîtrisé (pas de sprint dans le pack), respiration bilatérale régulière, vise les bouées en ligne directe.",
    nutrition: null, // jamais de prise alimentaire pendant le segment natation
  });

  pushSegment({
    key: 't1',
    icon: '🔄',
    label: 'Transition 1 (T1)',
    durationMin: t1Min,
    target: null,
    targetSource: null,
    strategy: "Enchaîne les gestes dans l'ordre répété à l'entraînement — la vitesse vient de l'automatisme, pas de la précipitation.",
    nutrition: null,
  });

  pushSegment({
    key: 'bike',
    icon: '🚴',
    label: 'Vélo',
    durationMin: bikeMin,
    target: targetPhysio.targetBikeSpeedKmh ? `~${targetPhysio.targetBikeSpeedKmh} km/h visés` : null,
    targetSource: targetPhysio.targetBikeSpeedKmh ? targetPhysio.targetBikeSpeedSource : 'non disponible — temps visé vélo non renseigné au questionnaire',
    strategy: "Effort constant ou légèrement négatif : ne pas taper trop fort sur le premier tiers, garder des jambes pour la course à pied qui suit.",
    nutrition: nutritionHint(bikeMin, heat),
  });

  pushSegment({
    key: 't2',
    icon: '🔄',
    label: 'Transition 2 (T2)',
    durationMin: t2Min,
    target: null,
    targetSource: null,
    strategy: "Quelques foulées de mise en jambes dès la sortie de T2 avant de viser directement l'allure course cible.",
    nutrition: null,
  });

  let runTarget = null;
  let runTargetSource = null;
  const runKm = Number(constraints?.customDistances?.run);
  if (targetPhysio.targetVma && runKm > 0) {
    const speedKmh = targetPhysio.targetVma * vmaPercentForDistance(runKm);
    runTarget = paceMinPerKmToStr(60 / speedKmh);
    runTargetSource = targetPhysio.targetVmaSource;
  }
  pushSegment({
    key: 'run',
    icon: '🏃',
    label: 'Course à pied',
    durationMin: runMin,
    target: runTarget,
    targetSource: runTarget ? runTargetSource : 'non disponible — temps visé course non renseigné au questionnaire',
    strategy: "Segment le plus exposé à la fatigue accumulée des deux premières disciplines : reste sur l'allure cible sans à-coups, garde une marge pour accélérer sur le dernier quart si les jambes répondent.",
    nutrition: nutritionHint(runMin, heat),
  });

  return { sportType: 'triathlon', totalMin, totalLabel: fmtClock(totalMin), segments };
}

/**
 * Construit le plan d'exécution COURSE À PIED SEULE — repères à 25/50/75/100% de la
 * course, à allure cible CONSTANTE. Le split en pourcentage est un calcul LITTÉRAL
 * (fraction du temps/distance visés déclarés par l'athlète), jamais une ré-estimation :
 * seule l'allure globale cible provient de targetPhysio, comme pour le triathlon ci-dessus.
 */
export function buildRunningExecutionPlan({ constraints, profile, heat = 'mild' }) {
  const totalMin = parseAppDuration(constraints?.targetTime);
  if (!totalMin) return null; // rien de déclaré au questionnaire

  const targetPhysio = profile?.targetPhysio || {};
  const distanceKm = constraints?.runningSubtype === 'trail'
    ? Number(constraints?.trailKm) || null
    : (RUNNING_DISTANCE_KM[constraints?.distance] ?? null);

  let pace = null;
  let paceSource = null;
  if (distanceKm) {
    // Allure moyenne cible = littéralement temps visé / distance (donnée déclarée par
    // l'athlète), cohérente par construction avec targetPhysio.targetVma (qui EST
    // dérivée de ce même temps visé — voir resolveTargetPhysiology).
    pace = paceMinPerKmToStr(totalMin / distanceKm);
    paceSource = `déduite du temps visé (${constraints.targetTime} sur ${distanceKm}km)`;
  } else if (targetPhysio.targetVma) {
    pace = null; // distance inconnue : impossible de convertir la VMA cible en allure fiable
  }

  const checkpoints = [0.25, 0.5, 0.75, 1].map((frac) => ({
    fraction: frac,
    label: frac === 1 ? 'Arrivée' : `${Math.round(frac * 100)}%`,
    atLabel: fmtClock(totalMin * frac),
    atKm: distanceKm ? Math.round(distanceKm * frac * 10) / 10 : null,
  }));

  return {
    sportType: 'running',
    totalMin,
    totalLabel: fmtClock(totalMin),
    distanceKm,
    pace,
    paceSource,
    checkpoints,
    nutrition: nutritionHint(totalMin, heat),
    strategy: "Départ 5-10% plus lent que l'allure cible sur le premier quart (évite le mur en fin de course), tenue stricte de l'allure cible sur la moitié centrale, marge pour accélérer sur le dernier quart si la forme le permet.",
  };
}

/** Point d'entrée unique : choisit le bon constructeur selon constraints.sportType. */
export function buildRaceExecutionPlan({ constraints, profile, heat = 'mild' }) {
  if (!constraints) return null;
  return constraints.sportType === 'triathlon'
    ? buildTriathlonExecutionPlan({ constraints, profile, heat })
    : buildRunningExecutionPlan({ constraints, profile, heat });
}
