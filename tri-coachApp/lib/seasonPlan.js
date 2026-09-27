// lib/seasonPlan.js
//
// CONTEXTE D'UNE SEMAINE DE LA SAISON — source unique de vérité pour le prompt, le
// validateur, les garde-fous et l'affichage. Pour n'importe quel lundi, renvoie la phase,
// la nature de la semaine, son volume cible, le nombre de séances attendu et les jours de
// course.
//
// Ce que ce module corrige (constaté en simulant 4 200 questionnaires et une saison entière) :
//   - après la date d'objectif, l'app restait en « affûtage » indéfiniment (semaines à 100 %
//     du volume en juillet pour une course fin juin) → récupération puis transition ;
//   - la semaine de course n'était pas identifiée (aucun jour J, aucun lendemain) ;
//   - le cycle charge/décharge continuait pendant l'affûtage (double réduction) → suspendu ;
//   - le volume cible était le même d'octobre à avril → progression par paliers :
//       · phase de base : montée de 85 % à 100 % (aucune montée si l'athlète a déjà une base) ;
//       · dans un cycle, paliers de charge (3:1 → 90 / 95 / 100 %) puis décharge à 70 % ;
//       · affûtage : 85 % → 75 % → 60 % à l'approche ; semaine de course 45 % ;
//       · après la course : 40 %, 60 %, puis transition à 70 % en attendant un nouvel objectif.
//   Ces coefficients sont des repères d'entraînement courants (progressivité, semaine
//   allégée régulière, affûtage), pas des valeurs issues d'une étude précise : ils sont
//   regroupés ici pour être ajustés facilement.

import { buildPeriodizationPlan } from './periodization';
import { LOAD_PATTERNS, DECHARGE_VOLUME_RATIO, mondayIso, addWeeksIso, parseIsoUTC } from './trainingCycle';
import { DAYS_OF_WEEK } from './defaults';

const DAY_MS = 86_400_000;

/**
 * Calcule la phase EN COURS en ancrant la périodisation sur la date de DÉBUT du plan.
 * CORRECTIF : avant, la structure macro était recalculée depuis "aujourd'hui" à chaque
 * régénération — la phase de base se ré-étalait sur les semaines restantes au lieu
 * d'avancer, et l'athlète restait en "base" bien trop longtemps.
 */
export function resolvePhase(targetDate, planStartDate, today) {
  const start = planStartDate && !Number.isNaN(new Date(planStartDate).getTime()) ? new Date(planStartDate) : today;
  const anchor = start > today ? today : start;
  const plan = buildPeriodizationPlan(targetDate, anchor);
  const todayIso = today.toISOString().slice(0, 10);
  const phases = plan.phases.map((p) => ({
    ...p,
    status: todayIso > p.endDate ? 'Terminé' : todayIso >= p.startDate ? 'En cours' : 'À venir',
  }));
  const current = phases.find((p) => p.status === 'En cours') || phases[phases.length - 1] || plan.currentPhase;
  const weeksLeft = Math.max(1, Math.ceil((new Date(targetDate).getTime() - today.getTime()) / (7 * 86_400_000)));
  return { phases, current, weeksLeft };
}

const STEP_LOADING = { 1: [1], 2: [0.95, 1], 3: [0.9, 0.95, 1] };
const TAPER_FACTORS = { 1: 0.6, 2: 0.75 }; // semaines avant la course → coefficient (au-delà : 0.85)
export const RACE_WEEK_FACTOR = 0.45;
const POST_RACE = [
  { kind: 'recovery', factor: 0.4, label: 'semaine de RÉCUPÉRATION post-course' },
  { kind: 'recovery', factor: 0.6, label: 'semaine de RÉCUPÉRATION post-course (reprise douce)' },
];
const TRANSITION = { kind: 'transition', factor: 0.7, label: 'semaine de TRANSITION (objectif passé, en attente du prochain)' };

function weeksBetween(aIso, bIso) {
  return Math.round((parseIsoUTC(mondayIso(bIso)) - parseIsoUTC(mondayIso(aIso))) / (7 * DAY_MS));
}

function dayNameOf(iso) {
  const t = parseIsoUTC(iso);
  return DAYS_OF_WEEK[(new Date(t).getUTCDay() + 6) % 7];
}

function round1(x) {
  return Math.round(x * 10) / 10;
}

/** Courses du calendrier (priorités A/B/C) tombant dans la semaine commençant à `mondayIso`. */
export function racesInWeek(raceCalendar, weekMonday) {
  const end = addWeeksIso(weekMonday, 1);
  return (raceCalendar || [])
    .filter((r) => r && /^\d{4}-\d{2}-\d{2}/.test(String(r.date || '')) && r.date.slice(0, 10) >= weekMonday && r.date.slice(0, 10) < end)
    .map((r) => ({ name: String(r.name || 'Course').slice(0, 60), date: r.date.slice(0, 10), day: dayNameOf(r.date.slice(0, 10)), priority: r.priority || 'B' }));
}

/**
 * @param {object} p
 * @param {object} p.wizardData     contraintes (hoursPerWeek, maxSessionsPerWeek, targetDate, loadCycle, hasExistingTrainingBase, eventName…)
 * @param {string} p.planStartDate  début du plan (ancre de la périodisation)
 * @param {string} p.weekMonday     lundi ISO de la semaine
 * @param {Array}  [p.raceCalendar] autres courses
 */
export function computeWeekContext({ wizardData = {}, planStartDate, weekMonday, raceCalendar = [] }) {
  const hours = Number(wizardData.hoursPerWeek) || null;
  const sessions = Number(wizardData.maxSessionsPerWeek) || null;
  const target = String(wizardData.targetDate || '').slice(0, 10);
  const monday = mondayIso(weekMonday);
  const otherRaces = racesInWeek(raceCalendar, monday);
  const base = { weekMonday: monday, otherRaces, raceDay: null, raceDate: null };
  const out = (o) => ({
    ...base,
    ...o,
    hours: hours ? round1(hours * o.factor) : null,
    // Nombre de séances imposé seulement pour les semaines "normales" : une semaine de course,
    // de récupération ou de transition en compte naturellement moins (null = maximum seulement).
    sessionsTarget: o.exactSessions && !otherRaces.length ? sessions : null,
    maxSessions: sessions,
  });

  if (/^\d{4}-\d{2}-\d{2}$/.test(target)) {
    const diff = weeksBetween(monday, target); // >0 : semaines avant la course
    if (diff === 0) {
      return out({ kind: 'race', phaseKey: 'taper', phaseName: 'Semaine de course', factor: RACE_WEEK_FACTOR, label: 'SEMAINE DE COURSE', raceDay: dayNameOf(target), raceDate: target, exactSessions: false });
    }
    if (diff < 0) {
      const after = -diff; // 1 = semaine suivant la course
      const post = after <= POST_RACE.length ? POST_RACE[after - 1] : TRANSITION;
      return out({ ...post, phaseKey: 'recovery', phaseName: post.kind === 'transition' ? 'Transition' : 'Récupération post-course', exactSessions: false });
    }
  }

  const refDate = new Date(`${monday}T12:00:00Z`);
  const { current } = /^\d{4}-\d{2}-\d{2}$/.test(target)
    ? resolvePhase(target, planStartDate, refDate)
    : { current: { key: 'base', name: 'Base', startDate: planStartDate, endDate: null } };
  const phaseKey = current?.key || 'base';

  if (phaseKey === 'taper') {
    const toRace = weeksBetween(monday, target);
    const factor = TAPER_FACTORS[toRace] || 0.85;
    return out({ kind: 'taper', phaseKey, phaseName: current?.name, factor, label: `semaine d'AFFÛTAGE (J-${toRace * 7} environ)`, exactSessions: true });
  }

  // Progression de la phase de base : 85 % → 100 % (95 % → 100 % avec une base existante).
  let macro = 1;
  if (phaseKey === 'base' && current?.startDate && current?.endDate) {
    const start = parseIsoUTC(current.startDate);
    const end = parseIsoUTC(current.endDate);
    const t = parseIsoUTC(monday);
    const progress = end > start ? Math.min(1, Math.max(0, (t - start) / (end - start))) : 1;
    // Un athlète qui a déjà une base d'entraînement structurée ne repart pas en dessous de
    // son volume : pas de montée, seuls les paliers de charge du cycle font varier le volume.
    const from = wizardData.hasExistingTrainingBase ? 1 : 0.85;
    macro = from + (1 - from) * progress;
  }

  const conf = LOAD_PATTERNS[wizardData.loadCycle?.pattern];
  if (conf && wizardData.loadCycle.pattern !== 'none' && wizardData.loadCycle.anchor) {
    const length = conf.charge + conf.decharge;
    const d = weeksBetween(wizardData.loadCycle.anchor, monday);
    const index = (((d % length) + length) % length) + 1;
    if (index > conf.charge) {
      return out({ kind: 'decharge', index, phaseKey, phaseName: current?.name, factor: round1(macro * DECHARGE_VOLUME_RATIO * 100) / 100, label: 'semaine de DÉCHARGE', exactSessions: true });
    }
    const step = (STEP_LOADING[conf.charge] || [1])[index - 1] ?? 1;
    return out({ kind: 'charge', index, phaseKey, phaseName: current?.name, factor: round1(macro * step * 100) / 100, label: `semaine de CHARGE ${index}/${conf.charge}`, exactSessions: true });
  }
  return out({ kind: 'normal', phaseKey, phaseName: current?.name, factor: round1(macro * 100) / 100, label: null, exactSessions: true });
}

/** Nombre de semaines écoulées depuis la date d'objectif (null si pas passée). */
export function weeksSinceTarget(targetDate, todayIso) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(String(targetDate || ''))) return null;
  const d = weeksBetween(String(targetDate).slice(0, 10), todayIso);
  return String(targetDate).slice(0, 10) < todayIso ? Math.max(0, d) : null;
}
