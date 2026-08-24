// lib/tirePressure.js
//
// Calcul de pression de pneu vélo (route/gravel) par la méthode du "tire drop"
// (affaissement du pneu sous charge), popularisée par SILCA/Josh Poertner et les
// études indépendantes (Bicycle Quarterly / Frank Berto). Cette approche est
// aujourd'hui le standard de référence dans le cyclisme — bien plus fiable que les
// vieux tableaux génériques "poids du cycliste → PSI" qui ignorent le poids du vélo,
// la largeur RÉELLE du pneu et le terrain.
//
// IMPORTANT — ce n'est PAS une reproduction de l'algorithme propriétaire SILCA (qui
// est basé sur 4000+ mesures réelles de raideur de pneu, non public). C'est une
// approximation construite à partir de repères publics largement documentés (largeur
// mesurée, poids système total, répartition avant/arrière ~40/60, largeur du pneu
// inversement proportionnelle à la pression) — un bon point de départ, pas une
// vérité absolue. Toujours affiner ensuite au ressenti (grip, confort, absence de
// tape-cul sur les irrégularités).
//
// RÈGLE ABSOLUE (même esprit que lib/physiology.js) : ne jamais afficher un chiffre
// sans borne de sécurité. Le résultat est toujours contraint par la limite ETRTO
// hookless (5.0 bar / 72.5 psi) si applicable, et par la limite max connue du
// pneu/jante si l'athlète la renseigne — ces bornes priment TOUJOURS sur le calcul.

export const BAR_TO_PSI = 14.5038;

// Table de référence : pression (bar) nécessaire pour ~15% d'affaissement, pour une
// charge de 45 kg sur LA ROUE (≈ roue arrière d'un système de 75 kg réparti 40/60),
// pneu à chambre à air, carcasse standard, asphalte lisse, sec. Interpolée en
// log-log entre les points (équivalent à une loi de puissance par segment), ce qui
// respecte la règle "plus le pneu est large, moins il faut de pression".
const REFERENCE_TABLE_45KG = [
  { width: 18, bar: 9.5 },
  { width: 20, bar: 8.4 },
  { width: 23, bar: 7.2 },
  { width: 25, bar: 6.4 },
  { width: 28, bar: 5.6 },
  { width: 30, bar: 5.0 },
  { width: 32, bar: 4.6 },
  { width: 35, bar: 4.0 },
  { width: 38, bar: 3.6 },
  { width: 40, bar: 3.3 },
  { width: 45, bar: 2.8 },
  { width: 50, bar: 2.4 },
  { width: 55, bar: 2.1 },
  { width: 60, bar: 1.9 },
];
const REFERENCE_LOAD_KG = 45;

// Bornes de sécurité globales, avant application des limites hookless / max connue.
const FLOOR_BAR = 1.4; // en dessous : risque élevé de pincement et de désertage sur route
const CEILING_BAR = 10; // au-dessus : au-delà du raisonnable pour la quasi-totalité des jantes/pneus route
export const HOOKLESS_MAX_BAR = 5.0; // limite ETRTO officielle pour jantes sans crochet ("hookless")

function interpolateBase(widthMm) {
  const w = Math.min(Math.max(widthMm, REFERENCE_TABLE_45KG[0].width), REFERENCE_TABLE_45KG[REFERENCE_TABLE_45KG.length - 1].width);
  let lo = REFERENCE_TABLE_45KG[0];
  let hi = REFERENCE_TABLE_45KG[REFERENCE_TABLE_45KG.length - 1];
  for (let i = 0; i < REFERENCE_TABLE_45KG.length - 1; i += 1) {
    if (w >= REFERENCE_TABLE_45KG[i].width && w <= REFERENCE_TABLE_45KG[i + 1].width) {
      lo = REFERENCE_TABLE_45KG[i];
      hi = REFERENCE_TABLE_45KG[i + 1];
      break;
    }
  }
  if (lo.width === hi.width) return lo.bar;
  // Interpolation log-log (= loi de puissance locale) entre les deux points encadrants.
  const t = (Math.log(w) - Math.log(lo.width)) / (Math.log(hi.width) - Math.log(lo.width));
  return Math.exp(Math.log(lo.bar) + t * (Math.log(hi.bar) - Math.log(lo.bar)));
}

export const SURFACE_OPTIONS = ['smooth', 'rough', 'gravel', 'offroad'];
const SURFACE_MULTIPLIER = { smooth: 1.0, rough: 0.9, gravel: 0.8, offroad: 0.7 };

export const TIRE_TYPE_OPTIONS = ['clincher', 'tubeless', 'tubular'];
const TIRE_TYPE_MULTIPLIER = { clincher: 1.0, tubeless: 0.9, tubular: 0.92 };

export const WEATHER_OPTIONS = ['dry', 'wet'];
const WEATHER_MULTIPLIER = { dry: 1.0, wet: 0.93 };

export const CARCASS_OPTIONS = ['standard', 'supple', 'reinforced'];
const CARCASS_MULTIPLIER = { standard: 1.0, supple: 0.96, reinforced: 1.08 };

export const LOAD_DISTRIBUTION_OPTIONS = ['neutral', 'frontLoaded', 'rearLoaded'];
// { front, rear } — part du poids système total portée par chaque roue.
const LOAD_DISTRIBUTION_SPLIT = {
  neutral: { front: 0.4, rear: 0.6 },
  frontLoaded: { front: 0.46, rear: 0.54 }, // sacoches guidon/cadre avant, bikepacking avant
  rearLoaded: { front: 0.35, rear: 0.65 }, // sacoche de selle / porte-bagage arrière
};

export const PRIORITY_OPTIONS = ['comfort', 'balanced', 'performance'];
const PRIORITY_MULTIPLIER = { comfort: 0.92, balanced: 1.0, performance: 1.08 };

function clampWithReason(bar, { hookless, knownMaxBar }) {
  let value = bar;
  let reason = null;
  if (value < FLOOR_BAR) {
    value = FLOOR_BAR;
    reason = 'floor';
  }
  if (value > CEILING_BAR) {
    value = CEILING_BAR;
    reason = 'ceiling';
  }
  if (hookless && value > HOOKLESS_MAX_BAR) {
    value = HOOKLESS_MAX_BAR;
    reason = 'hookless';
  }
  if (knownMaxBar && Number.isFinite(knownMaxBar) && value > knownMaxBar) {
    value = knownMaxBar;
    reason = 'knownMax';
  }
  return { bar: value, clampedBy: reason };
}

function pressureForWheel(wheelLoadKg, widthMm, multiplier, options) {
  const base = interpolateBase(widthMm) * (wheelLoadKg / REFERENCE_LOAD_KG);
  const raw = base * multiplier;
  const { bar, clampedBy } = clampWithReason(raw, options);
  return { bar: Math.round(bar * 20) / 20, psi: Math.round(bar * BAR_TO_PSI * 2) / 2, clampedBy };
}

/**
 * Calcule la pression recommandée avant/arrière, avec une fourchette confort ↔
 * performance pour situer le choix.
 *
 * @param {Object} inputs
 * @param {number} inputs.systemWeightKg - vélo chargé + pilote (+ bagages)
 * @param {number} inputs.tireWidthMm - largeur MESURÉE (pas la largeur nominale)
 * @param {'smooth'|'rough'|'gravel'|'offroad'} inputs.surface
 * @param {'clincher'|'tubeless'|'tubular'} inputs.tireType
 * @param {'dry'|'wet'} inputs.weather
 * @param {'standard'|'supple'|'reinforced'} [inputs.carcass]
 * @param {'comfort'|'balanced'|'performance'} [inputs.priority]
 * @param {'neutral'|'frontLoaded'|'rearLoaded'} [inputs.loadDistribution]
 * @param {boolean} [inputs.hookless] - jante sans crochet → plafond ETRTO 5.0 bar
 * @param {number} [inputs.knownMaxBar] - limite max connue (pneu ou jante), en bar
 */
export function computeTirePressure(inputs) {
  const {
    systemWeightKg,
    tireWidthMm,
    surface = 'smooth',
    tireType = 'clincher',
    weather = 'dry',
    carcass = 'standard',
    priority = 'balanced',
    loadDistribution = 'neutral',
    hookless = false,
    knownMaxBar = null,
  } = inputs;

  const split = LOAD_DISTRIBUTION_SPLIT[loadDistribution] || LOAD_DISTRIBUTION_SPLIT.neutral;
  const commonMultiplier = (SURFACE_MULTIPLIER[surface] ?? 1) * (TIRE_TYPE_MULTIPLIER[tireType] ?? 1) * (WEATHER_MULTIPLIER[weather] ?? 1) * (CARCASS_MULTIPLIER[carcass] ?? 1);
  const clampOptions = { hookless, knownMaxBar };

  const rearLoad = systemWeightKg * split.rear;
  const frontLoad = systemWeightKg * split.front;

  const recommendedMultiplier = PRIORITY_MULTIPLIER[priority] ?? 1;
  const rear = pressureForWheel(rearLoad, tireWidthMm, commonMultiplier * recommendedMultiplier, clampOptions);
  const front = pressureForWheel(frontLoad, tireWidthMm, commonMultiplier * recommendedMultiplier, clampOptions);

  // Fourchette confort ↔ performance, calculée indépendamment de la priorité choisie,
  // pour montrer où se situe la valeur retenue.
  const rearComfort = pressureForWheel(rearLoad, tireWidthMm, commonMultiplier * PRIORITY_MULTIPLIER.comfort, clampOptions);
  const rearPerf = pressureForWheel(rearLoad, tireWidthMm, commonMultiplier * PRIORITY_MULTIPLIER.performance, clampOptions);
  const frontComfort = pressureForWheel(frontLoad, tireWidthMm, commonMultiplier * PRIORITY_MULTIPLIER.comfort, clampOptions);
  const frontPerf = pressureForWheel(frontLoad, tireWidthMm, commonMultiplier * PRIORITY_MULTIPLIER.performance, clampOptions);

  const warnings = [];
  if (rear.clampedBy || front.clampedBy) {
    const reasons = new Set([rear.clampedBy, front.clampedBy].filter(Boolean));
    reasons.forEach((r) => warnings.push(r));
  }

  return {
    rear,
    front,
    range: {
      rear: { comfort: rearComfort, performance: rearPerf },
      front: { comfort: frontComfort, performance: frontPerf },
    },
    warnings,
  };
}
