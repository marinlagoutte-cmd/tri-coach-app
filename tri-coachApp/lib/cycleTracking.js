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
 * Calcule la phase du cycle estimée à la date de référence, à partir de la dernière date
 * de règles déclarée (`data.periodStartDates`, triées) et de la longueur de cycle moyenne
 * déclarée (`data.avgCycleLength`, défaut 28). Renvoie `null` si le suivi n'est pas activé
 * ou si aucune date n'a encore été déclarée — jamais une phase devinée sans donnée réelle.
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
  const scale = cycleLength / 28;

  const phase = CYCLE_PHASES.find((p) => dayInCycle >= Math.round(p.startDay * scale) && dayInCycle <= Math.round(p.endDay * scale))
    || CYCLE_PHASES[CYCLE_PHASES.length - 1];

  return { ...phase, dayInCycle, cycleLength, lastPeriodStart: lastStart };
}
