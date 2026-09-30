// lib/bikeParts.js
//
// RÉFÉRENTIEL DES PIÈCES DE VÉLO pour le suivi d'usure (Outils > Matériel). Module sans code
// serveur : utilisé par lib/equipment.js (création des pièces à la synchro Strava) et par
// components/EquipmentTracker.js (affichage).
//
// Sources (voir REVUE_IA_2026-09.md, section 23) : tableau de synthèse WatchMy.bike (juillet
// 2026 : spécifications Park Tool, Shimano, SRAM, Continental, DT Swiss…), guides SRAM
// (disques, plaquettes, liquide), Shimano et Wahoo (cales), road.cc, componentry.app.
// Distances pour un usage route « majoritairement sec » ; pluie et hiver divisent à peu
// près par deux la durée de vie de la chaîne, des roulements et des plaquettes.
//
// Trois types de pièces :
//   - usure au KILOMÈTRE : lifespan_km > 0 ;
//   - usure au TEMPS : lifespan_days (compté depuis le dernier remplacement) — une pièce peut
//     avoir les deux, l'usure affichée est alors la plus avancée ;
//   - pièce de RÉFÉRENCE (lifespan_km = 0, sans lifespan_days) : pas d'usure au kilomètre ni
//     au temps (casse, choc) — listée pour ses détails et son critère de contrôle.
// Les valeurs restent modifiables pièce par pièce dans l'app.

export const BIKE_PARTS = [
  // ---------------- Transmission avant ----------------
  { zone: 'transmission-avant', part_key: 'chaine', name: 'Chaîne', lifespan_km: 3500, cost_eur: 35,
    guide: "Contrôleur d'usure : changer à 0,5 % d'allongement (11-12 vitesses), 0,75 % (10 vitesses et moins). Repère : 2 000 à 5 000 km." },
  { zone: 'transmission-avant', part_key: 'plateaux', name: 'Plateaux', lifespan_km: 15000, cost_eur: 120,
    guide: 'Environ 4 à 6 chaînes si elles sont changées à temps. Dents en « aileron de requin » ou chaîne qui saute : à changer.' },
  { zone: 'transmission-avant', part_key: 'cales', name: 'Cales de chaussures', lifespan_km: 6000, cost_eur: 20,
    guide: 'Repère fabricant : 4 800 à 8 000 km (les cales Look Keo s\'usent plus vite). Indicateurs d\'usure visibles ou déclenchement flou : à changer.' },
  { zone: 'transmission-avant', part_key: 'boitier-pedalier', name: 'Boîtier de pédalier', lifespan_km: 10000, cost_eur: 40,
    guide: 'Roulements extérieurs : 5 000 à 16 000 km (bas de la fourchette si on roule souvent sous la pluie). Craquement, jeu ou grattement : à changer.' },
  { zone: 'transmission-avant', part_key: 'pedales', name: 'Pédales', lifespan_km: 12000, cost_eur: 150,
    guide: 'Pas de chiffre fabricant : contrôler le jeu et la rotation des roulements ; entretien ou remplacement si ça accroche.' },
  { zone: 'transmission-avant', part_key: 'manivelles', name: 'Manivelles (et capteur de puissance)', lifespan_km: 0, cost_eur: 0,
    guide: 'Pas d\'usure au kilomètre : contrôler le serrage et l\'absence de jeu ; changer après un choc.' },
  { zone: 'transmission-avant', part_key: 'derailleur-avant', name: 'Dérailleur avant', lifespan_km: 0, cost_eur: 0,
    guide: 'Dure des années sans chute : contrôle visuel, réglage.' },
  { zone: 'transmission-avant', part_key: 'accumulateur', name: 'Batterie transmission (AXS / Di2)', lifespan_km: 0, cost_eur: 0,
    guide: '500 cycles de charge et plus (5 à 10 ans) : à changer quand l\'autonomie chute nettement.' },

  // ---------------- Transmission arrière ----------------
  { zone: 'transmission-arriere', part_key: 'cassette', name: 'Cassette', lifespan_km: 10000, cost_eur: 60,
    guide: '2 à 3 chaînes changées à temps (8 000 à 16 000 km). Une chaîne neuve qui saute en force : cassette à changer.' },
  { zone: 'transmission-arriere', part_key: 'galets', name: 'Galets de dérailleur', lifespan_km: 12000, cost_eur: 30,
    guide: 'Route : 10 000 à 16 000 km (bien moins dans la boue). Dents pointues ou arrondies, galet qui tourne mal : à changer.' },
  { zone: 'transmission-arriere', part_key: 'cables-derailleur', name: 'Câbles et gaines de dérailleur', lifespan_km: 0, lifespan_days: 900, cost_eur: 25, mechanicalOnly: true,
    guide: 'Transmission mécanique uniquement : 2 à 3 ans (l\'arrière plus tôt). Passages de vitesses paresseux malgré le réglage : à changer.' },
  { zone: 'transmission-arriere', part_key: 'derailleur', name: 'Dérailleur arrière', lifespan_km: 0, cost_eur: 0,
    guide: 'Dure des années sans chute : contrôler la patte de dérailleur après un choc ; les galets s\'usent à part.' },

  // ---------------- Roues et freinage ----------------
  { zone: 'roues', part_key: 'pneu-av', name: 'Pneu avant', lifespan_km: 8000, cost_eur: 60,
    guide: 'Environ 2 fois la durée du pneu arrière. Coupures, craquelures ou carcasse visible : à changer quel que soit le kilométrage.' },
  { zone: 'roues', part_key: 'pneu-ar', name: 'Pneu arrière', lifespan_km: 4500, cost_eur: 60,
    guide: 'Route : 3 000 à 6 000 km (gommes course en bas de fourchette). Témoin d\'usure disparu ou profil aplati : à changer.' },
  { zone: 'roues', part_key: 'preventif', name: 'Liquide préventif tubeless', lifespan_km: 0, lifespan_days: 120, cost_eur: 10,
    guide: 'Tubeless uniquement : sèche en 2 à 6 mois selon la marque et la chaleur. Un pneu qui ne rebouche plus une épine n\'est plus protégé.' },
  { zone: 'roues', part_key: 'plaquettes', name: 'Plaquettes de frein', lifespan_km: 3000, cost_eur: 25,
    guide: 'Pas de chiffre fabricant (résine 800 à 3 200 km, métal fritté 1 600 à 5 600 km) : ce kilométrage est un repère de CONTRÔLE. Changer sous 3 mm (garniture + support), règle SRAM.' },
  { zone: 'roues', part_key: 'disques', name: 'Disques de frein', lifespan_km: 10000, cost_eur: 45,
    guide: 'Aucun chiffre en kilomètres n\'existe : repère de CONTRÔLE d\'épaisseur. Changer sous 1,55 mm pour un disque SRAM de 1,85 mm (1,5 mm chez Shimano).' },
  { zone: 'roues', part_key: 'moyeux', name: 'Moyeux : roulements et roue libre', lifespan_km: 0, lifespan_days: 365, cost_eur: 40,
    guide: 'Entretien annuel (recommandation DT Swiss) : roulements et cliquets de roue libre nettoyés et graissés. Grattement ou bruit : plus tôt.' },
  { zone: 'roues', part_key: 'roues', name: 'Roues (jantes, rayons)', lifespan_km: 0, cost_eur: 0,
    guide: 'Jantes à disque : pas d\'usure au freinage. Contrôler tension des rayons et voile ; jante carbone à faire vérifier après un choc.' },
  { zone: 'roues', part_key: 'axes', name: 'Axes traversants', lifespan_km: 0, cost_eur: 0,
    guide: 'Pas d\'usure : vérifier le serrage.' },

  // ---------------- Cockpit ----------------
  { zone: 'cockpit', part_key: 'liquide-frein', name: 'Liquide de frein (purge)', lifespan_km: 0, lifespan_days: 365, cost_eur: 20,
    guide: 'Liquide DOT (SRAM) : purge tous les 12 mois — il absorbe l\'humidité ; huile minérale (Shimano) : environ 24 mois. Levier spongieux : plus tôt.' },
  { zone: 'cockpit', part_key: 'jeu-direction', name: 'Jeu de direction', lifespan_km: 0, lifespan_days: 540, cost_eur: 40,
    guide: '1 à 2 ans, plus tôt si on roule souvent sous la pluie (le roulement bas lâche en premier). Direction crantée ou craquement : à entretenir.' },
  { zone: 'cockpit', part_key: 'ruban', name: 'Ruban de cintre', lifespan_km: 0, lifespan_days: 365, cost_eur: 25,
    guide: 'Environ 1 an : durci, déchiré ou glissant, à changer.' },
  { zone: 'cockpit', part_key: 'durites', name: 'Durites de frein', lifespan_km: 0, cost_eur: 0,
    guide: 'Pas d\'usure au kilomètre : contrôler l\'absence de fuite et de pincement à chaque purge.' },
  { zone: 'cockpit', part_key: 'levier-frein', name: 'Leviers de frein / dérailleur', lifespan_km: 0, cost_eur: 0,
    guide: 'Pas d\'usure au kilomètre : changer après une chute s\'ils sont abîmés.' },
  { zone: 'cockpit', part_key: 'cintre', name: 'Cintre / potence', lifespan_km: 0, cost_eur: 0,
    guide: 'Carbone : pas de limite d\'âge publiée ; contrôle après toute chute ou choc.' },
  { zone: 'cockpit', part_key: 'selle', name: 'Selle', lifespan_km: 0, cost_eur: 0,
    guide: 'Pas de chiffre fabricant : changer si les rails ou la coque sont abîmés, ou si le rembourrage est affaissé.' },
  { zone: 'cockpit', part_key: 'tige-selle', name: 'Tige de selle', lifespan_km: 0, cost_eur: 0,
    guide: 'Carbone : contrôle après chute ; vérifier le serrage.' },
  { zone: 'cockpit', part_key: 'serrage-selle', name: 'Serrage de tige de selle', lifespan_km: 0, cost_eur: 0,
    guide: 'Vérifier le couple de serrage.' },
  { zone: 'cockpit', part_key: 'cadre', name: 'Cadre', lifespan_km: 0, cost_eur: 0,
    guide: 'Pas de limite d\'âge : contrôle après toute chute ou choc (dégâts parfois invisibles sur le carbone).' },
  { zone: 'cockpit', part_key: 'fourche', name: 'Fourche', lifespan_km: 0, cost_eur: 0,
    guide: 'Pas de limite d\'âge : contrôle après toute chute ou choc.' },
];

/**
 * Anciennes valeurs par défaut (avant ce référentiel). Une pièce déjà créée qui porte ENCORE
 * exactement l'ancienne valeur n'a jamais été modifiée par l'athlète : elle reçoit la
 * nouvelle. Une valeur modifiée par l'athlète n'est jamais écrasée.
 */
export const LEGACY_DEFAULTS = {
  chaine: { lifespan_km: 3000 },
  manivelles: { lifespan_km: 20000, name: 'Manivelles / plateau' },
  pedales: { lifespan_km: 12000 },
  'derailleur-avant': { lifespan_km: 15000 },
  'boitier-pedalier': { lifespan_km: 12000 },
  cassette: { lifespan_km: 9000 },
  derailleur: { lifespan_km: 15000 },
  'pneu-av': { lifespan_km: 4000 },
  'pneu-ar': { lifespan_km: 3500 },
  plaquettes: { lifespan_km: 4000 },
  disques: { lifespan_km: 6500 },
  roues: { lifespan_km: 25000, name: 'Roues (moyeu / tension)' },
  ruban: { lifespan_km: 6000 },
  durites: { lifespan_km: 15000 },
  cintre: { lifespan_km: 30000 },
  selle: { lifespan_km: 20000 },
  accumulateur: { name: 'Batterie transmission (AXS)' },
};

const BY_KEY = new Map(BIKE_PARTS.map((p) => [p.part_key, p]));
export const partTemplate = (key) => BY_KEY.get(key) || null;
export const partGuide = (key) => BY_KEY.get(key)?.guide || '';
export const partLifespanDays = (key) => BY_KEY.get(key)?.lifespan_days || 0;

/** Pièce suivie (barre d'usure) : usure au kilomètre ou au temps. */
export function isTrackedPart(component) {
  return (Number(component?.lifespan_km) || 0) > 0 || partLifespanDays(component?.part_key) > 0;
}

/**
 * Usure d'une pièce : kilomètres depuis le dernier changement ET/OU jours depuis le dernier
 * changement (`lastChangeAt` : date du dernier remplacement dans l'historique, sinon date de
 * création de la pièce). `ratio` = l'usure la plus avancée des deux (0 à 1).
 */
export function partWear(component, km, lastChangeAt, now = new Date()) {
  const lifeKm = Number(component?.lifespan_km) || 0;
  const lifeDays = partLifespanDays(component?.part_key);
  const kmRatio = lifeKm > 0 ? Math.min(km / lifeKm, 1) : 0;
  let days = null;
  let dayRatio = 0;
  if (lifeDays > 0 && lastChangeAt) {
    days = Math.max(0, Math.floor((new Date(now) - new Date(lastChangeAt)) / 86_400_000));
    dayRatio = Math.min(days / lifeDays, 1);
  }
  return { kmRatio, dayRatio, days, lifeDays, lifeKm, ratio: Math.max(kmRatio, dayRatio), byTime: dayRatio > kmRatio };
}

/** « 4 mois » / « 12 mois » / « 1 an et demi » — libellé court d'une durée en jours. */
export function formatMonths(days) {
  const m = Math.round(days / 30.4);
  if (m < 1) return `${days} j`;
  return `${m} mois`;
}

/**
 * Mises à jour à appliquer aux pièces DÉJÀ créées : nouvelle durée de vie / nouveau nom
 * seulement si la pièce porte encore l'ancienne valeur par défaut (jamais modifiée).
 */
export function legacyUpdatesFor(component) {
  const legacy = LEGACY_DEFAULTS[component?.part_key];
  const tpl = partTemplate(component?.part_key);
  if (!legacy || !tpl) return {};
  const updates = {};
  if (legacy.lifespan_km !== undefined && Number(component.lifespan_km) === legacy.lifespan_km && tpl.lifespan_km !== legacy.lifespan_km) {
    updates.lifespan_km = tpl.lifespan_km;
  }
  if (legacy.name && component.name === legacy.name && tpl.name !== legacy.name) updates.name = tpl.name;
  return updates;
}
