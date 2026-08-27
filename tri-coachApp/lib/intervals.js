// lib/intervals.js
//
// ANALYSE PAR INTERVALLES d'une activité Strava (demande explicite de l'athlète,
// 27/08/2026) : jusqu'ici, l'analyse IA prévu/réalisé (voir analyzeStravaActivity,
// lib/gemini.js) ne recevait que les MOYENNES de toute la séance (vitesse moyenne,
// FC moyenne, puissance moyenne...) — pour une séance fractionnée (ex: 3x10min au
// seuil avec récup entre les blocs), une moyenne lisse tout et rend impossible de
// dire ce qui a été réellement fait ("tu as fait du 3x10min au seuil" nécessite de
// voir les BLOCS, pas juste la moyenne du 45 minutes total qui mélange effort et
// récup). Ce fichier segmente les streams seconde-par-seconde (voir
// pages/api/strava/streams.js) en intervalles homogènes, 100% déterministe (aucun
// appel IA ici) : c'est ce découpage qui est ensuite donné en contexte à l'IA
// (voir buildIntervalPromptBlock plus bas) pour qu'elle raisonne sur les VRAIS
// blocs plutôt que de deviner depuis une moyenne globale.
//
// Méthode (volontairement simple et déterministe, pas de ML) :
//   1. Lissage léger (moyenne glissante) du signal "effort" principal — vitesse
//      pour la course, puissance pour le vélo (repli sur la vitesse si pas de
//      capteur de puissance) — pour ignorer le bruit GPS/capteur sample-à-sample.
//   2. Classement de CHAQUE échantillon lissé dans une zone (Z1-Z5) via
//      zoneForValue (lib/zones.js), avec les zones de l'athlète si connues, sinon
//      un repli théorique (VMA/FTP déclarée, voir lib/zones.js:defaultPaceZones/
//      defaultPowerZones).
//   3. Fusion des échantillons consécutifs de MÊME zone en segments bruts, puis
//      fusion des segments trop courts (< MIN_SEGMENT_SECONDS, transitions/bruit)
//      dans le segment voisin le plus proche en valeur — jamais un micro-segment
//      de quelques secondes présenté comme un "intervalle".
//   4. Pour chaque segment final : durée, vitesse/allure moyenne RÉELLE (pas la
//      valeur lissée, pour ne jamais afficher un chiffre artificiellement arrondi
//      par le lissage), watts/FC/cadence moyens si les streams existent, et zone.
//   5. Détection d'un PATRON répété (ex: "3 x 10min Z4") : regroupe les segments
//      d'effort (zone >= Z3) de durée similaire (tolérance 20%) séparés par des
//      segments de récup (zone <= Z2), et ne remonte le patron que s'il apparaît
//      au moins 2 fois — sinon on donne juste la liste des segments telle quelle,
//      sans forcer un patron qui n'existe pas.
//
// Comme lib/physiology.js/lib/zones.js : jamais de valeur inventée — si un stream
// est absent (ex: pas de capteur de puissance), le champ correspondant est
// simplement omis du segment plutôt que rempli avec une estimation fictive.

import { ZONE_META, zoneForValue, defaultPaceZones, defaultPowerZones } from './zones';

const MIN_SEGMENT_SECONDS = 45; // en dessous : considéré comme bruit/transition, fusionné au voisin
const SMOOTH_WINDOW = 15; // échantillons (streams Strava ~1/s -> lissage ~15s)
const PATTERN_DURATION_TOLERANCE = 0.2; // 20% : deux blocs de "même" durée pour former un patron répété

function movingAverage(values, window) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  let count = 0;
  const buffer = [];
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    if (Number.isFinite(v)) {
      buffer.push(v);
      sum += v;
      count += 1;
    } else {
      buffer.push(null);
    }
    if (buffer.length > window) {
      const removed = buffer.shift();
      if (Number.isFinite(removed)) {
        sum -= removed;
        count -= 1;
      }
    }
    out[i] = count > 0 ? sum / count : null;
  }
  return out;
}

function average(values) {
  const nums = values.filter((v) => Number.isFinite(v));
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function formatPaceLabel(kmh) {
  if (!Number.isFinite(kmh) || kmh <= 0) return null;
  const minPerKm = 60 / kmh;
  const min = Math.floor(minPerKm);
  const sec = Math.round((minPerKm - min) * 60);
  return `${min}:${String(sec).padStart(2, '0')} /km`;
}

function formatDuration(seconds) {
  const total = Math.round(seconds);
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return min > 0 ? `${min}min${sec ? String(sec).padStart(2, '0') : ''}` : `${sec}s`;
}

/**
 * Segmente les streams d'UNE activité en intervalles homogènes. `discipline` vaut
 * 'run' ou 'bike' (voir lib/stravaClient.js:stravaSportToDiscipline) — détermine le
 * signal d'effort principal (vitesse vs puissance) et le jeu de zones à utiliser.
 * `zones` : jeu de zones de l'athlète déjà résolu (paceZones ou powerZones, voir
 * lib/zones.js:resolveSeedZones côté appelant) — repli théorique sur `vma`/`ftp` si
 * absent. Renvoie `null` si le stream principal est absent ou trop court pour être
 * segmenté (activité < 2 minutes, ou capteur absent) : dans ce cas l'appelant doit
 * se rabattre sur les moyennes globales, comme avant cette fonctionnalité.
 */
export function detectIntervals({ streams, discipline, zones, vma, ftp }) {
  const time = streams?.time?.data;
  if (!Array.isArray(time) || time.length < 30) return null;

  const speedRaw = streams?.velocity_smooth?.data?.map((v) => (Number.isFinite(v) ? v * 3.6 : null)) || null;
  const wattsRaw = streams?.watts?.data || null;
  const hrRaw = streams?.heartrate?.data || null;
  const cadenceRaw = streams?.cadence?.data || null;

  // Signal d'effort principal : puissance pour le vélo (si capteur présent, sinon
  // repli vitesse), vitesse pour la course. Jamais la FC comme signal PRINCIPAL de
  // segmentation : la FC dérive avec retard (inertie cardiaque) et découperait les
  // intervalles avec un décalage temporel par rapport à l'effort réellement produit.
  const useWatts = discipline === 'bike' && Array.isArray(wattsRaw) && wattsRaw.some((v) => Number.isFinite(v) && v > 0);
  const primaryRaw = useWatts ? wattsRaw : speedRaw;
  if (!Array.isArray(primaryRaw) || primaryRaw.length < 30) return null;

  const effectiveZones = zones && zones.length
    ? [...zones].sort((a, b) => Number(a.min) - Number(b.min))
    : useWatts
      ? defaultPowerZones(ftp)
      : defaultPaceZones(vma);

  const smoothed = movingAverage(primaryRaw, SMOOTH_WINDOW);

  // 1) Classement zone par échantillon, puis fusion des échantillons consécutifs de
  // même zone en segments bruts (index de début/fin dans les streams).
  const rawSegments = [];
  let currentZone = null;
  let segStart = 0;
  for (let i = 0; i < smoothed.length; i += 1) {
    const z = Number.isFinite(smoothed[i]) ? zoneForValue(effectiveZones, smoothed[i]) : null;
    const zoneKey = z?.zone || null;
    if (zoneKey !== currentZone) {
      if (currentZone !== null) rawSegments.push({ zone: currentZone, startIdx: segStart, endIdx: i - 1 });
      currentZone = zoneKey;
      segStart = i;
    }
  }
  if (currentZone !== null) rawSegments.push({ zone: currentZone, startIdx: segStart, endIdx: smoothed.length - 1 });

  // 2) Fusion des segments trop courts (bruit/transition) dans le voisin le plus
  // proche en valeur moyenne — jamais affichés comme un intervalle à part entière.
  // Répété jusqu'à stabilisation (une fusion peut rendre un voisin devenu trop
  // court éligible à son tour, cas rare mais possible sur un signal très bruité).
  let segments = rawSegments;
  let mergedSomething = true;
  while (mergedSomething && segments.length > 1) {
    mergedSomething = false;
    const next = [];
    for (let i = 0; i < segments.length; i += 1) {
      const seg = segments[i];
      const durationSec = time[seg.endIdx] - time[seg.startIdx];
      if (durationSec >= MIN_SEGMENT_SECONDS || segments.length === 1) {
        next.push(seg);
        continue;
      }
      // Fusionne avec le voisin dont la moyenne d'effort est la plus proche —
      // reflète mieux la réalité qu'un choix systématique "toujours le précédent".
      const prevSeg = next[next.length - 1];
      const nextSeg = segments[i + 1];
      const segAvg = average(primaryRaw.slice(seg.startIdx, seg.endIdx + 1));
      const prevAvg = prevSeg ? average(primaryRaw.slice(prevSeg.startIdx, prevSeg.endIdx + 1)) : null;
      const nextAvg = nextSeg ? average(primaryRaw.slice(nextSeg.startIdx, nextSeg.endIdx + 1)) : null;
      const distTo = (a) => (Number.isFinite(a) && Number.isFinite(segAvg) ? Math.abs(a - segAvg) : Infinity);
      if (prevSeg && (!nextSeg || distTo(prevAvg) <= distTo(nextAvg))) {
        prevSeg.endIdx = seg.endIdx;
      } else if (nextSeg) {
        segments[i + 1] = { ...nextSeg, startIdx: seg.startIdx };
      } else if (prevSeg) {
        prevSeg.endIdx = seg.endIdx;
      } else {
        next.push(seg);
      }
      mergedSomething = true;
    }
    segments = next;
  }

  // 3) Stats RÉELLES (non lissées) par segment final.
  const finalSegments = segments.map((seg, idx) => {
    const sliceSpeed = speedRaw ? speedRaw.slice(seg.startIdx, seg.endIdx + 1) : null;
    const sliceWatts = wattsRaw ? wattsRaw.slice(seg.startIdx, seg.endIdx + 1) : null;
    const sliceHr = hrRaw ? hrRaw.slice(seg.startIdx, seg.endIdx + 1) : null;
    const sliceCadence = cadenceRaw ? cadenceRaw.slice(seg.startIdx, seg.endIdx + 1) : null;
    const durationSec = Math.max(1, time[seg.endIdx] - time[seg.startIdx]);
    const avgSpeedKmh = sliceSpeed ? average(sliceSpeed) : null;
    const zoneMeta = ZONE_META.find((z) => z.zone === seg.zone) || null;
    return {
      index: idx,
      zone: seg.zone,
      zoneLabel: zoneMeta?.label || seg.zone || '-',
      startMin: Math.round((time[seg.startIdx] / 60) * 10) / 10,
      endMin: Math.round((time[seg.endIdx] / 60) * 10) / 10,
      durationSec: Math.round(durationSec),
      durationLabel: formatDuration(durationSec),
      avgSpeedKmh: avgSpeedKmh != null ? Math.round(avgSpeedKmh * 100) / 100 : null,
      avgPaceLabel: !useWatts ? formatPaceLabel(avgSpeedKmh) : null,
      avgWatts: sliceWatts ? Math.round(average(sliceWatts) || 0) || null : null,
      avgHr: sliceHr ? Math.round(average(sliceHr) || 0) || null : null,
      avgCadence: sliceCadence ? Math.round(average(sliceCadence) || 0) || null : null,
    };
  });

  return { segments: finalSegments, primaryMetric: useWatts ? 'power' : 'pace' };
}

/**
 * Détecte un patron répété du type "N x Ymin en <zone>" parmi les segments détectés
 * ci-dessus : segments d'effort (zone >= Z3) de durée similaire (tolérance 20%),
 * séparés par des segments de récup (zone <= Z2 ou repos), apparaissant au moins 2
 * fois. Renvoie `null` si aucun patron net ne se dégage (ex: sortie continue, ou
 * fractionné trop irrégulier pour être résumé en une formule) — dans ce cas l'IA
 * reçoit la liste des segments bruts et doit décrire la séance elle-même, sans
 * formule toute faite qui serait fausse.
 */
export function detectRepeatedPattern(segments) {
  if (!Array.isArray(segments) || segments.length < 3) return null;
  const effortZones = new Set(['Z3', 'Z4', 'Z5']);
  const workSegments = segments.filter((s) => effortZones.has(s.zone) && s.durationSec >= MIN_SEGMENT_SECONDS);
  if (workSegments.length < 2) return null;

  // Regroupe les blocs d'effort par durée "similaire" (tolérance 20%), en gardant le
  // groupe le plus fourni — c'est le patron le plus représentatif de la séance.
  const groups = [];
  for (const seg of workSegments) {
    let group = groups.find((g) => Math.abs(g.avgDuration - seg.durationSec) / g.avgDuration <= PATTERN_DURATION_TOLERANCE);
    if (!group) {
      group = { segs: [], avgDuration: seg.durationSec };
      groups.push(group);
    }
    group.segs.push(seg);
    group.avgDuration = average(group.segs.map((s) => s.durationSec));
  }
  const bestGroup = groups.reduce((best, g) => (g.segs.length > (best?.segs.length || 0) ? g : best), null);
  if (!bestGroup || bestGroup.segs.length < 2) return null;

  const reps = bestGroup.segs.length;
  const avgDurationLabel = formatDuration(bestGroup.avgDuration);
  const zoneCounts = bestGroup.segs.reduce((acc, s) => {
    acc[s.zone] = (acc[s.zone] || 0) + 1;
    return acc;
  }, {});
  const dominantZone = Object.entries(zoneCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || bestGroup.segs[0].zone;
  const zoneMeta = ZONE_META.find((z) => z.zone === dominantZone);
  const avgPace = average(bestGroup.segs.map((s) => s.avgSpeedKmh).filter(Number.isFinite));
  const avgWatts = average(bestGroup.segs.map((s) => s.avgWatts).filter(Number.isFinite));

  return {
    reps,
    durationLabel: avgDurationLabel,
    zone: dominantZone,
    zoneLabel: zoneMeta?.label || dominantZone,
    avgPaceLabel: avgPace ? formatPaceLabel(avgPace) : null,
    avgWatts: Number.isFinite(avgWatts) ? Math.round(avgWatts) : null,
    label: `${reps} x ${avgDurationLabel} en ${dominantZone}${zoneMeta ? ` (${zoneMeta.label})` : ''}`,
  };
}

/**
 * Construit le bloc texte injecté dans le prompt IA (voir analyzeStravaActivity,
 * lib/gemini.js) : liste des intervalles détectés + patron répété si identifié.
 * Volontairement en dehors de gemini.js pour rester réutilisable par la co-génération
 * (Gemini ET Groq reçoivent EXACTEMENT le même bloc, voir lib/coGeneration.js).
 */
export function buildIntervalPromptBlock({ segments, primaryMetric }, pattern) {
  if (!segments || !segments.length) return '';
  const lines = segments.map((s) => {
    const parts = [`${s.startMin}-${s.endMin}min (${s.durationLabel})`, s.zone];
    if (primaryMetric === 'pace' && s.avgPaceLabel) parts.push(s.avgPaceLabel);
    if (s.avgWatts) parts.push(`${s.avgWatts}W`);
    if (s.avgHr) parts.push(`${s.avgHr}bpm`);
    if (s.avgCadence) parts.push(`cad. ${s.avgCadence}`);
    return `- ${parts.join(' · ')}`;
  });
  const patternLine = pattern ? `\nPatron détecté automatiquement (calcul déterministe, à confirmer/nuancer si besoin) : ${pattern.label}.` : '';
  return `Découpage RÉEL de la séance en intervalles homogènes (calculé depuis les données seconde-par-seconde Strava, pas une estimation) :\n${lines.join('\n')}${patternLine}`;
}
