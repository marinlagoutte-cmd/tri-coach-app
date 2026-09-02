// lib/cycleTracking.js
//
// Suivi du cycle menstruel (Point 8) — ENTIÈREMENT opt-in : rien n'est calculé ni affiché
// tant que l'athlète n'a pas explicitement activé la fonctionnalité et saisi au moins une
// date de début de règles (voir components/CycleTracker.js, STORAGE_KEYS.menstrualCycle).
// Aucune inférence automatique, aucune activation par défaut — donnée sensible traitée
// avec le même principe que le reste de l'app : jamais de valeur devinée, uniquement ce que
// l'athlète a réellement déclaré.
//
// Modèle à 4 phases (référentiel usuel en physiologie de l'exercice féminin, cycle "moyen"
// de référence 28 jours, resitué proportionnellement à la longueur de cycle réellement
// déclarée par l'athlète) :
//   Menstruelle (règles) → Folliculaire → Ovulation → Lutéale
// Volontairement présenté comme une ESTIMATION (jour du cycle calculé à partir de la
// dernière date déclarée + longueur moyenne déclarée) et non une mesure : un cycle réel
// varie d'un mois à l'autre, l'estimation se recale à chaque nouvelle date de règles saisie.

export const CYCLE_PHASES = [
  {
    key: 'menstrual',
    label: 'Phase menstruelle',
    // Proportions du cycle de référence (28j) : recalculées au prorata de la longueur
    // réellement déclarée dans computeCurrentPhase ci-dessous.
    startDay: 1,
    endDay: 5,
    guidance: "Fatigue et RPE perçu souvent plus élevés à charge égale. Volume/intensité au ressenti du jour, sans culpabiliser à alléger — c'est cohérent avec la physiologie de cette phase, pas un manque de volonté.",
  },
  {
    key: 'follicular',
    label: 'Phase folliculaire',
    startDay: 6,
    endDay: 13,
    guidance: "Œstrogènes en hausse, capacité à l'effort et récupération généralement meilleures — fenêtre souvent favorable pour les séances les plus exigeantes (VMA/seuil/force) si le reste de la planification s'y prête.",
  },
  {
    key: 'ovulation',
    label: 'Ovulation',
    startDay: 14,
    endDay: 16,
    guidance: 'Pic hormonal bref — certaines athlètes rapportent une légère baisse de stabilité articulaire (relâchement ligamentaire) : rien à changer systématiquement, juste un signal à croiser avec le journal de blessures si une gêne articulaire apparaît à ce moment du cycle.',
  },
  {
    key: 'luteal',
    label: 'Phase lutéale',
    startDay: 17,
    endDay: 28,
    guidance: "Température corporelle de base légèrement plus élevée (effort ressenti plus dur par forte chaleur), besoins hydriques/sodium parfois accrus en fin de phase. En fin de phase lutéale (derniers jours avant les règles), RPE et fatigue peuvent remonter — une charge légèrement réduite est cohérente, pas un signe de moins bonne forme.",
  },
];

function daysBetween(a, b) {
  return Math.floor((new Date(b) - new Date(a)) / (24 * 3600 * 1000));
}

/**
 * Bornes de phase (en jour de cycle 1..cycleLength) réellement utilisées pour un jeu de
 * données donné. Si l'athlète a explicitement redéfini la durée de ses phases
 * (`data.phaseLengths`, ex: {menstrual: 6, follicular: 7, ovulation: 2, luteal: 13} —
 * voir components/CycleTracker.js, section "Ajuster mes phases si je les connais"), ces
 * durées sont utilisées telles quelles, mises bout à bout dans l'ordre menstruelle →
 * folliculaire → ovulation → lutéale, PUIS proportionnellement recalées si leur somme ne
 * correspond plus exactement à `avgCycleLength` (ex: cycle un peu plus court ce mois-ci) —
 * pour ne jamais avoir de jour du cycle sans phase assignée. Sans override déclaré, on
 * retombe sur le modèle proportionnel par défaut (CYCLE_PHASES, référentiel 28 jours).
 */
export function getPhaseBoundaries(data) {
  const cycleLength = Number(data?.avgCycleLength) > 0 ? Number(data.avgCycleLength) : 28;
  const overrides = data?.phaseLengths;
  const hasValidOverrides = overrides && CYCLE_PHASES.every((p) => Number(overrides[p.key]) > 0);

  if (!hasValidOverrides) {
    const scale = cycleLength / 28;
    return CYCLE_PHASES.map((p) => ({ ...p, startDay: Math.round(p.startDay * scale), endDay: Math.round(p.endDay * scale) }));
  }

  const totalDeclared = CYCLE_PHASES.reduce((sum, p) => sum + Number(overrides[p.key]), 0);
  const rescale = cycleLength / totalDeclared; // ramène au total réellement déclaré ce mois-ci
  let cursor = 1;
  return CYCLE_PHASES.map((p) => {
    const length = Math.max(1, Math.round(Number(overrides[p.key]) * rescale));
    const startDay = cursor;
    const endDay = Math.min(cycleLength, cursor + length - 1);
    cursor = endDay + 1;
    return { ...p, startDay, endDay };
  });
}

/**
 * Calcule la phase du cycle estimée à la date de référence, à partir de la dernière date
 * de règles déclarée (`data.periodStartDates`, triées) et de la longueur de cycle moyenne
 * déclarée (`data.avgCycleLength`, défaut 28). Renvoie `null` si le suivi n'est pas activé
 * ou si aucune date n'a encore été déclarée — jamais une phase devinée sans donnée réelle.
 * Fonctionne aussi bien pour une date passée que future (voir getMonthPhaseMap ci-dessous,
 * qui l'appelle jour par jour pour construire le calendrier du mois affiché) : le cycle est
 * supposé se répéter régulièrement à la longueur déclarée tant qu'aucune nouvelle date de
 * règles n'est venue le recaler.
 */
export function computeCurrentPhase(data, referenceDate = new Date()) {
  if (!data?.enabled) return null;
  const dates = [...(data.periodStartDates || [])].sort((a, b) => new Date(a) - new Date(b));
  if (dates.length === 0) return null;

  const cycleLength = Number(data.avgCycleLength) > 0 ? Number(data.avgCycleLength) : 28;
  const lastStart = dates[dates.length - 1];
  const daysSinceLast = daysBetween(lastStart, referenceDate);
  if (daysSinceLast < 0) return null; // date de début dans le futur : rien à estimer

  // Jour du cycle (1-indexé), en supposant un nouveau cycle démarré si on a dépassé la
  // longueur déclarée (cas où l'athlète n'a pas encore renseigné le cycle suivant).
  const dayInCycle = (daysSinceLast % cycleLength) + 1;
  const boundaries = getPhaseBoundaries(data);

  const phase = boundaries.find((p) => dayInCycle >= p.startDay && dayInCycle <= p.endDay)
    || boundaries[boundaries.length - 1];

  return { ...phase, dayInCycle, cycleLength, lastPeriodStart: lastStart };
}

/**
 * Carte des phases pour chaque jour d'un mois donné (`month` 0-indexé comme Date.getMonth())
 * — utilisée par le calendrier simple de components/CycleTracker.js pour afficher la
 * projection du mois en cours ou d'un mois à venir/passé (flèches de navigation). Renvoie un
 * tableau vide si le suivi n'est pas activé ou si aucune date n'a été déclarée (rien à
 * projeter). Chaque entrée : { date: 'YYYY-MM-DD', day: <jour du mois>, phase }.
 */
export function getMonthPhaseMap(data, year, month) {
  if (!data?.enabled || !(data.periodStartDates || []).length) return [];
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const result = [];
  for (let day = 1; day <= daysInMonth; day += 1) {
    const d = new Date(year, month, day);
    const phase = computeCurrentPhase(data, d);
    result.push({ date: d.toISOString().slice(0, 10), day, phase });
  }
  return result;
}

/**
 * Signal utilisé par lib/feedback.js (analyzeFeedback) : indique si la phase donnée est une
 * phase où un RPE/fatigue plus élevé qu'à l'accoutumée est PHYSIOLOGIQUEMENT ATTENDU (phase
 * menstruelle, ou tout derniers jours de la phase lutéale juste avant les règles — voir la
 * guidance de CYCLE_PHASES ci-dessus) — donc PAS un signal de surcharge à traiter comme les
 * autres. Renvoie toujours `false` si aucune phase n'est fournie (suivi désactivé ou aucune
 * date déclarée) : "si besoin" seulement, jamais une hypothèse par défaut.
 */
export function isHigherPerceivedEffortPhase(phase) {
  if (!phase) return false;
  if (phase.key === 'menstrual') return true;
  if (phase.key === 'luteal') return phase.dayInCycle >= phase.cycleLength - 3;
  return false;
}
