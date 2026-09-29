// lib/coachPrompts.js
//
// CONSTRUCTION DES PROMPTS DU COACH IA.
//
// Remplace buildWorkoutSchema & co (lib/gemini.js), dont le prompt de ~28 000 caractères
// contenait des consignes contradictoires relevées pendant la revue :
//   - "EXACTEMENT 7 − N jours REPOS" → "-5 jours REPOS" pour 12 séances/semaine ;
//   - "MAXIMUM ABSOLU 2 séances/jour, JAMAIS 3" dans le prompt qui autorise la triple séance ;
//   - "une seule séance par jour" dans l'auto-vérification, alors que les jours doubles sont requis ;
//   - "jamais de pourcentage" suivi d'exemples "@85% VMA" ;
//   - "les zones tiennent déjà compte de la VMA de progression" alors qu'elles étaient
//     calculées sur la VMA actuelle ;
//   - deux "RÈGLE ABSOLUE N°2" différentes, et une dizaine de "ABSOLU" qui se diluent.
//
// Principes de la réécriture :
//   1. Instruction SYSTÈME stable (qui est le coach, principes, conventions de format) et
//      contenu UTILISATEUR variable (données de l'athlète) — séparés.
//   2. L'arithmétique est faite par le CODE (jours doubles nécessaires, fourchette de volume
//      en minutes, dates réelles des jours) : le modèle ne calcule plus, il applique.
//   3. Les règles du prompt sont EXACTEMENT celles vérifiées par lib/planValidation.js :
//      ce que l'IA lit est ce qui est contrôlé, rien de plus, rien de contradictoire.
//   4. Le format de sortie est imposé par schéma (lib/planSchema.js) : le prompt ne gaspille
//      plus de place à décrire le JSON.

import { DAYS_OF_WEEK } from './defaults';
import { resolveAthletePhysiology, applyFeedbackTrendToPhysiology, resolveTargetPhysiology } from './physiology';
import { summarizeFeedbackTrend, summarizeHrvTrend, summarizeSleepTrend } from './feedback';
import { describePhaseGuidance, summarizeUpcomingRaces } from './periodization';
import { resolvePhase, computeWeekContext } from './seasonPlan';
import { computeCurrentPhase } from './cycleTracking';
import { isTripleDayEligible, swimVolumeFloor, classifyDiscipline } from './workouts';
import { weekLoadInfo, weekHoursTarget, describeFocusAreas } from './trainingCycle';
import { normalizeSportType, hasBike, hasSwim, sportLabel } from './sport';
import { referenceWeekBlock } from './referenceWeeks';
import { swimPaceMinutes, realisticSwimMeters, weeklySwimTarget, longSwimTarget, swimMinimumMeters } from './swimPlanning';

const EXPERIENCE_RANK = { debutant: 1, novice: 2, intermediaire: 3, confirme: 4, expert: 5 };
const EXPERIENCE_LABELS = {
  debutant: 'débutant complet (jamais suivi de plan structuré)',
  novice: 'novice (moins de 6 mois de pratique régulière)',
  intermediaire: 'intermédiaire (6 mois à 2 ans)',
  confirme: 'confirmé (2 à 5 ans, plusieurs objectifs préparés)',
  expert: 'expert / compétiteur (plus de 5 ans d\'entraînement structuré)',
};
const FITNESS_LABELS = { 1: 'débutant', 2: 'novice', 3: 'intermédiaire', 4: 'confirmé', 5: 'expert/compétiteur' };
export const AI_LANGUAGE_NAMES = { fr: 'français', en: 'English', es: 'español' };
const DAY_SHORT = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];

// ---------------------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------------------

/**
 * Date du jour de l'ATHLÈTE. Les fonctions Vercel tournent en UTC : sans la date locale
 * envoyée par le navigateur, un lundi 00:30 à Paris est encore dimanche côté serveur et
 * toute la semaine serait décalée. `clientDate` = "YYYY-MM-DD" (voir pages/index.js).
 */
export function resolveToday(clientDate) {
  const m = String(clientDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12));
}

function addDaysUTC(date, n) {
  return new Date(date.getTime() + n * 86_400_000);
}

export function mondayOf(date) {
  const idx = (date.getUTCDay() + 6) % 7; // 0 = lundi
  return addDaysUTC(date, -idx);
}

function fmtDM(date) {
  return `${String(date.getUTCDate()).padStart(2, '0')}/${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function toISODateUTC(date) {
  return date.toISOString().slice(0, 10);
}

/** { Lundi: 'lun. 28/09', ... } pour la semaine N (offset 0) ou N+1 (offset 1). */
export function weekDateLabels(today, offsetWeeks = 0) {
  const monday = addDaysUTC(mondayOf(today), offsetWeeks * 7);
  return Object.fromEntries(DAYS_OF_WEEK.map((day, i) => [day, `${DAY_SHORT[i]} ${fmtDM(addDaysUTC(monday, i))}`]));
}

function todayLabel(today) {
  const idx = (today.getUTCDay() + 6) % 7;
  return `${DAYS_OF_WEEK[idx].toLowerCase()} ${fmtDM(today)}/${today.getUTCFullYear()}`;
}

// ---------------------------------------------------------------------------------------
// Zones (valeurs chiffrées injectées : seule source des chiffres du plan)
// ---------------------------------------------------------------------------------------

function formatPace(minPerUnit) {
  let min = Math.floor(minPerUnit);
  let sec = Math.round((minPerUnit - min) * 60);
  if (sec === 60) { min += 1; sec = 0; }
  return `${min}:${String(sec).padStart(2, '0')}`;
}

const RUN_ZONE_LABELS = ['Z1 récupération', 'Z2 endurance fondamentale', 'Z3 tempo', 'Z4 seuil', 'Z5 VMA'];
// Pourcentages de VMA, IDENTIQUES à lib/zones.js (PACE_PCTS) pour que prompt, garde-fous et
// onglet Profil affichent les mêmes zones. Endurance fondamentale à 62-75 % VMA (l'ancienne
// table la plaçait à 70-80 %, soit ~allure marathon d'un coureur entraîné).
const RUN_ZONE_PCTS = [[0.55, 0.62], [0.62, 0.75], [0.75, 0.85], [0.85, 0.92], [0.92, 1.05]];

function hasValidPaceZones(zones) {
  return Array.isArray(zones) && zones.length === 5 && zones.every((z) => Number(z?.min) > 0);
}

export function runZonesText(vma, manualPaceZones) {
  if (hasValidPaceZones(manualPaceZones)) {
    const sorted = [...manualPaceZones].sort((a, b) => Number(a.min) - Number(b.min));
    const lines = sorted.map((z, i) => {
      const slow = Number(z.min);
      const next = Number(sorted[i + 1]?.min);
      const fast = Number.isFinite(next) && next > slow ? next : slow * 1.12;
      return `${RUN_ZONE_LABELS[i]} : ${formatPace(60 / fast)} à ${formatPace(60 / slow)} /km`;
    });
    return `${lines.join('\n')}\n(Zones CALIBRÉES sur le terrain par l'athlète : elles priment sur tout calcul depuis la VMA.)`;
  }
  if (!vma) return 'VMA inconnue → AUCUNE allure chiffrée en course à pied : repères RPE uniquement.';
  const lines = RUN_ZONE_PCTS.map(([lo, hi], i) => `${RUN_ZONE_LABELS[i]} : ${formatPace(60 / (vma * hi))} à ${formatPace(60 / (vma * lo))} /km`);
  return `${lines.join('\n')}\n(Calculées depuis la VMA ${vma} km/h — l'athlète peut les calibrer dans son profil.)`;
}

export function bikeZonesText(ftp) {
  if (!ftp) return 'FTP inconnue → AUCUNE puissance chiffrée à vélo : repères RPE uniquement.';
  const zones = [
    ['Z1 récupération', 0.40, 0.55], ['Z2 endurance', 0.56, 0.75], ['Z3 tempo', 0.76, 0.87], ['Z3-Z4 sweet spot', 0.88, 0.94],
    ['Z4 seuil', 0.95, 1.05], ['Z5 VO2max', 1.06, 1.20], ['Z6 anaérobie', 1.21, 1.50],
  ];
  return zones.map(([z, lo, hi]) => `${z} : ${Math.round(ftp * lo)}-${Math.round(ftp * hi)} W`).join('\n');
}

function cssMinutes(nat100) {
  const m = String(nat100 || '').match(/(\d+):(\d{2})/);
  return m ? Number(m[1]) + Number(m[2]) / 60 : null;
}

export function swimZonesText(nat100) {
  const css = cssMinutes(nat100);
  if (!css) return 'CSS inconnue → AUCUNE allure natation chiffrée : repères RPE uniquement.';
  const zones = [['Z1 récupération', 1.15, 1.25], ['Z2 endurance', 1.07, 1.14], ['Z3 tempo', 1.03, 1.06], ['Z4 seuil / CSS', 0.99, 1.02], ['Z5 vitesse', 0.90, 0.97]];
  return zones.map(([z, fast, slow]) => `${z} : ${formatPace(css * fast)} à ${formatPace(css * slow)} /100m`).join('\n');
}

function hasValidHrZones(zones) {
  if (!Array.isArray(zones) || zones.length !== 5) return false;
  const mins = zones.map((z) => Number(z?.min));
  if (!mins.every((m) => Number.isFinite(m) && m >= 0 && m <= 230)) return false;
  return mins.slice(1).every((m, i) => m > mins[i]);
}

export function hrZonesText(fcMax, fcRepos, manualHrZones = null) {
  // Zones FC saisies par l'athlète (Profil → Zones) : prioritaires. CORRECTIF : elles
  // n'étaient jamais envoyées à l'IA, qui retombait sur Karvonen — impossible sans FC de
  // repos, donc aucun repère bpm alors que l'athlète avait renseigné les siennes.
  if (hasValidHrZones(manualHrZones)) {
    const m = manualHrZones.map((z) => Math.round(Number(z.min)));
    return `Z1 < ${m[1]} · Z2 ${m[1]}-${m[2] - 1} · Z3 ${m[2]}-${m[3] - 1} · Z4 ${m[3]}-${m[4] - 1} · Z5 ≥ ${m[4]} bpm (zones saisies par l'athlète)`;
  }
  if (!fcMax || !fcRepos) return 'FC max/repos inconnues → pas de bpm chiffrés.';
  const r = fcMax - fcRepos;
  return [[1, 0.5, 0.6], [2, 0.6, 0.7], [3, 0.7, 0.8], [4, 0.8, 0.9], [5, 0.9, 1]]
    .map(([z, lo, hi]) => `Z${z} : ${Math.round(fcRepos + r * lo)}-${Math.round(fcRepos + r * hi)} bpm`).join(' · ');
}

// ---------------------------------------------------------------------------------------
// Guidance métier (formats, niveaux)
// ---------------------------------------------------------------------------------------

const SWIM_FORMAT_GUIDANCE = {
  XS: 'Format découverte (~400 m) : technique et vitesse courte, séries de 25-50 m, peu de PULL long. Repère "all SPRINT".',
  S: 'Format sprint (750 m) : vitesse et relâchement à allure soutenue, séries de 50-100 m dominantes, départs rapides (25-50 m à fond) en phase spécifique. Repère "all SPRINT".',
  M: 'Format olympique (1500 m) : équilibre seuil/endurance, 100-200 m à allure CSS et blocs PULL 200-400 m, technique à chaque séance. Repère "all OLYMPIQUE".',
  L: 'Format half (1900 m) : dominante endurance et économie, blocs PULL/NC longs de 200-400 m (jusqu\'à 800 m chez un confirmé), peu de vitesse pure. Repère "all HALF".',
  XL: 'Format Ironman (3800 m) : endurance maximale, blocs très longs (400-1000 m) réguliers, quasiment pas de vitesse. Repère "all XL".',
};

const ALLOCATION_GUIDANCE = {
  XS: 'Répartition assez équilibrée, légère priorité à la course.',
  S: 'Répartition équilibrée, légère priorité vélo et course (poids dans le chrono) ; en course avec aspiration (drafting), travail de relances et de changements de rythme à vélo.',
  M: 'Répartition quasi équilibrée : au minimum 1 qualité natation, 1 seuil/sweet spot vélo et 1 sortie longue course si le volume le permet.',
  L: 'Le vélo reçoit ~45-50 % du temps, la course ~25-30 %, la natation ~15-20 %. Une sortie longue vélo et idéalement un enchaînement vélo→course par semaine ; 1 séance course à fort impact maximum.',
  XL: 'Le vélo domine (~50-55 %) ; au moins 1 sortie longue vélo et 1 sortie longue course par semaine (pas le même jour en début de préparation), enchaînements réguliers.',
};

function longSessionGuidance(wizardData, expRank) {
  const fmt = wizardData.triathlonFormat;
  const isRunning = wizardData.sportType === 'running';
  if (isRunning) {
    if (/marathon|semi/i.test(String(wizardData.distance || '')) || Number(wizardData.trailKm) >= 20) {
      return expRank >= 4 ? 'Sortie longue course : 1h40 à 2h+ selon la phase.' : 'Sortie longue course : progression de 1h à 1h45 selon la phase et le niveau.';
    }
    return 'Sortie longue course : 1h à 1h20 suffisent pour cet objectif (5-10 km).';
  }
  if (fmt === 'L' || fmt === 'XL') {
    return expRank >= 4
      ? 'Sorties longues : vélo 2h30 en base jusqu\'à 3-4h en phase spécifique ; course 1h40 à 2h.'
      : 'Sorties longues : vélo 1h45 à 3h, course 1h15 à 1h45, en progression.';
  }
  const hours = Number(wizardData.hoursPerWeek) || 0;
  if (fmt === 'M') {
    if (hours >= 14) return `Sorties longues : avec ~${hours} h/semaine, vélo 2h30 à 3h30 en Z2 et course 1h25 à 1h40 sont normaux ; la qualité spécifique reste prioritaire.`;
    return expRank >= 4 ? 'Sorties longues : vélo 2h à 2h30, course 1h25 à 1h40.' : 'Sorties longues : vélo 1h30 à 2h, course 1h à 1h20.';
  }
  // CORRECTIF (banc d'essai) : "vélo ~2h max" était incompatible avec un gros volume
  // (18 h en 12 séances = 1h30 de moyenne) — un modèle obéissant ratait le volume.
  if (hours >= 12) return `Format court mais volume élevé (~${hours} h/semaine) : une sortie vélo Z2 de 2h30 à 3h30 et une course longue d'1h15 à 1h30 sont normales ; la priorité reste la qualité (relances, allure course, transitions).`;
  return 'Format court : pas besoin de très longues sorties (vélo ~2h, course ~1h15) ; la qualité (relances, allure course, transitions) prime sur la durée.';
}

function levelGuidance(wizardData) {
  const level = Number(wizardData.fitnessLevel) || 3;
  const expRank = EXPERIENCE_RANK[wizardData.trainingExperience] || 3;
  const parts = [];
  if (expRank <= 2) {
    parts.push('Pédagogie : explique en une courte phrase le but de la séance dans "structure" ; vocabulaire simple ; pas de structures complexes (pyramides, double seuil).');
  } else if (expRank >= 4) {
    parts.push('Pédagogie : contenu technique et épuré, l\'athlète connaît les bases.');
  }
  if (wizardData.hasExistingTrainingBase) {
    parts.push('L\'athlète suit déjà un entraînement structuré : pars directement du volume et du nombre de séances déclarés, sans rampe de reprise.');
  } else if (level <= 2 || expRank <= 2) {
    parts.push('Prudence : progression de volume ≤ 10 %/semaine ; qualité course ≤ 20 min de travail cumulé ; sortie longue course ≤ 1h15 et vélo ≤ 2h en base.');
  } else if (level >= 4) {
    parts.push('Peut absorber volume et intensité dès la phase de base.');
  }
  return parts.join('\n');
}

function expertRules(wizardData, ctx) {
  const level = Number(wizardData.fitnessLevel) || 3;
  const expRank = EXPERIENCE_RANK[wizardData.trainingExperience] || 3;
  const lines = [];
  if (level >= 4 && expRank >= 4 && Number(wizardData.hoursPerWeek) >= 12) {
    // Méthodes d'intensité documentées (voir REVUE_IA_2026-09.md, section 22).
    lines.push([
      'Méthodes d\'intensité (profil confirmé/expert à gros volume) — à utiliser en phase développement/spécifique, pas en base ni en affûtage :',
      '  · VO2max « 4×4 » : 4×4\' à 90-95 % FCmax (≈ 95 % VMA ou PMA), récupération active 3\' à ~70 % FCmax ; c\'est le format de référence (Helgerud 2007 : +7,2 % de VO2max en 8 semaines, supérieur au travail au seuil ou en endurance à charge égale).',
      '  · Intervalles à DÉPART RAPIDE : chaque répétition commence au-dessus de l\'intensité tenable puis redescend, pour atteindre plus vite et garder plus longtemps une consommation d\'oxygène proche du maximum. Ex. 5×5\' = 1\'30 à 100 % VMA/PMA puis 3\'30 à 85-90 %, récup 2\'30 ; ou 6×5\' avec 3 relances de 30\'\' à 100 % PMA. Plus de temps près de VO2max qu\'à intensité constante (Bossi 2020), mais bénéfice à long terme pas encore démontré : à alterner avec le 4×4, pas à systématiser.',
      '  · DOUBLE SEUIL NORVÉGIEN : deux séances de seuil CONTRÔLÉ le même jour (matin et fin d\'après-midi, 6-8 h d\'écart), chaque bloc JUSTE SOUS le seuil 2 (≈ 85-88 % FCmax, RPE 6-7/10, lactate 2-3,5 mmol/L si mesuré) — jamais à fond. Ex. course : matin 5×6\' / soir 10×3\' ; vélo : matin 3×12\' / soir 5×6\'. 1 journée par semaine au maximum (2 seulement au-delà de 18 h avec une très bonne tolérance), comptée comme UNE journée dure : pas d\'autre intensité la veille ni le lendemain, et le reste de la semaine très facile (75-80 % du temps en Z1-Z2). Jamais la veille d\'une sortie longue.',
      '  · Par semaine, au plus 2-3 journées dures au total (VO2max, seuil, double seuil confondus).',
    ].join('\n'));
  } else if (level >= 4 && expRank >= 4 && Number(wizardData.hoursPerWeek) >= 8) {
    lines.push('Double seuil (2 blocs de seuil courts et contrôlés le même jour, juste sous le seuil 2) autorisé 1×/semaine maximum en phase développement/spécifique, jamais la veille d\'une sortie longue.');
  } else {
    lines.push('Une seule séance de qualité par jour (pas de double seuil pour ce profil).');
  }
  if (ctx.tripleEligible) {
    lines.push('Triple journée autorisée : 3 disciplines différentes, et la plus courte des 3 séances reste facile (Z1-Z2 ou technique).');
  }
  if (wizardData.sportType === 'running' && wizardData.runningSubtype === 'trail') {
    lines.push('Trail : 1 renforcement excentrique/descente par semaine, sortie longue avec D+ cohérent, intensité en côte exprimée en RPE/FC, jamais deux sorties à fort dénivelé deux jours de suite.');
  } else if (wizardData.ppgEnabled !== false) {
    lines.push('PPG demandée : 1 séance courte (20-30 min, RPE 3-4) de gainage et stabilité épaule/hanche par semaine, jamais la veille d\'une séance clé — elle compte comme une séance du type de la discipline la plus proche (ex. C.A.P) et apparaît dans son titre.');
  }
  return lines.map((l) => `- ${l}`).join('\n');
}

// ---------------------------------------------------------------------------------------
// Contexte athlète (calculé une fois, partagé par tous les prompts)
// ---------------------------------------------------------------------------------------

// resolvePhase vit désormais dans lib/seasonPlan.js (réexportée ici pour compatibilité).
export { resolvePhase };

/**
 * Rassemble toutes les données utiles au prompt et aux garde-fous.
 * `wizardData` = contraintes/objectif (questionnaire ou `constraints` côté client).
 */
export function buildAthleteContext({
  wizardData = {}, profile = {}, feedbackHistory = [], healthHistory = [], manualPaceZones = null, manualHrZones = null,
  injuryLog = [], raceCalendar = [], menstrualCycle = null, language = 'fr', clientDate = null, planStartDate = null,
  trainingLoad = null, missedSessions = null, weekHistory = null,
}) {
  const today = resolveToday(clientDate);
  const sportType = wizardData.sportType === 'running' ? 'running' : normalizeSportType(wizardData.sportType);
  const withBike = hasBike(sportType);
  const withSwim = hasSwim(sportType);
  const isTriathlon = sportType === 'triathlon';
  let physio = resolveAthletePhysiology(wizardData, profile || {});
  const trend = summarizeFeedbackTrend(feedbackHistory || []);
  physio = applyFeedbackTrendToPhysiology(physio, trend);
  const hrvTrend = summarizeHrvTrend(healthHistory || []);
  const sleepTrend = typeof summarizeSleepTrend === 'function' ? summarizeSleepTrend(healthHistory || []) : { direction: 'stable' };
  const targetPhysio = resolveTargetPhysiology(wizardData);
  const { phases, current, weeksLeft } = resolvePhase(wizardData.targetDate, planStartDate, today);
  const expRank = EXPERIENCE_RANK[wizardData.trainingExperience] || 3;
  const target = Number(wizardData.maxSessionsPerWeek) || null;
  // Journées à 3 séances seulement si 2 par jour ne suffisent pas (selon les jours de repos
  // réellement déclarés, pas un seuil fixe de 12) et si le profil y a droit.
  const availableDaysForCap = 7 - String(wizardData.offDays || '').split(',').map((d) => d.trim()).filter(Boolean).length;
  const tripleEligible = target > 2 * availableDaysForCap && isTripleDayEligible(wizardData.fitnessLevel, wizardData.hoursPerWeek, wizardData.trainingExperience);
  const paceZones = hasValidPaceZones(manualPaceZones) ? manualPaceZones : null;
  const mondayN = toISODateUTC(mondayOf(today));
  const mondayN1 = toISODateUTC(addDaysUTC(mondayOf(today), 7));
  // Contexte de CHAQUE semaine (phase, nature, volume, séances, courses) — lib/seasonPlan.js.
  const planStart = planStartDate && /^\d{4}-\d{2}-\d{2}/.test(String(planStartDate)) ? String(planStartDate).slice(0, 10) : toISODateUTC(today);
  const weekCtx = {
    N: computeWeekContext({ wizardData, planStartDate: planStart, weekMonday: mondayN, raceCalendar }),
    'N+1': computeWeekContext({ wizardData, planStartDate: planStart, weekMonday: mondayN1, raceCalendar }),
  };
  const weekInfo = Object.fromEntries(['N', 'N+1'].map((wk) => [wk, weekCtx[wk].label ? { kind: weekCtx[wk].kind, index: weekCtx[wk].index, label: weekCtx[wk].label } : null]));
  const weekHours = { N: weekCtx.N.hours, 'N+1': weekCtx['N+1'].hours };
  // Charge RÉELLE (Strava) : voir lib/recentTraining.js. Deux effets concrets :
  //  - volume réel des semaines complètes < 75 % du volume déclaré (≥ 2 semaines de données)
  //    → cible plafonnée à +15 % du réel (pas de pic de charge brutal) ;
  //  - TSB ≤ -20 (fatigue marquée) → même allègement automatique qu'une VFC en baisse.
  const realLoad = sanitizeTrainingLoad(trainingLoad);
  const completeWeeks = (realLoad?.weeks || []).filter((w) => !w.current && w.totalHours > 0);
  let rampCap = null;
  if (realLoad?.avgCompletedWeekHours && completeWeeks.length >= 2 && Number(wizardData.hoursPerWeek) > 0
    && realLoad.avgCompletedWeekHours < Number(wizardData.hoursPerWeek) * 0.75) {
    rampCap = Math.round(realLoad.avgCompletedWeekHours * 1.15 * 10) / 10;
    ['N', 'N+1'].forEach((wk) => { if (weekHours[wk]) weekHours[wk] = Math.min(weekHours[wk], rampCap); });
  }
  const loadFatigue = Boolean(realLoad?.load && Number(realLoad.load.tsb) <= -20);

  const resolvedProfile = {
    ...profile,
    vma: physio.vma,
    fcMax: physio.fcMax,
    fcRepos: physio.fcRepos,
    ...(withBike ? { ftp: physio.ftp } : {}),
    ...(withSwim ? { nat100: physio.nat100 } : {}),
    weight: Number(wizardData.weight) || profile?.weight,
    fitnessLevel: Number(wizardData.fitnessLevel) || profile?.fitnessLevel,
  };

  return {
    today,
    language,
    wizardData,
    isTriathlon,
    sportType,
    hasBike: withBike,
    hasSwim: withSwim,
    physio,
    trend,
    hrvTrend,
    sleepTrend,
    targetPhysio,
    phases,
    phase: weekCtx.N.kind === 'recovery' || weekCtx.N.kind === 'transition' || weekCtx.N.kind === 'race'
      ? { key: weekCtx.N.phaseKey, name: weekCtx.N.phaseName, dates: '' }
      : current,
    phaseKey: weekCtx.N.phaseKey || current?.key || 'base',
    weekCtx,
    planStartIso: planStart,
    weekHistory: sanitizeWeekHistory(weekHistory),
    weeksLeft,
    expRank,
    tripleEligible,
    paceZones,
    hrZones: hasValidHrZones(manualHrZones) ? manualHrZones : null,
    weekInfo,
    weekHours,
    realLoad,
    rampCap,
    loadFatigue,
    missedSessions: sanitizeMissed(missedSessions),
    focus: describeFocusAreas(wizardData.focusAreas),
    coachNotes: String(wizardData.coachNotes || '').trim().slice(0, 600),
    resolvedProfile,
    profileForSanitize: { ...resolvedProfile, paceZones },
    injuryLog: injuryLog || [],
    raceCalendar: raceCalendar || [],
    menstrualCycle,
    feedbackHistory: feedbackHistory || [],
  };
}

// ---------------------------------------------------------------------------------------
// Blocs de texte
// ---------------------------------------------------------------------------------------

function languageLine(language) {
  if (!language || language === 'fr') return '';
  return `Rédige tout le texte libre (title, structure, desc, weekSummary, reply) en ${AI_LANGUAGE_NAMES[language] || 'français'}. Les valeurs imposées (day, type, unités) restent inchangées.`;
}

function sessionConventions(language) {
  return `CONVENTIONS D'UNE SÉANCE
- intensity = cible du corps de séance : C.A.P "m:ss /km" · CYCLISME "NNNW" · NATATION "m:ss /100m" · ENCHAÎNEMENT : allure course "m:ss /km" · métrique inconnue : "RPE x/10" · REPOS : "Repos". Jamais de km/h pour la course.
- Tout chiffre (allure, watts, bpm) est pris dans les zones fournies. Aucune valeur générique ou inventée.
- duration = durée réelle totale ("1h30", "45 min") = échauffement + corps de séance + retour au calme (±10 %).
- desc = feuille de séance de club, blocs séparés par des retours à la ligne :
  "Échauffement :" … "Corps de séance :" … puis le retour au calme.
  Notation : course/vélo "N*(effort @cible - récup)" avec les valeurs chiffrées des zones (ex "5*(6' @345W - 3' souple)", "4*(6' @3:50/km - 90'' trot)").
  Natation : séries "N*Dm contenu zone R : XX''" (NC nage complète, PULL pull-buoy, PLAQ plaquettes, palmes, educ éducatifs, souple) ;
  chaque bloc d'effort porte une zone ou une allure ; retour au calme puis DERNIÈRE ligne "Total : XXXXm" = somme exacte des distances.
- structure = UNE phrase courte (vignette du calendrier). restTime = récupération entre répétitions, "-" si séance continue.
- REPOS : title "Repos", duration "0 min", intensity "Repos", autres champs "-" et desc d'une phrase.
${languageLine(language)}`.trim();
}

export function coachSystemPrompt(language = 'fr') {
  return `Tu es TRI COACH, entraîneur de triathlon et de course à pied (diplômé d'État, 15 ans d'expérience du débutant au compétiteur). Tu écris des plans comme un coach de club exigeant : précis, chiffrés, individualisés, sans remplissage.

PRINCIPES (applique-les avec jugement)
1. Individualisation : chaque décision découle des données de l'athlète fournies, jamais d'un plan type.
2. Polarisation : l'essentiel du volume en Z1-Z2 ; la qualité est concentrée sur quelques séances clés bien identifiées. Pas de "zone grise" (Z3 continue sans objectif).
3. Récupération : pas deux séances dures de la même discipline deux jours de suite ; la course à pied dure (impact) jamais deux jours de suite ; pour un débutant/intermédiaire, pas deux jours durs consécutifs quelle que soit la discipline.
4. Spécificité : plus l'objectif approche, plus la qualité se rapproche de l'allure et des conditions de course, la base aérobie restant la fondation.
5. Progression : la semaine N+1 progresse ou varie réellement par rapport à N, selon la phase.
6. Cohérence : titre, intensité, zones, durée et feuille de séance racontent la MÊME séance.

${sessionConventions(language)}`;
}

function physioBlock(ctx) {
  const p = ctx.physio;
  const fmt = (v, unit) => (v === null || v === undefined || v === '' ? 'non renseignée' : `${v}${unit}`);
  const lines = [
    `- VMA : ${fmt(p.vma, ' km/h')} (${p.vmaSource})`,
    ...(ctx.hasBike ? [`- FTP : ${fmt(p.ftp, ' W')} (${p.ftpSource})`] : []),
    ...(ctx.hasSwim ? [`- CSS natation : ${p.nat100 ? `${p.nat100}/100m` : 'non renseignée'} (${p.nat100Source})`] : []),
    `- FC max ${fmt(p.fcMax, ' bpm')} · FC repos ${fmt(p.fcRepos, ' bpm')}`,
  ];
  return lines.join('\n');
}

function zonesBlock(ctx) {
  const p = ctx.physio;
  const parts = [
    `Course à pied :\n${runZonesText(p.vma, ctx.paceZones)}`,
    ...(ctx.hasBike ? [`Vélo (FTP ${p.ftp || '?'} W) :\n${bikeZonesText(p.ftp)}`] : []),
    ...(ctx.hasSwim ? [`Natation :\n${swimZonesText(p.nat100)}`] : []),
    `Fréquence cardiaque : ${hrZonesText(p.fcMax, p.fcRepos, ctx.hrZones)}`,
  ];
  return parts.join('\n\n');
}

function targetBlock(ctx) {
  const t = ctx.targetPhysio || {};
  const lines = [];
  if (t.targetVma) lines.push(`- Course : allure spécifique cible correspondant à une VMA de ${t.targetVma} km/h (${t.targetVmaSource}).`);
  if (t.targetBikeSpeedKmh) lines.push(`- Vélo : vitesse moyenne visée ~${t.targetBikeSpeedKmh} km/h (${t.targetBikeSpeedSource}).`);
  if (t.targetSwimPace100) lines.push(`- Natation : allure visée ${t.targetSwimPace100}/100m (${t.targetSwimPaceSource}).`);
  if (!lines.length) return '';
  return `CIBLES DE COURSE (à utiliser seulement pour les blocs "allure course" en phase spécifique/pic ; les zones ci-dessus restent la référence du niveau ACTUEL) :\n${lines.join('\n')}`;
}

function describeGoal(w) {
  if (w.sportType === 'duathlon') {
    const d = w.customDistances || {};
    return `Duathlon format ${w.triathlonFormat || 'S'} (course ${d.run ?? '?'} km, vélo ${d.bike ?? '?'} km, course ${d.run2 ?? '?'} km)`;
  }
  if (w.sportType === 'running') {
    if (w.runningSubtype === 'trail') return `Trail de ${w.trailKm || '?'} km / ${w.trailElevation || '?'} m D+`;
    return `Course à pied sur route : ${w.distance || '?'}`;
  }
  const d = w.customDistances || {};
  return `Triathlon format ${w.triathlonFormat || 'M'} (natation ${d.swim ?? '?'} km, vélo ${d.bike ?? '?'} km, course ${d.run ?? '?'} km)`;
}

function describeTargetTime(w) {
  if (w.sportType === 'triathlon') {
    const t = w.triathlonTimes || {};
    const parts = [['natation', t.swim], ['T1', t.transition_t1], ['vélo', t.bike], ['T2', t.transition_t2], ['course', t.run], ['total', t.total]]
      .filter(([, v]) => v).map(([k, v]) => `${k} ${v}`);
    return parts.length ? parts.join(', ') : 'non précisé';
  }
  return w.targetTime || 'non précisé';
}

/** Arithmétique des contraintes faite par le code (le modèle n'a plus à calculer). */
const WEEK_KIND_RULES = {
  decharge: "Décharge : même nombre de séances mais plus courtes, au plus un court rappel d'intensité, aucune sortie longue, priorité à la récupération.",
  taper: "Affûtage : garde la fréquence des séances et quelques courts blocs à allure de course, réduis nettement le volume, aucune sortie longue.",
  recovery: "Récupération post-course : repos et séances très faciles (Z1) uniquement, aucune intensité, aucune sortie longue.",
  transition: "Transition : l'objectif est passé ; entretien facile et varié (Z1-Z2, un peu de PPG), aucun bloc spécifique, en attendant un nouvel objectif.",
};

function frDate(iso) {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

function raceEntryType(sportType) {
  return sportType === 'running' ? 'C.A.P' : 'ENCHAÎNEMENT';
}

function constraintsBlock(ctx, weekKeys = null) {
  const w = ctx.wizardData;
  const target = Number(w.maxSessionsPerWeek) || null;
  const offDays = String(w.offDays || '').split(',').map((d) => d.trim()).filter(Boolean);
  const available = 7 - offDays.length;
  const lines = [];
  const fmtRange = (h) => {
    const lo = Math.round(h * 60 * 0.85);
    const hi = Math.round(h * 60 * 1.15);
    return `entre ${Math.floor(lo / 60)}h${String(lo % 60).padStart(2, '0')} et ${Math.floor(hi / 60)}h${String(hi % 60).padStart(2, '0')}`;
  };
  const keys = weekKeys || ['N', 'N+1'];
  const cap = ctx.tripleEligible ? 3 : 2;

  if (w.loadCycle?.pattern && w.loadCycle.pattern !== 'none') lines.push(`- Cycle de charge de l'athlète : ${w.loadCycle.pattern} (charge:décharge), suspendu pendant l'affûtage et après la course.`);
  if (w.hoursPerWeek) lines.push(`- Volume déclaré par l'athlète : ~${w.hoursPerWeek} h/semaine (volume des semaines de charge pleine) ; le volume de CHAQUE semaine ci-dessous en découle.`);

  keys.forEach((wk) => {
    const c = ctx.weekCtx?.[wk];
    if (!c) return;
    const h = ctx.weekHours?.[wk];
    const parts = [`- Semaine ${wk}${c.label ? ` = ${c.label}` : ''}${c.phaseName ? ` (phase : ${c.phaseName})` : ''}`];
    if (h) parts.push(` → ~${h} h, somme des durées ${fmtRange(h)}`);
    parts.push(c.sessionsTarget ? ` ; EXACTEMENT ${c.sessionsTarget} séances.` : target ? ` ; au plus ${target} séances (nombre libre).` : '.');
    if (WEEK_KIND_RULES[c.kind]) parts.push(` ${WEEK_KIND_RULES[c.kind]}`);
    if (c.kind === 'race') {
      parts.push(` LA COURSE a lieu ${c.raceDay.toLowerCase()} ${frDate(c.raceDate)} : ce jour-là, UNE seule entrée, la course elle-même (type ${raceEntryType(ctx.sportType)}, title commençant par "🏁 "). Veille : 20-30' très facile avec 3-4 accélérations. Deux jours avant : dernier rappel court à allure de course. Après la course : repos ou récupération très légère.`);
    }
    lines.push(parts.join(''));
  });

  if (target) {
    lines.push('- Un ENCHAÎNEMENT (brick) compte pour 2 séances.');
    if (target > available) {
      // CORRECTIF (plan réel, 15 séances sur 6 jours) : la consigne disait « il faut 9 jours
      // avec 2 ou 3 séances » — impossible avec 6 jours. Répartition exacte désormais :
      // 15 = 3 jours × 3 + 3 jours × 2.
      const extra = target - available;
      const triples = Math.max(0, extra - available);
      const doubles = extra - 2 * triples;
      const singles = available - doubles - triples;
      const parts = [
        triples ? `${triples} jour(s) à 3 séances` : null,
        doubles ? `${doubles} jour(s) à 2 séances` : null,
        singles ? `${singles} jour(s) à 1 séance` : null,
      ].filter(Boolean);
      lines.push(`- Pour ${target} séances sur ${available} jours disponibles : ${parts.join(', ')} (un ENCHAÎNEMENT compte pour 2 et occupe seul sa journée).`);
    } else {
      lines.push(`- ${target} séances sur ${available} jours disponibles : ${available - target} jour(s) de repos en plus du repos obligatoire (ou des jours doubles compensés par autant de repos).`);
    }
    lines.push(`- Maximum ${cap} séances par jour ; un jour double associe 2 disciplines DIFFÉRENTES${w.sportType === 'running' ? ' (course seule : 2 séances de nature différente, la 2e légère)' : ''} ; un ENCHAÎNEMENT reste seul sur sa journée ; jamais deux fois la même séance le même jour.`);
  }
  lines.push(`- Jour(s) de repos obligatoire(s) : ${offDays.length ? offDays.join(', ') : 'aucun'} → entrée REPOS uniquement (sauf une course inscrite ce jour-là).`);
  const caps = w.dayCaps || {};
  const fmtCap = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, '0') : ''}` : `${m} min`);
  if (Number(caps.weekday) > 0 || Number(caps.weekend) > 0) {
    lines.push(`- Disponibilité de l'athlète (TOUTES les séances du jour cumulées) : ${Number(caps.weekday) > 0 ? `du lundi au vendredi ${fmtCap(Number(caps.weekday))} maximum par jour` : 'du lundi au vendredi sans limite'} ; ${Number(caps.weekend) > 0 ? `samedi et dimanche ${fmtCap(Number(caps.weekend))} maximum par jour` : 'samedi et dimanche sans limite'}. Place les séances longues sur les jours qui le permettent.`);
  }
  if (ctx.hasBike && target && target < 5) {
    lines.push(`- Seulement ${target} séances pour un ${sportLabel(ctx.sportType)} : priorise les disciplines déterminantes pour ce format et utilise des enchaînements.`);
  }
  return lines.join('\n');
}

/** Autres courses (calendrier) tombant en N / N+1 : à inscrire dans le plan. */
function otherRacesBlock(ctx, weekKeys = null) {
  const lines = [];
  (weekKeys || ['N', 'N+1']).forEach((wk) => {
    (ctx.weekCtx?.[wk]?.otherRaces || []).forEach((r) => {
      lines.push(`- ${r.name} (priorité ${r.priority}) : ${r.day.toLowerCase()} ${frDate(r.date)}, semaine ${wk} → entrée "🏁 ${r.name}" ce jour-là (type ${raceEntryType(ctx.sportType)}).${r.priority === 'C' ? ' Course de préparation : elle remplace une séance de qualité.' : ' Veille facile, aucune séance dure les 2 jours avant, lendemain en récupération.'}`);
    });
  });
  return lines.length ? `COURSES À INSCRIRE DANS LE PLAN\n${lines.join('\n')}` : '';
}

function signalsBlock(ctx) {
  const out = [];
  if (ctx.trend?.direction && ctx.trend.direction !== 'stable') out.push(`- Ressenti récent : ${ctx.trend.label}`);
  if (ctx.hrvTrend?.direction === 'low') out.push(`- VFC : ${ctx.hrvTrend.label}`);
  if (ctx.sleepTrend?.direction === 'low') out.push(`- Sommeil : ${ctx.sleepTrend.label}`);
  if (ctx.loadFatigue) out.push(`- Charge réelle : TSB ${ctx.realLoad.load.tsb} (fatigue accumulée).`);
  const injuries = (ctx.injuryLog || []).filter((e) => e && !e.resolved && e.bodyPart);
  if (injuries.length) {
    out.push(`- Gênes actives : ${injuries.map((e) => `${e.bodyPart} (${e.date}${e.note ? `, « ${e.note} »` : ''})`).join(' ; ')} → ménage la zone concernée (moins d'impact/de volume spécifique, alternative technique, prévention) sans vider le plan.`);
  }
  const placed = new Set(['N', 'N+1'].flatMap((wk) => (ctx.weekCtx?.[wk]?.otherRaces || []).map((r) => r.date)));
  const races = summarizeUpcomingRaces(ctx.raceCalendar || []).filter((r) => r.daysAway <= 45 && !placed.has(String(r.date).slice(0, 10)));
  if (races.length) {
    out.push(`- Autres courses : ${races.map((r) => `${r.name} (priorité ${r.priority || 'B'}, dans ${r.daysAway} j, ${r.date})`).join(' ; ')} → mini-affûtage si priorité A/B à moins de 10 jours.`);
  }
  const cycle = computeCurrentPhase(ctx.menstrualCycle);
  if (cycle) out.push(`- Cycle menstruel (déclaré) : ${cycle.label}, jour ${cycle.dayInCycle}/${cycle.cycleLength} — ${cycle.guidance} (ajustement fin, pas de réduction systématique).`);
  return out.length ? `SIGNAUX RÉCENTS (à prendre en compte)\n${out.join('\n')}` : '';
}

// --- Réalisé récent (Strava) ------------------------------------------------------------

const num = (x) => (Number.isFinite(Number(x)) ? Math.round(Number(x) * 10) / 10 : 0);

/** Ne garde que des nombres et des dates attendus (le résumé vient du navigateur). */
export function sanitizeTrainingLoad(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.weeks)) return null;
  const isoOk = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));
  const weeks = raw.weeks.slice(-5).filter((w) => w && isoOk(w.weekStart)).map((w) => ({
    weekStart: w.weekStart,
    current: Boolean(w.current),
    sessions: num(w.sessions),
    totalHours: num(w.totalHours),
    hours: { swim: num(w.hours?.swim), bike: num(w.hours?.bike), run: num(w.hours?.run), other: num(w.hours?.other) },
    km: { swim: num(w.km?.swim), bike: num(w.km?.bike), run: num(w.km?.run) },
    hardSessions: num(w.hardSessions),
  }));
  if (!weeks.length) return null;
  const load = raw.load && typeof raw.load === 'object'
    ? { ctl: num(raw.load.ctl), atl: num(raw.load.atl), tsb: num(raw.load.tsb), label: typeof raw.load.label === 'string' ? raw.load.label.slice(0, 40) : null }
    : null;
  return {
    weeks,
    avgCompletedWeekHours: raw.avgCompletedWeekHours == null ? null : num(raw.avgCompletedWeekHours),
    load,
    dataQuality: { activities: num(raw.dataQuality?.activities), estimatedLoad: num(raw.dataQuality?.estimatedLoad), historyDays: num(raw.dataQuality?.historyDays) },
  };
}

function sanitizeMissed(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 10).map((m) => ({
    day: DAYS_OF_WEEK.includes(m?.day) ? m.day : null,
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(m?.date || '')) ? m.date : null,
    type: classifyDiscipline(m?.type) || null,
    title: String(m?.title || '').replace(/[\n\r"]/g, ' ').slice(0, 60),
    duration: String(m?.duration || '').slice(0, 10),
  })).filter((m) => m.day && m.type);
}

function realLoadBlock(ctx) {
  const r = ctx.realLoad;
  const lines = [];
  if (r) {
    r.weeks.forEach((w) => {
      const d = `${w.weekStart.slice(8, 10)}/${w.weekStart.slice(5, 7)}`;
      const parts = [
        w.hours.swim ? `natation ${w.hours.swim} h (${w.km.swim} km)` : null,
        w.hours.bike ? `vélo ${w.hours.bike} h (${w.km.bike} km)` : null,
        w.hours.run ? `course ${w.hours.run} h (${w.km.run} km)` : null,
        w.hours.other ? `autre ${w.hours.other} h` : null,
      ].filter(Boolean).join(', ');
      lines.push(`- Semaine du ${d}${w.current ? ' (EN COURS, partielle)' : ''} : ${w.totalHours} h, ${w.sessions} activités dont ${w.hardSessions} intenses${parts ? ` — ${parts}` : ''}`);
    });
    if (r.avgCompletedWeekHours != null) lines.push(`- Moyenne des semaines complètes : ${r.avgCompletedWeekHours} h (volume déclaré : ${ctx.wizardData.hoursPerWeek || '?'} h).`);
    if (r.load) lines.push(`- Charge d'entraînement : CTL ${r.load.ctl} · ATL ${r.load.atl} · TSB ${r.load.tsb}${r.load.label ? ` (${r.load.label})` : ''}.`);
    if (r.dataQuality?.estimatedLoad) lines.push(`- (${r.dataQuality.estimatedLoad} activité(s) sans FC ni puissance : charge estimée.)`);
  }
  (ctx.missedSessions || []).forEach((m, i) => {
    if (i === 0) lines.push('- Séances prévues NON FAITES cette semaine :');
    lines.push(`  · ${m.day}${m.date ? ` ${m.date.slice(8, 10)}/${m.date.slice(5, 7)}` : ''} — ${m.type} « ${m.title} » ${m.duration}`);
  });
  if (!lines.length) return '';
  const rules = [];
  if (ctx.rampCap) rules.push(`le volume réel récent est nettement inférieur au volume déclaré : la cible est plafonnée à ~${ctx.rampCap} h/semaine pour éviter un pic de charge (explique-le dans weekSummary)`);
  if (ctx.loadFatigue) rules.push('TSB ≤ -20 : fatigue accumulée, réduis l\'intensité (au plus une séance clé courte) et privilégie la récupération');
  if ((ctx.missedSessions || []).length) rules.push('ne réempile pas les séances manquées : récupère au plus une séance clé si la récupération le permet, sinon passe à la suite');
  return `RÉALISÉ RÉCEMMENT (activités Strava, chiffres calculés par l'app — données réelles, prioritaires sur les hypothèses)
${lines.join('\n')}${rules.length ? `\nConsignes : ${rules.join(' ; ')}.` : ''}`;
}

// --- Historique des semaines précédentes (progression dans la durée) ---------------------

/** Nettoie l'historique envoyé par le navigateur (4 semaines max, champs attendus uniquement). */
export function sanitizeWeekHistory(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(-4).filter((w) => w && /^\d{4}-\d{2}-\d{2}$/.test(String(w.weekStart || ''))).map((w) => ({
    weekStart: w.weekStart,
    plannedHours: num(w.plannedHours),
    sessions: (Array.isArray(w.sessions) ? w.sessions : []).slice(0, 16).map((x) => ({
      day: DAYS_OF_WEEK.includes(x?.day) ? x.day : '?',
      type: classifyDiscipline(x?.type) || '?',
      title: String(x?.title || '').replace(/[\n\r"]/g, ' ').slice(0, 60),
      duration: String(x?.duration || '').slice(0, 10),
      key: Boolean(x?.key),
      status: ['done', 'missed', 'unknown'].includes(x?.status) ? x.status : 'unknown',
    })),
  }));
}

/**
 * CORRECTIF (longévité) : une nouvelle semaine n'était construite qu'à partir de la semaine
 * voisine — le coach ignorait la progression des séances clés sur le mois écoulé
 * (ex. seuil 3x12' → 3x15' → 3x18'). On lui transmet les séances clés des 4 dernières
 * semaines, avec leur statut réel (faite / manquée).
 */
function historyBlock(ctx) {
  const hist = ctx.weekHistory || [];
  if (!hist.length) return '';
  const statusLabel = { done: 'faite', missed: 'MANQUÉE', unknown: 'non confirmée' };
  const lines = hist.map((w) => {
    const keys = w.sessions.filter((x) => x.key);
    const done = w.sessions.filter((x) => x.status === 'done').length;
    const keyText = keys.length ? keys.map((x) => `${x.type} « ${x.title} » ${x.duration} (${statusLabel[x.status]})`).join(' ; ') : 'aucune séance clé';
    return `- Semaine du ${w.weekStart.slice(8, 10)}/${w.weekStart.slice(5, 7)} : ${w.plannedHours || '?'} h prévues, ${done}/${w.sessions.length} séances faites — clés : ${keyText}`;
  });
  return `HISTORIQUE DES DERNIÈRES SEMAINES (séances clés prévues et leur statut)
${lines.join('\n')}
Consigne : fais progresser les séances clés à partir des dernières RÉELLEMENT faites (ex. +1 répétition ou +10 % de temps de travail), reprends au même niveau une séance manquée, ne progresse pas après une semaine majoritairement manquée.`;
}

function athletePrioritiesBlock(ctx) {
  const parts = [];
  if (ctx.focus?.length) {
    parts.push(`PRIORITÉS DÉCLARÉES PAR L'ATHLÈTE (à travailler en priorité, sans déséquilibrer la semaine)\n${ctx.focus.map((f) => `- ${f}`).join('\n')}`);
  }
  if (ctx.coachNotes) {
    parts.push(`INFOS DE L'ATHLÈTE POUR SON COACH (contraintes réelles à respecter : créneaux, matériel, lieux…)\n"${ctx.coachNotes}"`);
  }
  return parts.join('\n\n');
}

function missingMetricsBlock(ctx, tests, weekLabel = 'N') {
  if (!tests?.length) return '';
  const names = { 'C.A.P': 'VMA (demi-Cooper ou 6 min à fond après échauffement)', CYCLISME: 'FTP (20 min ou rampe)', NATATION: 'CSS (400 m puis 200 m chronométrés)' };
  const list = tests.map((t) => (typeof t === 'string' ? { disc: t, reason: 'missing' } : t));
  return `TESTS À PROGRAMMER en semaine ${weekLabel} : ${list.map((t) => `${names[t.disc]}${t.reason === 'stale' ? ' — re-test, dernière valeur de plus de 8 semaines' : ' — métrique manquante'}`).join(' ; ')}. Chaque test remplace une séance de qualité de la discipline, avec "Test" dans le titre, et n'est pas suivi d'une séance dure le lendemain.`;
}

function athleteBlock(ctx) {
  const w = ctx.wizardData;
  const p = ctx.resolvedProfile;
  return `ATHLÈTE
${w.firstName || p.firstName ? `Prénom : ${w.firstName || p.firstName}. ` : ''}Sexe : ${w.gender || p.gender || '?'} · poids ${w.weight || p.weight || '?'} kg · forme ${w.fitnessLevel || '?'}/5 (${FITNESS_LABELS[w.fitnessLevel] || '?'}) · expérience : ${EXPERIENCE_LABELS[w.trainingExperience] || EXPERIENCE_LABELS.intermediaire}
${physioBlock(ctx)}

ZONES (seule source des valeurs chiffrées)
${zonesBlock(ctx)}`;
}

function objectiveBlock(ctx) {
  const w = ctx.wizardData;
  const phase = ctx.phase;
  return `OBJECTIF
${describeGoal(w)}${w.eventName ? ` — ${w.eventName}` : ''} · temps visé : ${describeTargetTime(w)} · date : ${w.targetDate} (${ctx.weeksLeft} semaines)
Phase actuelle : ${phase?.name || 'Base'} (${phase?.dates || ''}) — ${describePhaseGuidance(ctx.phaseKey)}
Suite prévue : ${(ctx.phases || []).filter((p) => p.status === 'À venir').map((p) => `${p.name} (${p.dates})`).join(' → ') || 'aucune'}`;
}

function disciplineBlock(ctx) {
  const w = ctx.wizardData;
  if (ctx.sportType === 'duathlon') {
    return `RÉPARTITION ET CONTENU PAR DISCIPLINE
- Duathlon : course à pied et vélo uniquement, AUCUNE séance NATATION. L'épreuve enchaîne course → vélo → course.
- Répartition équilibrée course/vélo. Travaille la 1re course sans te griller, la transition course→vélo, et surtout la 2e course sur jambes fatiguées (enchaînements vélo→course réguliers, parfois course→vélo→course courts).
- ${longSessionGuidance(w, ctx.expRank)}
- Jours doubles : une séance course + une séance vélo (ou PPG).`;
  }
  if (!ctx.isTriathlon) {
    return `DISCIPLINE
Course à pied uniquement : aucune séance NATATION ni CYCLISME. Au moins une sortie longue et une séance à allure spécifique par semaine, pas plus de deux séances de qualité.
${longSessionGuidance(w, ctx.expRank)}`;
  }
  const floor = swimVolumeFloor(w.trainingExperience, w.triathlonFormat, w.hoursPerWeek);
  return `RÉPARTITION ET CONTENU PAR DISCIPLINE
- ${ALLOCATION_GUIDANCE[w.triathlonFormat] || ALLOCATION_GUIDANCE.M}
- ${longSessionGuidance(w, ctx.expRank)}
- Natation : ${SWIM_FORMAT_GUIDANCE[w.triathlonFormat] || SWIM_FORMAT_GUIDANCE.M}
${swimBlock(ctx, floor)}`;
}

/**
 * CONSIGNE NATATION (refonte) — voir lib/swimPlanning.js. Avant : « séances de
 * récupération/technique : plus courtes » → 3 natations sur 4 « technique » de 1500-2400 m
 * pour un expert à 20 h/semaine. Désormais : volume de la semaine, densité réaliste pour la
 * durée, séance longue, répartition d'intensité et types de séances (inspirés des séances
 * club : allures de course mêlées, départs à fond, PULL/PLAQ, palmes).
 */
function swimBlock(ctx, floor) {
  const w = ctx.wizardData;
  const nat100 = ctx.resolvedProfile?.nat100 || null;
  const css = swimPaceMinutes(nat100, w.trainingExperience);
  const rank = ctx.expRank;
  const per = (min) => realisticSwimMeters(min, css);
  const minSwim = swimMinimumMeters(w);
  const weeks = ['N', 'N+1'].map((wk) => {
    const target = weeklySwimTarget(w, ctx.weekHours?.[wk]);
    const long = longSwimTarget(w, ctx.weekCtx?.[wk], target);
    return `semaine ${wk} ≈ ${Math.round(target / 100) / 10} km${long ? ` dont une séance LONGUE de ~${Math.round(long / 100) / 10} km` : ''}`;
  });
  const lines = [
    `  · Volume natation visé : ${weeks.join(' ; ')}.`,
    `  · Densité : à ${nat100 ? `ta CSS de ${nat100}/100 m` : 'l\'allure estimée pour ce niveau'}, 45 min ≈ ${per(45)} m, 60 min ≈ ${per(60)} m, 75 min ≈ ${per(75)} m, 90 min ≈ ${per(90)} m (échauffement et récupérations compris). Une séance doit en contenir au moins 85 % ; séance principale ≥ ${floor} m.`,
    rank >= 4
      ? '  · Nageur confirmé : PAS de séance « technique » légère — les éducatifs (10-20 % du volume) s\'intègrent dans de vraies séances. Seules une récupération ou un test peuvent être courts.'
      : '  · Les éducatifs occupent 20-30 % du volume ; une séance technique plus courte est possible.',
    '  · Intensité sur la semaine : ~75 % facile (Z1-Z2), ~15 % au seuil (CSS), ~10 % au-dessus (vitesse, départs).',
    '  · Types de séances à combiner : (1) seuil CSS — 10-20*100 @CSS R : 10-15\'\' ou 4-5*300-400 @CSS ; (2) vitesse et départs — 8-12*50 à fond R : 30\'\', 100 à fond puis 300 allure course (départ groupé) ; (3) aérobie et force — 400-800 PULL Z2, blocs PLAQ ; (4) allures de course mêlées — ex. 2*(200 all HALF R : 40\'\' / 2*50 all S R : 20\'\' / 100 à fond R : 1\') ; palmes pour l\'ondulation ou soulager les épaules. En phase spécifique, eau libre si possible (visée, aspiration, virages de bouée).',
    '  · Si l\'athlète nage en club sur un créneau fixe (voir ses consignes), respecte sa durée et donne une séance dense dans ce créneau.',
    minSwim ? `  · Distance MINIMALE par natation : ${minSwim} m, récupération comprise (en dessous, l'entrée à la piscine n'est pas rentabilisée). Une récupération = ${minSwim} m faciles et variés, pas une séance écourtée.` : null,
    '  · JAMAIS deux natations le même jour.',
    '  · VARIÉTÉ OBLIGATOIRE (pas de séance « 500 souple + 6*600 PULL ») : chaque séance contient des ÉDUCATIFS nommés (rattrapé, poings fermés, 3-3-3, doigts traînants, godille, 6 battements-1 bras, crawl tête haute pour la visée) et au moins 3 types de séries dans le corps de séance (ex. éducatifs + allure + matériel, pyramide 100-200-300-200-100, dégressif, jambes planche, respiration 3/5/7 temps, 4 nages ou dos en récupération). Deux séances de la même semaine n\'ont jamais le même corps de séance.',
  ].filter(Boolean);
  return lines.join('\n');
}

/** Échantillon compact d'une semaine pour les prompts (sans les champs internes). */
export function compactWeek(week, dateLabels = null, feedbackById = null) {
  return (week || []).map((w) => {
    const date = dateLabels?.[w.day] ? ` ${dateLabels[w.day]}` : '';
    if (w.type === 'REPOS') return `- [${w.id}] ${w.day}${date} — REPOS`;
    const fb = feedbackById?.get?.(w.id);
    const done = fb ? ` — ✓ validée (dureté ${fb.difficulty}/10, forme ${fb.capacity}/10)` : '';
    return `- [${w.id}] ${w.day}${date} — ${w.type} « ${w.title} » ${w.duration} — ${w.intensity || '-'} — ${w.effortZone || w.cardio || '-'}${done}\n  ${String(w.desc || w.structure || '').replace(/\n+/g, ' / ')}`;
  }).join('\n');
}

export function planJsonForPrompt(weeks) {
  const strip = (w) => Object.fromEntries(Object.entries(w).filter(([k]) => !['modified', 'previous', 'added', 'autoNote'].includes(k)));
  return JSON.stringify({ N: (weeks.N || []).map(strip), 'N+1': (weeks['N+1'] || []).map(strip) });
}

// ---------------------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------------------

function weekHeader(ctx) {
  const n = weekDateLabels(ctx.today, 0);
  const n1 = weekDateLabels(ctx.today, 1);
  return `Aujourd'hui : ${todayLabel(ctx.today)}. Semaine N = ${n.Lundi} → ${n.Dimanche} ; semaine N+1 = ${n1.Lundi} → ${n1.Dimanche}.`;
}

export function buildPlanPrompt(ctx, { missingMetrics = [] } = {}) {
  const prompt = `${weekHeader(ctx)}

${athleteBlock(ctx)}

${objectiveBlock(ctx)}

CONTRAINTES
${constraintsBlock(ctx)}

${disciplineBlock(ctx)}

NIVEAU
${levelGuidance(ctx.wizardData)}
${expertRules(ctx.wizardData, ctx)}

${athletePrioritiesBlock(ctx)}

${otherRacesBlock(ctx)}

${historyBlock(ctx)}

${realLoadBlock(ctx)}

${targetBlock(ctx)}

${signalsBlock(ctx)}

${missingMetricsBlock(ctx, missingMetrics)}

${referenceWeekBlock(ctx.wizardData)}

TA TÂCHE
Écris les semaines N et N+1 de cet athlète. Chaque jour apparaît au moins une fois (REPOS si pas de séance).
Avant de répondre, vérifie : nombre de séances exact, jour(s) de repos respecté(s), volume dans la fourchette, séances clés espacées, chaque chiffre pris dans les zones, "Total" natation = somme des séries, N+1 ≠ N.
"weekSummary" : 2-3 phrases adressées à l'athlète (tutoiement) sur la logique des deux semaines.`;
  return { system: coachSystemPrompt(ctx.language), prompt: prompt.replace(/\n{3,}/g, '\n\n') };
}

export function buildWeekPrompt(ctx, { weekKey, otherWeekKey, otherWeek, missingMetrics = [] }) {
  const labels = weekDateLabels(ctx.today, otherWeekKey === 'N' ? 0 : 1);
  const prompt = `${weekHeader(ctx)}

${athleteBlock(ctx)}

${objectiveBlock(ctx)}

CONTRAINTES
${constraintsBlock(ctx, [weekKey])}

${disciplineBlock(ctx)}

NIVEAU
${levelGuidance(ctx.wizardData)}
${expertRules(ctx.wizardData, ctx)}

${athletePrioritiesBlock(ctx)}

${otherRacesBlock(ctx, [weekKey])}

${historyBlock(ctx)}

${realLoadBlock(ctx)}

${targetBlock(ctx)}

${signalsBlock(ctx)}

${missingMetricsBlock(ctx, missingMetrics, weekKey)}

SEMAINE ${otherWeekKey} (INCHANGÉE, ${otherWeekKey === 'N' ? 'elle précède' : 'elle suit'} la semaine à écrire) :
${compactWeek(otherWeek, labels)}

${referenceWeekBlock(ctx.wizardData)}

TA TÂCHE
L'athlète a demandé de régénérer entièrement la semaine ${weekKey}. Écris-la en assurant une progression/variation logique avec la semaine ${otherWeekKey} (y compris la récupération à la jonction des deux semaines). Chaque jour apparaît au moins une fois.
Avant de répondre, vérifie : nombre de séances exact, repos obligatoire, volume dans la fourchette, séances clés espacées, chiffres pris dans les zones, "Total" natation exact.
"weekSummary" : 2-3 phrases adressées à l'athlète sur la logique de cette semaine.`;
  return { system: coachSystemPrompt(ctx.language), prompt: prompt.replace(/\n{3,}/g, '\n\n') };
}

export function buildReviewPrompt(ctx, { weeks, violations, scope = ['N', 'N+1'] }) {
  const problems = (violations || [])
    .filter((v) => scope.includes(v.week) || !v.week)
    .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1))
    .map((v) => `- [${v.severity === 'error' ? 'OBLIGATOIRE' : 'à améliorer'}] ${v.message}`)
    .join('\n');
  const w = ctx.wizardData;
  const prompt = `${weekHeader(ctx)}
Tu relis le plan ci-dessous comme un coach expérimenté relit le travail de son assistant, puis tu le corriges.

RAPPEL DU CONTEXTE
${describeGoal(w)} · phase ${ctx.phase?.name || 'Base'} · forme ${w.fitnessLevel}/5 · ${EXPERIENCE_LABELS[w.trainingExperience] || ''}
${constraintsBlock(ctx)}
ZONES
${zonesBlock(ctx)}

PLAN ACTUEL (semaines ${scope.join(' et ')} à corriger${scope.length === 1 ? ` ; l'autre semaine est donnée pour contexte et ne doit PAS être modifiée` : ''}) :
${planJsonForPrompt(weeks)}

PROBLÈMES DÉTECTÉS AUTOMATIQUEMENT
${problems || '- aucun'}

TA TÂCHE
1. Corrige tous les problèmes "OBLIGATOIRE", puis les "à améliorer" quand c'est pertinent.
2. Relis ensuite chaque séance et la semaine dans son ensemble : cohérence interne (titre, intensité, zones, durée = somme des blocs, "Total" natation = somme des séries), séances clés bien espacées, répartition des disciplines conforme, progression N → N+1 cohérente avec la phase${ctx.hasSwim ? ', natation dans la même logique de phase que vélo/course et typée pour le format' : ''}.
3. Ne touche pas à ce qui est correct. Chaque correction = séance COMPLÈTE avec son "week" : même id pour remplacer, nouvel id pour ajouter, type "REPOS" pour supprimer une séance.
4. "issues" : une phrase par problème réellement corrigé. Si tout est correct, renvoie deux tableaux vides.`;
  return { system: coachSystemPrompt(ctx.language), prompt };
}

export function buildChatPrompt(ctx, { message, history = [], workouts = {}, intent = null, constraints = {} }) {
  const labelsN = weekDateLabels(ctx.today, 0);
  const labelsN1 = weekDateLabels(ctx.today, 1);
  const feedbackById = new Map((ctx.feedbackHistory || []).map((f) => [f.workoutId, f]));
  const w = ctx.wizardData;

  const intentLine = intent === 'add'
    ? `L'athlète veut AJOUTER une séance (patchMode "add"). ${constraints?.maxSessionsPerWeek ? `Cela dépasse les ${constraints.maxSessionsPerWeek} séances/semaine déclarées : dis-le et propose d'alléger une autre séance si le volume ne le permet pas.` : ''}`
    : intent === 'modify'
      ? 'L\'athlète veut MODIFIER une séance existante (patchMode "modify" avec son targetId), sans changer le nombre de séances.'
      : '';

  const conversation = (history || [])
    .slice(-8)
    .map((m) => `${m.sender === 'user' ? 'Athlète' : 'Coach'} : ${String(m.text || '').replace(/\s+/g, ' ').slice(0, 600)}`)
    .join('\n');

  const system = `Tu es TRI COACH, le coach personnel de ${w.firstName || ctx.resolvedProfile.firstName || 'l\'athlète'} (${sportLabel(ctx.sportType)}). Vous échangez par messages dans une application mobile.

STYLE
- Direct, chaleureux sans flatterie, concret. Tutoiement. 2 à 6 phrases en général ; plus long seulement si l'athlète demande une explication ou une analyse.
- Appuie-toi sur SES données (séances prévues avec leurs dates, ressentis, zones, signaux) et cite les chiffres utiles.
- Mise en forme légère : "- " pour une courte liste, **gras** avec parcimonie, pas de titres.

HONNÊTETÉ ET SÉCURITÉ
- N'invente jamais une donnée (activité Strava, allure, FC, date). Si une information manque, dis-le ou demande-la.
- Douleur aiguë, inhabituelle, ou qui persiste plus de quelques jours : conseille d'arrêter la discipline concernée et de consulter un professionnel de santé, en plus d'adapter le plan.

MODIFICATIONS DU PLAN (champ "patches")
- Uniquement si l'athlète demande un changement, ou si une douleur/fatigue signalée l'impose.
- Si la demande est ambiguë (quelle séance ? quelle semaine ?), pose UNE question précise et renvoie "patches": [].
- Chaque patch : "week" (N ou N+1 — utilise les dates : "demain", "mardi prochain"…), "patchMode", "targetId" (id entre crochets dans le plan), et la séance COMPLÈTE.
- Change le minimum nécessaire ; garde le nombre de séances et le repos obligatoire sauf demande explicite ; respecte les règles de récupération.
- Dans "reply", dis en une phrase ce que tu as changé.

${sessionConventions(ctx.language)}`;

  const prompt = `${weekHeader(ctx)}

ATHLÈTE : ${w.firstName || ctx.resolvedProfile.firstName || '—'} · ${describeGoal(w)} le ${w.targetDate || '?'} · phase ${ctx.phase?.name || '?'} · forme ${w.fitnessLevel || '?'}/5 · ${EXPERIENCE_LABELS[w.trainingExperience] || ''}
Contraintes : ${w.maxSessionsPerWeek || '?'} séances/sem (enchaînement = 2), ~${w.hoursPerWeek || '?'} h/sem, repos obligatoire : ${w.offDays || 'aucun'}.
${physioBlock(ctx)}

ZONES
${zonesBlock(ctx)}

${signalsBlock(ctx)}

${athletePrioritiesBlock(ctx)}

${historyBlock(ctx)}

${realLoadBlock(ctx)}

PLAN — SEMAINE N${ctx.weekInfo?.N ? ` (${ctx.weekInfo.N.label}, ~${ctx.weekHours.N} h)` : ''}
${compactWeek(workouts.N, labelsN, feedbackById) || '(vide)'}

PLAN — SEMAINE N+1${ctx.weekInfo?.['N+1'] ? ` (${ctx.weekInfo['N+1'].label}, ~${ctx.weekHours['N+1']} h)` : ''}
${compactWeek(workouts['N+1'], labelsN1, feedbackById) || '(vide)'}

${conversation ? `CONVERSATION RÉCENTE\n${conversation}\n` : ''}
MESSAGE DE L'ATHLÈTE
"${String(message || '').slice(0, 2000)}"
${intentLine}`;

  return { system, prompt: prompt.replace(/\n{3,}/g, '\n\n') };
}

export { EXPERIENCE_RANK, EXPERIENCE_LABELS, classifyDiscipline };
