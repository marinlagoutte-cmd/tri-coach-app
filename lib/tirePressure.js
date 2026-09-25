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
// approximation construite à partir de repères publics largement documentés et
// SOURCÉS (voir REFERENCE_TABLE_45KG et LOAD_DISTRIBUTION_SPLIT ci-dessous) — un bon
// point de départ, pas une vérité absolue. Toujours affiner ensuite au ressenti
// (grip, confort, absence de tape-cul sur les irrégularités).
//
// RÈGLE ABSOLUE (même esprit que lib/physiology.js) : ne jamais afficher un chiffre
// sans borne de sécurité. Le résultat est toujours contraint par la limite ETRTO
// hookless (5.0 bar / 72.5 psi) si applicable, et par la limite max connue du
// pneu/jante si l'athlète la renseigne — ces bornes priment TOUJOURS sur le calcul.

export const BAR_TO_PSI = 14.5038;

// Table de référence : pression (bar) nécessaire pour ~15% d'affaissement, pour une
// charge de 45 kg sur LA ROUE, pneu à chambre à air, carcasse standard, asphalte
// lisse, sec. Interpolée en log-log entre les points (loi de puissance par segment),
// ce qui respecte la règle "plus le pneu est large, moins il faut de pression".
//
// SOURCE ET RECALIBRAGE (2026-08) : ces valeurs sont ancrées sur le graphique "15%
// tire drop" de Frank Berto, publié et réimprimé dans Bicycle Quarterly Vol. 5 No. 4
// (2006), relu par Berto lui-même — la même donnée empirique de référence sur
// laquelle SILCA a construit sa méthodologie. Le point 20 mm/45 kg (125 psi = 8.6 bar)
// et le point 37 mm/45 kg (45 psi = 3.1 bar) viennent directement du texte de cet
// article. Les points intermédiaires (23-40 mm) sont calculés avec l'ajustement
// (régression) publié par R. "RubeRad" sur le fil bikeforums.net "15% drop FORMULA
// for tire pressure as a function of width and load" (2013), qui approxime le
// graphique de Berto à ±2 psi près sur la plage 23-37 mm :
//   P(psi) = 600 × charge_roue(lb) / largeur(mm)² + 0.75 × largeur(mm) − 25
// Cette formule est explicitement documentée comme peu fiable en dehors de la plage
// ~20-40 mm (elle surestime de 10-15 psi à 20 mm, et redevient non-physique au-delà
// de ~45 mm) — au-delà de 40 mm, les valeurs restent une extrapolation raisonnable,
// pas une donnée mesurée.
// Précédente table (avant recalibrage) : elle surestimait la pression d'environ
// 10 à 20% sur la plage 25-40 mm par rapport à ces données sourcées (ex. 37 mm
// donnait ~54 psi calculé contre 45 psi mesuré par Berto) — c'était la cause
// principale des pressions trop élevées remontées par un athlète.
const REFERENCE_TABLE_45KG = [
  { width: 18, bar: 9.7 },
  { width: 20, bar: 8.6 },
  { width: 23, bar: 7.2 },
  { width: 25, bar: 6.1 },
  { width: 28, bar: 5.0 },
  { width: 30, bar: 4.4 },
  { width: 32, bar: 3.9 },
  { width: 35, bar: 3.4 },
  { width: 38, bar: 3.1 },
  { width: 40, bar: 2.9 },
  { width: 45, bar: 2.75 },
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
// "neutral" = 40/60, qui correspond au chiffre publié pour un vélo de route/course
// dans le même article Bicycle Quarterly (2006) que la table de pression ci-dessus
// (répartition mesurée par les auteurs : rando 45/55, course 40/60, ville/chargé
// arrière 35/65). Ce n'est pas une approximation arbitraire : un écart marqué entre
// pression avant et arrière est le résultat ATTENDU de cette méthode pour un système
// lourd avec ce split — ce n'est pas un signe de bug si l'écart semble important.
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
