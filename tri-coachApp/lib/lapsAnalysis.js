// lib/lapsAnalysis.js
//
// Analyse DÉTERMINISTE des "laps" (tours) Strava d'une activité — étape de
// pré-traitement avant l'IA, même philosophie que lib/routePlanning.js ou le
// double-check de lib/coGeneration.js : tout ce qui peut être calculé de façon
// fiable en JS l'est ici, l'IA (voir analyzeStravaActivity, lib/gemini.js)
// n'intervenant qu'ensuite pour la mise en récit. Objectif (demande explicite
// de l'athlète) : que l'analyse post-séance ne se limite plus aux moyennes
// globales de l'activité, mais décortique VRAIMENT ce qui s'est passé lap par
// lap — BPM, vitesse/allure, cadence, puissance, dénivelé — et corrèle temps
// d'effort / récupération / nombre de répétitions pour reconnaître une séance
// fractionnée (ex: "6x3min").
//
// Entrée : `laps` brut tel que renvoyé par GET /activities/{id}/laps (voir
// fetchStravaActivityLaps, lib/strava.js) — un objet par lap. Strava renvoie
// `null`/absent pour un champ non mesuré (ex: pas de cadence sans capteur) :
// on respecte ça, jamais de valeur inventée à la place.

const EFFORT_RATIO = 1.06; // lap >6% plus intense que la médiane -> "effort"
const RECOVERY_RATIO = 0.94; // lap >6% moins intense que la médiane -> "récup"
const DURATION_GROUP_TOLERANCE = 0.25; // 25% d'écart de durée = "même groupe" de répétitions

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Allure min/km (course/nage) à partir d'une vitesse en m/s — null si vitesse nulle/absente. */
function formatPace(speedMs) {
  if (!speedMs || speedMs <= 0) return null;
  const paceMinPerKm = 1000 / speedMs / 60;
  const min = Math.floor(paceMinPerKm);
  const sec = Math.round((paceMinPerKm - min) * 60);
  return `${min}:${String(sec).padStart(2, '0')}/km`;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return '?';
  const min = Math.floor(seconds / 60);
  const sec = Math.round(seconds % 60);
  if (min <= 0) return `${sec}s`;
  return sec > 0 ? `${min}min${String(sec).padStart(2, '0')}` : `${min}min`;
}

/**
 * Normalise un lap brut Strava en objet compact — null explicite (jamais 0 par
 * défaut) pour tout ce qui n'a pas été mesuré, afin de ne jamais laisser l'IA
 * croire à une FC/puissance/cadence de 0 sur un lap sans capteur.
 */
function normalizeLap(raw, index) {
  return {
    index: index + 1,
    durationS: raw.moving_time ?? raw.elapsed_time ?? null,
    distanceM: raw.distance ?? null,
    speedMs: raw.average_speed ?? null,
    avgHr: Number.isFinite(raw.average_heartrate) ? raw.average_heartrate : null,
    avgWatts: Number.isFinite(raw.average_watts) ? raw.average_watts : null,
    avgCadence: Number.isFinite(raw.average_cadence) ? raw.average_cadence : null,
    elevGainM: Number.isFinite(raw.total_elevation_gain) ? raw.total_elevation_gain : null,
  };
}

/**
 * Choisit la métrique d'intensité la plus fiable disponible sur CETTE séance :
 * FC en priorité (signal le plus universel, dispo même sans capteur puissance),
 * sinon puissance (vélo équipé), sinon vitesse. Ne mélange jamais deux métriques
 * différentes entre laps — un lap sans la métrique retenue reste "non classé".
 */
function pickIntensityMetric(laps) {
  const ratio = (key) => laps.filter((l) => Number.isFinite(l[key])).length / laps.length;
  if (ratio('avgHr') >= 0.8) return 'avgHr';
  if (ratio('avgWatts') >= 0.8) return 'avgWatts';
  if (laps.filter((l) => Number.isFinite(l.speedMs) && l.speedMs > 0).length / laps.length >= 0.8) return 'speedMs';
  return null;
}

/**
 * Classe chaque lap effort / récup / stable par rapport à la MÉDIANE de la
 * séance (moins sensible qu'une moyenne à un lap extrême) sur la métrique
 * d'intensité retenue. Ne classe rien si moins de 3 laps exploitables — pas de
 * structure fiable à détecter sur une poignée de points.
 */
function classifyLaps(laps, metric) {
  if (!metric) return laps.map((l) => ({ ...l, role: null }));
  // Médiane calculée sur les laps "intérieurs" (hors 1er et dernier) quand il y en a assez :
  // le 1er/dernier lap est très souvent un échauffement/retour au calme, dont l'intensité
  // basse tirerait sinon la médiane vers le bas et empêcherait de distinguer une vraie
  // récupération (intensité intermédiaire) d'un lap "stable". Le 1er/dernier lap reste
  // classé normalement, seule la référence utilisée pour comparer change.
  const referenceLaps = laps.length > 4 ? laps.slice(1, -1) : laps;
  const values = referenceLaps.map((l) => l[metric]).filter(Number.isFinite);
  if (values.length < 3) return laps.map((l) => ({ ...l, role: null }));
  const med = median(values);
  return laps.map((l) => {
    const v = l[metric];
    if (!Number.isFinite(v) || !med) return { ...l, role: null };
    const ratio = v / med;
    const role = ratio >= EFFORT_RATIO ? 'effort' : ratio <= RECOVERY_RATIO ? 'récup' : 'stable';
    return { ...l, role };
  });
}

/**
 * Regroupe les laps "effort" de durée comparable (tolérance 25%) en un pattern
 * de répétitions — ex: 6 laps effort de ~3min chacun, même séparés par des laps
 * récup. C'est la détection déterministe d'un fractionné type "6x3min" : l'IA
 * n'a plus qu'à le décrire en langage naturel, jamais à le deviner depuis une
 * liste brute de chiffres. Renvoie null si aucun pattern fiable ne se dégage
 * (efforts trop hétérogènes, ou moins de 2 répétitions).
 */
function detectIntervalPattern(classified) {
  const efforts = classified.filter((l) => l.role === 'effort' && Number.isFinite(l.durationS));
  const recoveries = classified.filter((l) => l.role === 'récup' && Number.isFinite(l.durationS));
  if (efforts.length < 2) return null;

  const effortDurations = efforts.map((l) => l.durationS);
  const medEffort = median(effortDurations);
  const consistent = medEffort > 0 && effortDurations.every((d) => Math.abs(d - medEffort) / medEffort <= DURATION_GROUP_TOLERANCE);
  if (!consistent) return null;

  const metric = Number.isFinite(efforts[0].avgHr) ? 'avgHr' : Number.isFinite(efforts[0].avgWatts) ? 'avgWatts' : 'speedMs';
  const avgOf = (arr) => {
    const vals = arr.map((l) => l[metric]).filter(Number.isFinite);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };

  return {
    repetitions: efforts.length,
    effortDurationS: medEffort,
    recoveryDurationS: recoveries.length ? median(recoveries.map((l) => l.durationS)) : null,
    effortIntensity: avgOf(efforts),
    recoveryIntensity: recoveries.length ? avgOf(recoveries) : null,
    metric,
  };
}

/**
 * Point d'entrée principal, appelé depuis analyzeStravaActivity (lib/gemini.js).
 * Renvoie un bloc de TEXTE prêt à injecter dans le prompt IA — jamais du JSON
 * brut : un LLM raisonne mieux sur une description déjà structurée en phrases
 * que sur un dump de dizaines de chiffres, et ça évite de gonfler le prompt
 * inutilement. Renvoie null si les laps ne permettent aucune analyse utile
 * (absents, ou un seul lap = pas de découpage réel).
 * `sportType` détermine l'unité de vitesse affichée (allure en course/nage,
 * km/h en vélo).
 */
export function describeLaps(rawLaps, sportType = '') {
  if (!Array.isArray(rawLaps) || rawLaps.length < 2) return null;

  const laps = rawLaps.map(normalizeLap);
  const metric = pickIntensityMetric(laps);
  const classified = classifyLaps(laps, metric);
  const pattern = detectIntervalPattern(classified);

  const isBike = /ride|bike|cycl/i.test(sportType);
  const speedLabel = (speedMs) => {
    if (!Number.isFinite(speedMs) || speedMs <= 0) return null;
    return isBike ? `${(speedMs * 3.6).toFixed(1)}km/h` : formatPace(speedMs);
  };

  const lines = [`Découpage en ${laps.length} laps (tours) fournis par Strava.`];

  if (pattern) {
    const unit = pattern.metric === 'avgHr' ? 'bpm' : pattern.metric === 'avgWatts' ? 'W' : null;
    const effortStr = unit ? `${Math.round(pattern.effortIntensity)} ${unit}` : speedLabel(pattern.effortIntensity) || 'intensité non mesurée';
    const recoveryStr = pattern.recoveryIntensity != null ? (unit ? `${Math.round(pattern.recoveryIntensity)} ${unit}` : speedLabel(pattern.recoveryIntensity)) : null;
    lines.push(
      `Structure fractionnée détectée : ${pattern.repetitions} répétitions d'effort d'environ ${formatDuration(pattern.effortDurationS)} chacune, à ~${effortStr} en moyenne` +
        (pattern.recoveryDurationS
          ? `, séparées de récupérations d'environ ${formatDuration(pattern.recoveryDurationS)}${recoveryStr ? ` (~${recoveryStr})` : ''}.`
          : ', sans phase de récupération distincte identifiée entre les répétitions.')
    );
  } else {
    lines.push('Pas de structure fractionnée régulière détectée (durées/intensités des laps trop variables, ou pas assez de laps pour un pattern fiable) : allure/effort à interpréter lap par lap ci-dessous.');
  }

  lines.push('Détail par lap (FC/puissance/cadence : seulement quand mesurées) :');
  classified.forEach((l) => {
    const parts = [`Lap ${l.index}`, formatDuration(l.durationS)];
    if (l.distanceM) parts.push(`${(l.distanceM / 1000).toFixed(2)}km`);
    const speed = speedLabel(l.speedMs);
    if (speed) parts.push(speed);
    if (Number.isFinite(l.avgHr)) parts.push(`${Math.round(l.avgHr)}bpm`);
    if (Number.isFinite(l.avgWatts)) parts.push(`${Math.round(l.avgWatts)}W`);
    if (Number.isFinite(l.avgCadence)) parts.push(`cad.${Math.round(l.avgCadence)}`);
    if (l.elevGainM) parts.push(`D+${Math.round(l.elevGainM)}m`);
    if (l.role) parts.push(`[${l.role}]`);
    lines.push(`- ${parts.join(' · ')}`);
  });

  return lines.join('\n');
}
