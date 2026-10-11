// lib/activityFacts.js
//
// FAITS CHIFFRÉS d'une activité Strava, calculés par l'app (jamais par l'IA) et situés dans
// les ZONES DE L'ATHLÈTE (zones personnalisées si elles existent et sont plausibles, sinon
// zones par défaut depuis FTP / FC max / VMA). Ils servent de base au retour de séance : l'IA
// rédige à partir de ces faits au lieu d'estimer elle-même l'intensité.

import {
  defaultHrZones, defaultPowerZones, defaultPaceZones, zoneForValue,
  isPlausibleHrZones, isPlausiblePowerZones, isPlausiblePaceZones,
} from './zones';

const BIKE = /ride|bike|cycl|vélo/i;
const RUN = /run|trail|walk|hike/i;
const SWIM = /swim|nat/i;

export function activityDiscipline(activity) {
  const t = String(activity?.sport_type || activity?.type || '');
  if (SWIM.test(t)) return 'NATATION';
  if (BIKE.test(t)) return 'CYCLISME';
  if (RUN.test(t)) return 'C.A.P';
  return null;
}

function fmtPace(speedKmh) {
  if (!speedKmh) return null;
  const secPerKm = Math.round(3600 / speedKmh);
  return `${Math.floor(secPerKm / 60)}:${String(secPerKm % 60).padStart(2, '0')}/km`;
}

/**
 * @param {object} activity  ligne strava_activities (distance_m, moving_time_s, average_watts…)
 * @param {object} profile   profil (ftp, fcMax, vma)
 * @param {object} zones     { hrZones, hrZonesBike, powerZones, powerZonesBike, paceZones } (facultatif)
 * @returns {string[]} lignes de faits, prêtes pour le prompt
 */
export function describeActivityFacts(activity, profile = {}, zones = {}) {
  const lines = [];
  const disc = activityDiscipline(activity);
  const min = activity?.moving_time_s ? Math.round(activity.moving_time_s / 60) : null;
  const km = activity?.distance_m ? Math.round(activity.distance_m / 100) / 10 : null;
  lines.push(`Discipline : ${disc || activity?.sport_type || '?'} · durée en mouvement ${min != null ? `${Math.floor(min / 60) ? `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}` : `${min} min`}` : 'N/A'} · distance ${km != null ? `${km} km` : 'N/A'}${activity?.total_elevation_m ? ` · D+ ${Math.round(activity.total_elevation_m)} m` : ''}`);

  const ftp = Number(profile?.ftp) || null;
  if (disc === 'CYCLISME' && activity?.average_watts) {
    const avg = Math.round(activity.average_watts);
    const custom = zones.powerZonesBike || zones.powerZones;
    const pz = isPlausiblePowerZones?.(custom) ? custom : (ftp ? defaultPowerZones(ftp) : null);
    const z = pz ? zoneForValue(pz, avg) : null;
    lines.push(`Puissance moyenne ${avg} W${ftp ? ` = ${Math.round((avg / ftp) * 100)} % de la FTP (${ftp} W)` : ''}${z ? ` → ${z.zone} ${z.label}` : ''}${activity?.max_watts ? ` · max ${Math.round(activity.max_watts)} W` : ''}`);
  }

  if (disc === 'C.A.P' && activity?.average_speed_ms) {
    const kmh = activity.average_speed_ms * 3.6;
    const custom = zones.paceZones;
    const vma = Number(profile?.vma) || null;
    const pz = isPlausiblePaceZones?.(custom) ? custom : (vma ? defaultPaceZones(vma) : null);
    const z = pz ? zoneForValue(pz, kmh) : null;
    lines.push(`Allure moyenne ${fmtPace(kmh)} (${kmh.toFixed(1)} km/h)${z ? ` → ${z.zone} ${z.label}` : ''}`);
  }

  if (activity?.average_heartrate) {
    const hr = Math.round(activity.average_heartrate);
    const custom = disc === 'CYCLISME' ? (zones.hrZonesBike || zones.hrZones) : zones.hrZones;
    const fcMax = Number(profile?.fcMax) || null;
    const hz = isPlausibleHrZones?.(custom) ? custom : (fcMax ? defaultHrZones(fcMax) : null);
    const z = hz ? zoneForValue(hz, hr) : null;
    lines.push(`FC moyenne ${hr} bpm${z ? ` → ${z.zone} ${z.label}` : ''}${activity?.max_heartrate ? ` · max ${Math.round(activity.max_heartrate)} bpm` : ''}`);
  }
  return lines;
}
