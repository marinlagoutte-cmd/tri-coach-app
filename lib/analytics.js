// lib/analytics.js
//
// RÈGLE (identique à lib/physiology.js) : on ne calcule QUE à partir de données
// réellement présentes dans l'app — le plan actuel (semaines N / N+1, les deux
// seules conservées en mémoire), l'historique de ressenti (feedbackHistory, réel et
// daté) et l'historique santé (healthHistory, réel et daté). Pas de génération d'un
// faux historique de plusieurs semaines qui n'existe pas côté données.
import { classifyDiscipline, parseDurationMinutes } from './workouts';
import { vmaPercentForDistance } from './physiology';

const DISCIPLINE_COLOR = { NATATION: '#22D3EE', CYCLISME: '#60A5FA', 'C.A.P': '#FB923C' };

/** Volume (en heures) par discipline, pour chaque semaine réellement en mémoire (N, N+1). */
export function computeWeeklyDurationByDiscipline(workouts) {
  const weekKeys = Object.keys(workouts || {}).filter((k) => Array.isArray(workouts[k]));
  // Ordre stable : N avant N+1 avant N+2...
  weekKeys.sort((a, b) => {
    const na = a === 'N' ? 0 : Number(String(a).replace('N+', '')) || 0;
    const nb = b === 'N' ? 0 : Number(String(b).replace('N+', '')) || 0;
    return na - nb;
  });

  const disciplines = ['NATATION', 'CYCLISME', 'C.A.P'];
  const series = Object.fromEntries(disciplines.map((d) => [d, []]));

  weekKeys.forEach((key) => {
    const totals = Object.fromEntries(disciplines.map((d) => [d, 0]));
    (workouts[key] || []).forEach((w) => {
      const disc = classifyDiscipline(w.type);
      if (disc && totals[disc] !== undefined) totals[disc] += parseDurationMinutes(w.duration);
    });
    disciplines.forEach((d) => series[d].push(Math.round((totals[d] / 60) * 10) / 10));
  });

  return {
    labels: weekKeys.map((k) => (k === 'N' ? 'Semaine en cours' : `Semaine ${k}`)),
    disciplines: disciplines.map((d) => ({ key: d, label: d === 'C.A.P' ? 'Course' : d === 'CYCLISME' ? 'Vélo' : 'Natation', color: DISCIPLINE_COLOR[d] })),
    series,
  };
}

const ZONE_META = [
  { zone: 'Z1', label: 'Récupération', color: '#6B7280' },
  { zone: 'Z2', label: 'Aérobie', color: '#34D399' },
  { zone: 'Z3', label: 'Tempo', color: '#FBBF24' },
  { zone: 'Z4', label: 'Seuil', color: '#FB923C' },
  { zone: 'Z5', label: 'VO2 Max', color: '#F87171' },
];

/**
 * Répartition du temps (minutes) par zone d'intensité pour une semaine donnée
 * (tableau de séances), déduite du champ `cardio` de chaque séance ("Z2",
 * "Z3-Z4", "< 55 bpm"...). Si une séance couvre 2 zones, son temps est réparti
 * à parts égales entre les zones concernées (on ne devine pas laquelle domine).
 */
export function computeZoneMinutes(weekWorkouts) {
  const minutesByZone = { Z1: 0, Z2: 0, Z3: 0, Z4: 0, Z5: 0 };
  (weekWorkouts || []).forEach((w) => {
    if (classifyDiscipline(w.type) === 'REPOS') return;
    const duration = parseDurationMinutes(w.duration);
    if (!duration) return;
    const match = String(w.cardio || '').match(/Z\s*([1-5])(?:\s*-\s*Z?\s*([1-5]))?/i);
    if (!match) {
      // Pas de zone identifiable (ex: "< 55 bpm" sur une séance de repos actif) :
      // on ne devine pas — cette séance n'est simplement pas comptée dans la
      // répartition plutôt que de lui affecter une zone arbitraire.
      return;
    }
    const z1 = Number(match[1]);
    const z2 = match[2] ? Number(match[2]) : z1;
    const [lo, hi] = z1 <= z2 ? [z1, z2] : [z2, z1];
    const span = hi - lo + 1;
    for (let z = lo; z <= hi; z += 1) {
      minutesByZone[`Z${z}`] += duration / span;
    }
  });

  const total = Object.values(minutesByZone).reduce((a, b) => a + b, 0);
  return ZONE_META.map((meta) => ({
    ...meta,
    minutes: Math.round(minutesByZone[meta.zone]),
    pct: total > 0 ? Math.round((minutesByZone[meta.zone] / total) * 100) : 0,
  }));
}

/**
 * Série "charge & forme ressenties" à partir de feedbackHistory (réel, daté,
 * rempli par l'athlète après chaque séance validée). C'est l'équivalent honnête
 * d'une charge d'entraînement : l'app n'a pas accès à un TSS/CTL/ATL calculé sur
 * données capteur (puissance/FC réelles), donc on affiche ce qu'on a vraiment —
 * la difficulté et la forme perçues, dans le temps.
 */
export function computeFeedbackTrendSeries(feedbackHistory) {
  const sorted = [...(feedbackHistory || [])]
    .filter((f) => f && f.timestamp)
    .sort((a, b) => a.timestamp - b.timestamp);
  return {
    labels: sorted.map((f) => new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short' }).format(new Date(f.timestamp))),
    difficulty: sorted.map((f) => f.difficulty ?? null),
    capacity: sorted.map((f) => f.capacity ?? null),
  };
}

function lastTwoValues(healthHistory, metricKey) {
  const points = (healthHistory || [])
    .filter((h) => h.metric === metricKey)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  const latest = points[points.length - 1]?.value ?? null;
  const previous = points[points.length - 2]?.value ?? null;
  return { latest, previous, delta: latest !== null && previous !== null ? Math.round((latest - previous) * 100) / 100 : null };
}

function formatPaceMinPerKm(kmh) {
  if (!kmh || kmh <= 0) return null;
  const minPerKm = 60 / kmh;
  const min = Math.floor(minPerKm);
  const sec = Math.round((minPerKm - min) * 60);
  return `${min}'${String(sec).padStart(2, '0')}"/km`;
}

/**
 * Métriques clés du profil + delta réel vs la mesure précédente (healthHistory).
 * VO2max et allure seuil sont des estimations dérivées d'une valeur réellement
 * mesurée (VMA) — même logique que lib/physiology.js — jamais inventées ex nihilo :
 * si la VMA n'est pas renseignée, ces deux lignes sont simplement omises.
 */
export function computeKeyMetrics(profile, healthHistory, sportType = 'triathlon') {
  const rows = [];

  if (sportType !== 'running' && profile.ftp) {
    const { delta } = lastTwoValues(healthHistory, 'ftp');
    rows.push({ label: 'FTP vélo', value: `${profile.ftp} W`, delta: delta ? `${delta > 0 ? '+' : ''}${delta} W` : null, positive: delta > 0 });
  }

  if (profile.vma) {
    const thresholdKmh = profile.vma * vmaPercentForDistance(10);
    const pace = formatPaceMinPerKm(thresholdKmh);
    const { delta } = lastTwoValues(healthHistory, 'vma');
    const deltaPace = delta ? formatPaceMinPerKm((profile.vma - delta) * vmaPercentForDistance(10)) : null;
    rows.push({
      label: 'Allure seuil course (estimée depuis la VMA)',
      value: pace,
      delta: delta && pace && deltaPace ? (thresholdKmh > (profile.vma - delta) * vmaPercentForDistance(10) ? 'plus rapide' : 'plus lent') : null,
      positive: delta > 0,
    });

    const vo2max = Math.round(profile.vma * 3.5 * 10) / 10;
    rows.push({
      label: 'VO2max estimé (depuis la VMA)',
      value: `${vo2max} mL/kg/min`,
      delta: delta ? `${delta > 0 ? '+' : ''}${Math.round(delta * 3.5 * 10) / 10}` : null,
      positive: delta > 0,
    });
  }

  if (sportType !== 'running' && profile.nat100) {
    rows.push({ label: 'Vitesse critique natation (déclarée)', value: `${profile.nat100} /100m`, delta: null });
  }

  if (profile.fcMax) {
    const { delta } = lastTwoValues(healthHistory, 'fcMax');
    rows.push({ label: 'FC maximale', value: `${profile.fcMax} bpm`, delta: delta ? `${delta > 0 ? '+' : ''}${delta} bpm` : 'stable', positive: delta < 0 });
  }

  if (profile.weight) {
    const { delta } = lastTwoValues(healthHistory, 'weight');
    rows.push({ label: 'Poids de forme', value: `${profile.weight} kg`, delta: delta ? `${delta > 0 ? '+' : ''}${delta} kg` : null, positive: delta < 0 });
  }

  return rows;
}
