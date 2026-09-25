// lib/nutritionData.js
//
// Base de connaissance nutrition sportive d'endurance, utilisée à la fois pour :
// - l'affichage statique instantané (avant/à la place de l'appel IA) dans NutritionPanel,
// - le calculateur de stratégie nutrition course (NutritionPlanner),
// - les valeurs numériques injectées dans les prompts IA (lib/gemini.js), sur le même
//   principe que les zones physio pré-calculées pour les séances d'entraînement.
//
// Sources : positions ISSN (nutrient timing, 30-60g CHO/h <2h30), consensus IOC/ACSM
// sport nutrition (glucides multi-transportables jusqu'à 90g/h >2h30-3h grâce au mix
// glucose:fructose, cf. Jeukendrup), littérature ultra-endurance récente (90-120g/h
// avec entraînement digestif, ratio ~1:0.8 glucose:fructose, Hearris et al. 2022,
// Viribay et al. 2020 sur marathon en montagne), et recommandations sodium/hydratation
// (300-800mg Na/h en conditions tempérées, 700-1500mg/h par forte chaleur ou chez les
// "gros sueurs salés", 400-800ml/h de liquide, objectif perte de poids <2-3%, prévention
// de l'hyponatrémie d'effort en évitant la surhydratation en eau pure sur les efforts longs).
// Ce sont des repères généraux, pas un avis médical individualisé.

// --- PALIERS D'EFFORT --------------------------------------------------------------

export const TIERS = ['flash', 'court', 'moyen', 'long', 'ultra'];

export const TIER_LABELS = {
  flash: 'Effort court (< 1h)',
  court: 'Effort modéré (1h - 1h30)',
  moyen: 'Effort soutenu (1h30 - 2h30)',
  long: 'Longue durée (2h30 - 4h)',
  ultra: 'Ultra-endurance (4h et +)',
};

export function classifyTier(durationMin) {
  const d = Number(durationMin) || 0;
  if (d < 60) return 'flash';
  if (d < 90) return 'court';
  if (d < 150) return 'moyen';
  if (d < 240) return 'long';
  return 'ultra';
}

// --- CIBLES NUMÉRIQUES PAR PALIER ---------------------------------------------------

export function getCarbRange(tier) {
  switch (tier) {
    case 'flash': return { min: 0, max: 20, note: "optionnel, utile seulement si intensité élevée" };
    case 'court': return { min: 15, max: 30, note: '' };
    case 'moyen': return { min: 30, max: 60, note: '' };
    case 'long': return { min: 60, max: 90, note: 'mix glucose:fructose ~2:1' };
    case 'ultra': return { min: 90, max: 120, note: 'mix glucose:fructose ~1:0.8, à entraîner à l\'avance à l\'entraînement' };
    default: return { min: 30, max: 60, note: '' };
  }
}

export function getFluidRange(heat) {
  switch (heat) {
    case 'hot': return { min: 600, max: 900 };
    case 'cool': return { min: 400, max: 600 };
    default: return { min: 500, max: 750 };
  }
}

export function getSodiumRange(tier, heat) {
  if (tier === 'flash') return { min: 0, max: 300 };
  const base = { cool: [300, 500], mild: [400, 700], hot: [700, 1200] }[heat] || [400, 700];
  return { min: base[0], max: base[1] };
}

export function getPotassiumRange(tier) {
  if (tier === 'flash' || tier === 'court') return { min: 0, max: 150 };
  return { min: 150, max: 250 };
}

export const HEAT_LABELS = { cool: 'Frais (<15°C)', mild: 'Tempéré (15-25°C)', hot: 'Chaud (>25°C)' };

// --- BIBLIOTHÈQUE DE PRODUITS (par portion standard) --------------------------------
// Valeurs moyennes approximatives issues des produits du marché (gels/boissons/barres
// d'endurance courants) — chaque athlète doit vérifier l'étiquette de son propre produit.

export const PRODUCT_LIBRARY = [
  { id: 'gel_std', category: 'Gel', name: 'Gel énergétique standard', carbs: 22, sodium: 55, potassium: 25, caffeine: 0, fluid: 0 },
  { id: 'gel_double', category: 'Gel', name: 'Gel double glucides (2:1)', carbs: 30, sodium: 50, potassium: 20, caffeine: 0, fluid: 0 },
  { id: 'gel_cafeine', category: 'Gel', name: 'Gel énergétique + caféine', carbs: 25, sodium: 55, potassium: 25, caffeine: 75, fluid: 0 },
  { id: 'boisson_iso', category: 'Boisson', name: 'Boisson isotonique (bidon 500ml)', carbs: 30, sodium: 300, potassium: 80, caffeine: 0, fluid: 500 },
  { id: 'boisson_hc', category: 'Boisson', name: 'Boisson "high-carb" ultra (bidon 500ml, ~80g)', carbs: 80, sodium: 400, potassium: 100, caffeine: 0, fluid: 500 },
  { id: 'eau', category: 'Boisson', name: 'Eau plate (gobelet 150ml)', carbs: 0, sodium: 0, potassium: 0, caffeine: 0, fluid: 150 },
  { id: 'barre', category: 'Solide', name: 'Barre énergétique', carbs: 35, sodium: 60, potassium: 60, caffeine: 0, fluid: 0 },
  { id: 'banane', category: 'Solide', name: 'Banane', carbs: 27, sodium: 1, potassium: 420, caffeine: 0, fluid: 0 },
  { id: 'dattes', category: 'Solide', name: 'Dattes / fruits secs (portion)', carbs: 24, sodium: 1, potassium: 340, caffeine: 0, fluid: 0 },
  { id: 'pate_fruit', category: 'Solide', name: 'Pâte de fruit / fruit gum', carbs: 10, sodium: 5, potassium: 15, caffeine: 0, fluid: 0 },
  { id: 'pdt_salee', category: 'Solide (ultra)', name: 'Pomme de terre bouillie salée', carbs: 15, sodium: 250, potassium: 300, caffeine: 0, fluid: 0 },
  { id: 'bouillon', category: 'Solide (ultra)', name: 'Bouillon / soupe salée', carbs: 3, sodium: 350, potassium: 60, caffeine: 0, fluid: 200 },
  { id: 'comprime_sel', category: 'Électrolytes', name: 'Comprimé / gélule de sel', carbs: 0, sodium: 200, potassium: 25, caffeine: 0, fluid: 0 },
  { id: 'custom', category: 'Autre', name: 'Aliment personnalisé…', carbs: 0, sodium: 0, potassium: 0, caffeine: 0, fluid: 0, isCustom: true },
];

// --- DÉRIVATION DU PROFIL DE COURSE DEPUIS LE QUESTIONNAIRE -------------------------

const RUNNING_DISTANCE_KM = { '5km': 5, '10km': 10, 'Semi-marathon': 21.0975, Marathon: 42.195 };

export function parseAppDuration(str) {
  if (!str) return null;
  const s = String(str).trim();
  if (!s) return null;
  if (s.includes(' - ')) {
    const parts = s.split(' - ').map(parseAppDuration).filter((v) => v !== null);
    if (parts.length === 2) return Math.round((parts[0] + parts[1]) / 2);
    return parts[0] || null;
  }
  let m = s.match(/^(\d+)h(\d{1,2})m?$/i);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = s.match(/^(\d+)h$/i);
  if (m) return Number(m[1]) * 60;
  m = s.match(/^(\d+)\s*min$|^(\d+)m$/i);
  if (m) return Number(m[1] || m[2]);
  m = s.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (m) return Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 60;
  m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  const n = Number(s);
  if (Number.isFinite(n) && n > 0) return n;
  return null;
}

/**
 * Reconstruit un profil de course exploitable (distance, durée estimée, palier d'effort)
 * à partir des contraintes déclarées au questionnaire (voir handleWizardComplete dans
 * pages/index.js) — avec repli sur trainingPlan si les contraintes structurées manquent
 * (ancien plan sauvegardé avant cette fonctionnalité, par ex.).
 */
export function deriveRaceProfile({ constraints, trainingPlan, sportType } = {}) {
  const st = constraints?.sportType || sportType || 'running';
  let distanceKm = null;
  let durationMin = null;
  let elevationM = null;
  let isTrail = false;

  if (st === 'running') {
    isTrail = constraints?.runningSubtype === 'trail';
    if (isTrail) {
      distanceKm = Number(constraints?.trailKm) || null;
      elevationM = Number(constraints?.trailElevation) || null;
    } else {
      distanceKm = RUNNING_DISTANCE_KM[constraints?.distance] ?? null;
    }
    durationMin = parseAppDuration(constraints?.targetTime) ?? parseAppDuration(trainingPlan?.targetTime);
  } else {
    const d = constraints?.customDistances;
    distanceKm = d ? (Number(d.swim) || 0) + (Number(d.bike) || 0) + (Number(d.run) || 0) : null;
    durationMin = parseAppDuration(constraints?.triathlonTimes?.total) ?? parseAppDuration(trainingPlan?.targetTime);
  }

  if (!durationMin || durationMin <= 0) {
    // Repli raisonnable si rien n'est calculable : ~10km/h de moyenne globale, sinon 2h par défaut.
    durationMin = distanceKm ? Math.round(distanceKm * 6) : 120;
  }

  const tier = classifyTier(durationMin);
  const label = trainingPlan?.title || (st === 'running' ? (isTrail ? 'Trail' : 'Course à pied') : `Triathlon ${constraints?.triathlonFormat || ''}`.trim());

  return { sportType: st, isTrail, distanceKm, elevationM, durationMin, tier, label };
}

// --- TEXTES STATIQUES PAR DÉFAUT (instantanés, avant/en cas d'échec de l'IA) --------

function fmtDuration(min) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}h${m > 0 ? m.toString().padStart(2, '0') : ''}` : `${m}min`;
}

export function buildStaticAdvice(raceProfile) {
  const { tier, sportType, durationMin, isTrail } = raceProfile;
  const carb = getCarbRange(tier);
  const fluid = getFluidRange('mild');
  const sodium = getSodiumRange(tier, 'mild');

  const trainingText = sportType === 'triathlon'
    ? "Au quotidien, base tes apports sur des glucides complexes (riz, pâtes, pain complet, fruits) proportionnels à ton volume d'entraînement, avec une source de protéines à chaque repas pour la récupération musculaire. Pour toute séance >1h (natation, vélo, course), emporte de l'eau et prévois 30-60g de glucides/h si l'intensité est soutenue. Hydrate-toi tout au long de la journée, pas seulement pendant l'effort."
    : "Au quotidien, privilégie les glucides complexes (riz, pâtes, pain complet, fruits) en fonction de ton volume d'entraînement, avec une source de protéines à chaque repas pour la récupération. Pour les sorties >1h, emporte de l'eau et 30-60g de glucides/h si l'intensité est soutenue. Une collation glucides+protéines dans les 30-60min après une séance clé accélère la récupération.";

  let raceText;
  if (tier === 'flash') {
    raceText = `Sur un format aussi court (~${fmtDuration(durationMin)}), les glucides ne sont pas indispensables : mise en route hydratée et un petit-déjeuner glucidique 2-3h avant suffisent. Pas besoin de gel pendant la course, sauf sensation de fringale.`;
  } else if (tier === 'court') {
    raceText = `Sur ~${fmtDuration(durationMin)} d'effort, ${carb.min}-${carb.max}g de glucides/h suffisent (1 gel ou équivalent), avec de l'eau à volonté selon la soif. Pas de stratégie sodium complexe nécessaire sur cette durée.`;
  } else if (tier === 'moyen') {
    raceText = `Sur ~${fmtDuration(durationMin)}, vise ${carb.min}-${carb.max}g de glucides/h (gel, boisson énergétique ou fruits secs) et ${fluid.min}-${fluid.max}ml/h de liquide. Un peu de sodium (${sodium.min}-${sodium.max}mg/h) devient utile si la course est chaude.`;
  } else if (tier === 'long') {
    raceText = `Sur ~${fmtDuration(durationMin)}, planifie ${carb.min}-${carb.max}g de glucides/h (mix glucose-fructose pour limiter les troubles digestifs), ${fluid.min}-${fluid.max}ml/h de liquide et ${sodium.min}-${sodium.max}mg/h de sodium. Teste ta stratégie à l'entraînement avant le jour J.`;
  } else {
    raceText = `Sur une épreuve d'ultra-endurance${isTrail ? ' (trail)' : ''} (~${fmtDuration(durationMin)}+), vise ${carb.min}-${carb.max}g de glucides/h avec un mix glucose-fructose bien entraîné en amont, ${fluid.min}-${fluid.max}ml/h de liquide et ${sodium.min}-${sodium.max}mg/h de sodium (davantage par forte chaleur). Alterne gels/boissons avec de l'aliment solide salé (pomme de terre, bouillon) pour éviter la lassitude gustative et soutenir les apports sur la durée.`;
  }

  return { trainingAdvice: trainingText, raceAdvice: raceText };
}

// --- CALCULATEUR DE STRATÉGIE NUTRITION COURSE (ravitos + segments) -----------------
// Modèle de données du plan (voir components/NutritionPlanner.js) :
// {
//   mode: 'km' | 'time',
//   totalDistanceKm, totalDurationMin, heat: 'cool'|'mild'|'hot',
//   markers: [{ id, position, name, fixed, restock: [entry, ...] }, ...],
//   segmentItems: { [fromMarkerId]: [entry, ...] },
// }
// Une "entry" (aliment/boisson consommé) : { uid, itemId, name, qty, carbs, sodium,
// potassium, caffeine, fluid } — carbs/sodium/potassium/caffeine/fluid sont les valeurs
// PAR PORTION (voir PRODUCT_LIBRARY), multipliées par qty au moment du calcul des totaux.

let _uidSeq = 0;
export function makeUid() {
  _uidSeq += 1;
  return `i${Date.now()}_${_uidSeq}`;
}

export function buildDefaultPlan(raceProfile) {
  const mode = raceProfile.sportType === 'triathlon' ? 'time' : (raceProfile.distanceKm ? 'km' : 'time');
  const totalDistanceKm = raceProfile.distanceKm || 10;
  const totalDurationMin = raceProfile.durationMin || 60;
  const finishPos = mode === 'km' ? totalDistanceKm : totalDurationMin;
  return {
    mode,
    totalDistanceKm,
    totalDurationMin,
    heat: 'mild',
    markers: [
      { id: 'start', position: 0, name: 'Départ', fixed: true, restock: [] },
      { id: 'finish', position: finishPos, name: 'Arrivée', fixed: true, restock: [] },
    ],
    segmentItems: { start: [] },
  };
}

export function getSortedMarkers(plan) {
  return [...(plan.markers || [])].sort((a, b) => a.position - b.position);
}

export function getSegments(plan) {
  const sorted = getSortedMarkers(plan);
  const totalSpan = plan.mode === 'km' ? plan.totalDistanceKm : plan.totalDurationMin;
  const segs = [];
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const from = sorted[i];
    const to = sorted[i + 1];
    const span = Math.max(0, to.position - from.position);
    const durationMin = plan.mode === 'km'
      ? (totalSpan > 0 ? (span / totalSpan) * plan.totalDurationMin : 0)
      : span;
    const items = plan.segmentItems?.[from.id] || [];
    const hours = durationMin / 60;
    segs.push({
      from,
      to,
      span,
      durationMin,
      items,
      carbsPerHour: hours > 0 ? sumEntries(items, 'carbs') / hours : 0,
      sodiumPerHour: hours > 0 ? sumEntries(items, 'sodium') / hours : 0,
    });
  }
  return segs;
}

function sumEntries(entries, field) {
  return (entries || []).reduce((s, e) => s + (Number(e[field]) || 0) * (Number(e.qty) || 1), 0);
}

export function flattenAllEntries(plan) {
  const all = [];
  Object.values(plan.segmentItems || {}).forEach((arr) => all.push(...(arr || [])));
  (plan.markers || []).forEach((m) => all.push(...(m.restock || [])));
  return all;
}

export function computeTotals(plan) {
  const entries = flattenAllEntries(plan);
  const totalCarbs = sumEntries(entries, 'carbs');
  const totalSodium = sumEntries(entries, 'sodium');
  const totalPotassium = sumEntries(entries, 'potassium');
  const totalCaffeine = sumEntries(entries, 'caffeine');
  const totalFluid = sumEntries(entries, 'fluid');
  const hours = (Number(plan.totalDurationMin) || 0) / 60;
  return {
    totalCarbs, totalSodium, totalPotassium, totalCaffeine, totalFluid,
    carbsPerHour: hours > 0 ? totalCarbs / hours : 0,
    sodiumPerHour: hours > 0 ? totalSodium / hours : 0,
    potassiumPerHour: hours > 0 ? totalPotassium / hours : 0,
    fluidPerHour: hours > 0 ? totalFluid / hours : 0,
  };
}

export function rangeStatus(value, range) {
  if (!range) return 'neutral';
  if (value <= 0) return 'neutral';
  if (value < range.min) return 'low';
  if (value > range.max) return 'high';
  return 'ok';
}
