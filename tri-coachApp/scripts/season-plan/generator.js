// scripts/season-plan/generator.js
//
// GÉNÉRATEUR DU PLAN DE SAISON (écrit par Claude, déterministe — aucune IA à l'exécution).
// Entrée : une configuration (repères physiologiques, calendrier des semaines, contraintes).
// Sortie : un plan au format « tri-coach-season-plan » v1 (lib/seasonImport.js), importable
// dans l'app (Réglages > Plan de saison complet).
//
// Toutes les allures, puissances et distances sont CALCULÉES à partir des repères de la
// configuration (FTP, VMA, CSS, zones cardio) : changer un repère et relancer le générateur
// met tout le plan à jour. Les zones suivent celles de l'app (lib/zones.js).
//
// Règles appliquées (contraintes de l'athlète et méthodes documentées, voir
// REVUE_IA_2026-09.md) :
//   - dimanche repos complet (sauf jour de course) ; 15 séances en semaine de charge/décharge ;
//   - natation 4×/semaine, jamais deux le même jour, ≥ 2500 m par séance (récupération
//     comprise), éducatifs nommés et séries variées dans chaque séance, une séance longue ;
//   - créneaux club à Bordeaux : natation mardi matin, mercredi midi, vendredi matin ; piste
//     le jeudi soir ;
//   - cycle 3 semaines de charge / 1 de décharge ; affûtage avant les courses clés ;
//   - intensité polarisée ; VO2max en 4×4 et intervalles à départ rapide ; double seuil
//     norvégien 1 jour toutes les deux semaines de développement (contrôlé, juste sous le seuil).

import { estimateSwimMetersFromDesc } from '../../lib/planValidation';
import { varietySwimBlocks } from '../../lib/swimPlanning';

// ------------------------------------------------------------------ repères et formats
const round5 = (x) => Math.round(x / 5) * 5;
const fmtDur = (min) => {
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
};
const paceStr = (secPerKm) => `${Math.floor(secPerKm / 60)}:${String(Math.round(secPerKm % 60)).padStart(2, '0')}`;

export function buildPaces(a) {
  const vma = a.vma;
  const pace = (pct) => paceStr(3600 / (vma * pct)); // min/km depuis % VMA
  const ftp = a.ftp;
  const w = (pct) => Math.round((ftp * pct) / 5) * 5;
  const [cm, cs] = String(a.css).split(':').map(Number);
  const cssSec = cm * 60 + cs;
  const swim = (delta) => paceStr(cssSec + delta).replace(/^(\d+):/, '$1:');
  const hr = a.hrZones;
  return {
    run: {
      recup: `${pace(0.58)}-${pace(0.55)}`, z2: `${pace(0.66)}-${pace(0.62)}`, tempo: `${pace(0.79)}-${pace(0.77)}`,
      seuil: `${pace(0.87)}-${pace(0.85)}`, dt: pace(0.84), dtPm: pace(0.87), r5k: pace(0.92), r10k: pace(0.88),
      vmaLong: pace(0.95), x4: pace(0.94), vmaCourt: pace(1.02),
      t400: paceStr((400 / (vma * 1.02 / 3.6))).replace(/^0:/, ''), t1000: paceStr(1000 / (vma * 0.95 / 3.6)),
    },
    bike: {
      z1: `<${w(0.55)}W`, z2: `${w(0.62)}-${w(0.71)}W`, z2mid: `${w(0.67)}W`, force: `${w(0.8)}-${w(0.83)}W`,
      ss: `${w(0.88)}-${w(0.93)}W`, seuil: `${w(0.95)}-${w(0.99)}W`, vo2: `${w(1.1)}-${w(1.14)}W`, fast: `${w(1.2)}W`, fastHold: `${w(1.0)}-${w(1.03)}W`,
      relance: `${w(1.25)}W`, raceS: `${w(0.97)}-${w(1.0)}W`, raceM: `${w(0.9)}-${w(0.93)}W`, recov: `${w(0.5)}W`,
    },
    swim: { css: swim(0), z2: swim(10), z1: swim(20), fast: swim(-6), cssPlus2: swim(2), cssPlus5: swim(5) },
    hr: {
      z1: `Z1 (<${hr.z2[0]} bpm)`, z2: `Z2 (${hr.z2[0]}-${hr.z2[1]} bpm)`, z3: `Z3 (${hr.z3[0]}-${hr.z3[1]} bpm)`,
      z4: `Z4 (${hr.z4[0]}-${hr.z4[1]} bpm)`, z5: `Z5 (≥${hr.z5[0]} bpm)`,
    },
    cssMin: cssSec / 60,
  };
}

// ------------------------------------------------------------------ natation
function swimSession(P, { title, wu, body, cd, target, intensity, effortZone, rpe, restTime, structure, seed = 0, easy = false }) {
  const lines = [...wu, ...body, ...cd];
  const desc0 = `Échauffement :\n${wu.join('\n')}\nCorps de séance :\n${body.join('\n')}\n---\n${cd.join('\n')}`;
  let total = estimateSwimMetersFromDesc(desc0);
  let bodyLines = [...body];
  if (target && total < target) {
    bodyLines = [...bodyLines, ...varietySwimBlocks(target - total, easy ? 'recovery' : 'aerobic', seed)];
    total = target;
  }
  const desc = `Échauffement :\n${wu.join('\n')}\nCorps de séance :\n${bodyLines.join('\n')}\n---\n${cd.join('\n')}\nTotal : ${total}m`;
  const check = estimateSwimMetersFromDesc(desc);
  if (Math.abs(check - total) > 0) throw new Error(`Natation « ${title} » : total ${total} ≠ séries ${check}`);
  const minutes = round5((total / 100) * P.cssMin * 1.25 * (easy ? 1.1 : 1));
  return {
    type: 'NATATION', title, duration: fmtDur(minutes), intensity, effortZone, cardio: effortZone.includes('Z4') || effortZone.includes('Z5') ? P.hr.z4 : P.hr.z2,
    rpe, cadence: '', restTime, structure: `${structure} (${total} m).`, desc, _lines: lines.length,
  };
}

const SWIM = {
  long(P, v, target) {
    const variants = [
      { wu: ['400 NC souple Z1', "4*50 éducatifs (rattrapé / poings fermés) R : 15''"], body: [`3*600 PULL Z2 respiration 5 temps R : 30''`, "pyramide 100-200-300-200-100 NC Z2-Z3 R : 20''"], cd: ['200 dos / crawl souple'], s: 'Longue : blocs PULL, pyramide' },
      { wu: ['300 NC souple Z1', '100 dos', "6*50 éducatifs (3-3-3 / 6 battements-1 bras) R : 15''"], body: [`4*400 NC dégressif Z2 → CSS+5'' R : 30''`, "8*50 jambes avec planche R : 15''", "4*200 PULL PLAQ Z2 R : 20''"], cd: ['200 souple'], s: 'Longue : 400 dégressifs, jambes, PULL PLAQ' },
      { wu: ['400 NC souple Z1', "4*50 godille / rattrapé R : 15''"], body: ["2*(800 NC Z2 respiration 3 / 5 temps R : 45'')", `6*100 NC @CSS+5'' R : 15''`, "4*50 crawl tête haute (visée) R : 20''"], cd: ['300 dos / brasse souple'], s: 'Longue : 2×800, 100 allure, visée' },
      { wu: ['400 NC souple Z1', "8*25 éducatifs (doigts traînants / poings fermés) R : 15''"], body: ['1500 NC Z2 continu respiration 3 temps', "6*150 PULL PLAQ Z2-Z3 R : 20''", "4*50 4 nages R : 20''"], cd: ['200 souple'], s: 'Longue : 1500 continu, PULL PLAQ, 4 nages' },
    ];
    const x = variants[v % variants.length];
    return swimSession(P, { title: 'Natation longue aérobie', ...x, target, intensity: `${P.swim.z2} /100m`, effortZone: 'Z2', rpe: 'RPE 5/10', restTime: "15-45''", structure: x.s, seed: v });
  },
  css(P, v, k, target) {
    const reps = Math.min(16, 8 + 2 * k);
    const variants = [
      { wu: ['400 NC souple Z1', "4*50 éducatifs (rattrapé) R : 15''", "4*50 progressif R : 15''"], body: [`${reps}*100 NC @CSS ${P.swim.css} R : 15''`, "4*50 jambes avec planche R : 15''", '400 PULL Z2 respiration 5 temps'], cd: ['200 souple'], s: `Seuil CSS : ${reps}×100` },
      { wu: ['300 NC souple Z1', "6*50 éducatifs (3-3-3 / doigts traînants) R : 15''"], body: [`${Math.min(8, 4 + k)}*200 NC @CSS+2'' ${P.swim.cssPlus2} R : 20''`, "4*100 PULL PLAQ Z2 R : 15''", "4*50 dégressif R : 20''"], cd: ['200 dos / crawl souple'], s: `Seuil CSS : ${Math.min(8, 4 + k)}×200` },
      { wu: ['400 NC souple Z1', "4*50 éducatifs (poings fermés) R : 15''"], body: [`${Math.min(4, 2 + Math.floor(k / 2))}*(4*100 @CSS R : 10'' / 100 souple R : 30'')`, "4*50 crawl tête haute (visée) R : 20''"], cd: ['300 souple'], s: 'Seuil CSS : séries de 4×100' },
      { wu: ['400 NC souple Z1', "4*50 godille / rattrapé R : 15''"], body: [`${Math.min(5, 3 + Math.floor(k / 2))}*300 NC @CSS R : 30''`, "6*50 jambes avec planche R : 15''", '200 PULL Z2'], cd: ['200 souple'], s: 'Seuil CSS : 300 au seuil' },
    ];
    const x = variants[v % variants.length];
    return swimSession(P, { title: 'Natation seuil (CSS)', ...x, target, intensity: `CSS ${P.swim.css} /100m`, effortZone: 'Z4', rpe: 'RPE 7/10', restTime: "10-30''", structure: x.s, seed: v + 1 });
  },
  speed(P, v, target) {
    const variants = [
      { wu: ['400 NC souple Z1', "4*50 éducatifs (poings fermés) R : 15''"], body: ["8*50 départ à fond (25 vite / 25 souple) R : 30''", "3*(100 à fond R : 1' / 300 allure S R : 30'')", "4*50 crawl tête haute (visée) R : 20''"], cd: ['300 dos / crawl souple'], s: 'Vitesse et départs groupés' },
      { wu: ['300 NC souple Z1', "6*50 éducatifs (rattrapé / 3-3-3) R : 15''"], body: ["12*50 à fond R : 30''", "4*200 PULL PLAQ Z2 R : 20''", "4*50 jambes avec planche R : 15''"], cd: ['300 souple'], s: 'Vitesse pure : 12×50 à fond' },
      { wu: ['400 NC souple Z1', "4*50 godille / rattrapé R : 15''"], body: ["pyramide 50-100-150-100-50 allure S R : 20''", "4*(25 sprint + 75 souple)", '400 PULL Z2 respiration 5 temps'], cd: ['200 souple'], s: 'Vitesse : pyramide allure S, sprints' },
      { wu: ['400 NC souple Z1', "4*50 éducatifs (doigts traînants) R : 15''"], body: ["2*(200 all HALF R : 40'' / 2*50 all S R : 20'' / 100 à fond R : 1')", "6*50 départ plongé à fond R : 30''", '200 PULL Z2'], cd: ['300 dos / crawl souple'], s: 'Allures de course mêlées (façon club)' },
    ];
    const x = variants[v % variants.length];
    return swimSession(P, { title: 'Natation vitesse', ...x, target, intensity: `${P.swim.fast} /100m et à fond`, effortZone: 'Z2-Z5', rpe: 'RPE 7/10', restTime: "20''-1'", structure: x.s, seed: v + 2 });
  },
  drills(P, v, target) {
    const variants = [
      { wu: ['400 NC souple Z1'], body: ["4*100 éducatifs (rattrapé / poings fermés / 3-3-3 / doigts traînants) R : 15''", "3*400 NC Z2 respiration 3 / 5 temps R : 20''", "4*50 jambes avec planche R : 15''"], cd: ['400 dos / crawl souple'], s: 'Éducatifs et aérobie' },
      { wu: ['300 NC souple Z1', '100 dos'], body: ["6*50 godille / rattrapé R : 15''", "pyramide 100-200-300-200-100 NC Z2 R : 20''", "4*100 PULL PLAQ Z2 R : 15''"], cd: ['300 souple'], s: 'Éducatifs, pyramide, PULL PLAQ' },
      { wu: ['400 NC souple Z1'], body: ["4*(4*50 éducatifs R : 15'' / 200 NC Z2 R : 20'')", "4*50 crawl tête haute (visée) R : 20''"], cd: ['400 dos / brasse souple'], s: 'Éducatifs en séries, visée' },
      { wu: ['400 NC souple Z1', "4*50 éducatifs (3-3-3) R : 15''"], body: ["6*200 NC Z2 respiration 3 / 5 / 7 temps R : 20''", "8*25 battements sur le côté R : 15''", '200 PULL Z2'], cd: ['300 dos / crawl souple'], s: 'Aérobie, respiration, battements' },
    ];
    const x = variants[v % variants.length];
    return swimSession(P, { title: 'Natation éducatifs et aérobie', ...x, target, intensity: `${P.swim.z2} /100m`, effortZone: 'Z1-Z2', rpe: 'RPE 4/10', restTime: "15-20''", structure: x.s, seed: v + 3 });
  },
  recovery(P, v, target) {
    return swimSession(P, {
      title: 'Natation récupération', wu: ['400 NC souple Z1', "4*50 dos souple R : 15''"],
      body: ["4*50 éducatifs (godille / rattrapé) R : 15''", '300 PULL souple respiration 3 temps', "4*100 NC Z1 relâché R : 20''", "4*50 brasse / crawl en alternance R : 15''"],
      cd: ['300 souple'], target, intensity: `${P.swim.z1} /100m`, effortZone: 'Z1', rpe: 'RPE 3/10', restTime: "15-20''", structure: 'Récupération en nage variée', seed: v + 4, easy: true,
    });
  },
  openWater(P, v, target) {
    return swimSession(P, {
      title: 'Eau libre (lac) ou bassin spécifique', wu: ['400 NC souple Z1', "4*50 éducatifs (crawl tête haute) R : 15''"],
      body: ["6*(200 NC Z2 + 50 accéléré, visée tous les 6 mouvements) R : 20''", "6*50 départ groupé à fond puis 50 allure S R : 30''", "4*100 virage de bouée (demi-tour sans toucher) R : 15''"],
      cd: ['200 souple'], target, intensity: `${P.swim.z2} /100m et allure S`, effortZone: 'Z2-Z4', rpe: 'RPE 6/10', restTime: "15-30''",
      structure: 'Spécifique triathlon : visée, départs, virages (lac si la température le permet, bassin sinon)', seed: v + 5,
    });
  },
};

// ------------------------------------------------------------------ vélo
/** Récupération entre répétitions, lue dans la description (« R : 3' », « - 5' souple »). */
function restFrom(desc, fallback) {
  if (fallback && fallback !== '-') return fallback;
  const m = String(desc).match(/R : ([^)\n]+?)\)/) || String(desc).match(/ - (\d+'(?:\d+)?(?:'')? (?:souple|trot|Z2))/);
  return m ? m[1].trim() : (/\d+\s*\*/.test(desc) ? 'voir la séance' : '-');
}

function bike(P, { title, minutes, intensity, effortZone, rpe, cadence = '85-95 rpm', restTime = '-', structure, desc }) {
  restTime = restFrom(desc, restTime);
  const cardio = { Z1: P.hr.z1, Z2: P.hr.z2, Z3: P.hr.z3, Z4: P.hr.z4, Z5: P.hr.z5 }[effortZone.split('-').pop()] || P.hr.z2;
  return { type: 'CYCLISME', title, duration: fmtDur(minutes), intensity, effortZone, cardio, rpe, cadence, restTime, structure, desc };
}
const BIKE = {
  endurance: (P, minutes, v = 0) => {
    const body = minutes - 25;
    const extras = [
      `${fmtDur(body)} continu @${P.bike.z2mid} Z2, cadence libre`,
      `${fmtDur(body)} @${P.bike.z2} Z2 dont 6*1' haute cadence 105-110 rpm (R : 4')`,
      `${fmtDur(body)} @${P.bike.z2} Z2 dont 4*5' en position basse sur les cocottes`,
    ];
    return bike(P, { title: 'Endurance Z2', minutes, intensity: P.bike.z2mid, effortZone: 'Z2', rpe: 'RPE 4/10', structure: `Sortie continue Z2 ${fmtDur(minutes)}.`, desc: `Échauffement :\n15' progressif\nCorps de séance :\n${extras[v % extras.length]}\nRetour au calme :\n10' souple` });
  },
  velocite: (P, minutes) => bike(P, { title: 'Vélocité souple', minutes, intensity: P.bike.z1, effortZone: 'Z1-Z2', rpe: 'RPE 3/10', cadence: '95-110 rpm', structure: `Récupération active ${fmtDur(minutes)} avec vélocité.`, desc: `Échauffement :\n10' très souple\nCorps de séance :\n${fmtDur(minutes - 15)} Z1-Z2 dont 6*1' à 110 rpm (R : 3')\nRetour au calme :\n5' souple` }),
  force: (P, k) => {
    const n = Math.min(7, 4 + k);
    const minutes = 25 + n * 13 + 10;
    return bike(P, { title: `Force basse cadence ${n}×8'`, minutes, intensity: P.bike.force, effortZone: 'Z3', rpe: 'RPE 6/10', cadence: '55-60 rpm', restTime: "5' souple", structure: `Échauffement 20', ${n}×8' en force basse cadence, retour au calme.`, desc: `Échauffement :\n20' progressif + 3*1' vélocité\nCorps de séance :\n${n}*(8' @${P.bike.force} à 55-60 rpm, assis - 5' souple)\nRetour au calme :\n10' souple` });
  },
  sweetSpot: (P, k) => {
    const sets = [[3, 15], [3, 18], [3, 20], [2, 30]][Math.min(3, k)];
    const minutes = 25 + sets[0] * sets[1] + (sets[0] - 1) * 5 + 15;
    return bike(P, { title: `Sweet spot ${sets[0]}×${sets[1]}'`, minutes, intensity: P.bike.ss, effortZone: 'Z3-Z4', rpe: 'RPE 7/10', restTime: "5' souple", structure: `Échauffement 20', ${sets[0]}×${sets[1]}' sweet spot, retour au calme.`, desc: `Échauffement :\n20' progressif + 3*1' vélocité\nCorps de séance :\n${sets[0]}*(${sets[1]}' @${P.bike.ss} - 5' souple)\nRetour au calme :\n15' souple` });
  },
  threshold: (P, k) => {
    const sets = [[4, 10], [3, 15], [3, 18], [2, 20]][Math.min(3, k)];
    const minutes = 25 + sets[0] * sets[1] + (sets[0] - 1) * 5 + 15;
    return bike(P, { title: `Seuil ${sets[0]}×${sets[1]}'`, minutes, intensity: P.bike.seuil, effortZone: 'Z4', rpe: 'RPE 8/10', restTime: "5' souple", structure: `Échauffement 20', ${sets[0]}×${sets[1]}' au seuil, retour au calme.`, desc: `Échauffement :\n20' progressif + 3*1' vélocité\nCorps de séance :\n${sets[0]}*(${sets[1]}' @${P.bike.seuil} - 5' souple)\nRetour au calme :\n15' souple` });
  },
  vo2: (P, k) => {
    const n = Math.min(6, 4 + k);
    const minutes = 25 + n * 7 + 15;
    return bike(P, { title: `VO2max ${n}×4'`, minutes, intensity: P.bike.vo2, effortZone: 'Z5', rpe: 'RPE 9/10', restTime: "3' souple", structure: `Échauffement 20', ${n}×4' à 90-95 % FCmax (méthode 4×4), récupération active 3'.`, desc: `Échauffement :\n20' progressif + 3*30'' vite\nCorps de séance :\n${n}*(4' @${P.bike.vo2} - 3' souple @${P.bike.recov})\nRetour au calme :\n15' souple` });
  },
  fastStart: (P, k) => {
    const n = Math.min(6, 4 + k);
    const minutes = 25 + n * 7.5 + 15;
    return bike(P, { title: `VO2max départ rapide ${n}×5'`, minutes, intensity: `${P.bike.fast} puis ${P.bike.fastHold}`, effortZone: 'Z5', rpe: 'RPE 9/10', restTime: "2'30 souple", structure: `${n}×5' : 1'30 au-dessus du tenable puis 3'30 juste sous la PMA (temps près de VO2max plus long).`, desc: `Échauffement :\n20' progressif + 3*30'' vite\nCorps de séance :\n${n}*(1'30 @${P.bike.fast} + 3'30 @${P.bike.fastHold} - 2'30 souple)\nRetour au calme :\n15' souple` });
  },
  relances: (P, minutes) => bike(P, { title: 'Relances peloton', minutes, intensity: `${P.bike.z2} et ${P.bike.relance}`, effortZone: 'Z2-Z5', rpe: 'RPE 7/10', structure: 'Endurance avec relances courtes façon course en aspiration.', desc: `Échauffement :\n20' progressif\nCorps de séance :\n${fmtDur(minutes - 35)} @${P.bike.z2} dont 10*(1' @${P.bike.relance} - 4' Z2) et 4*15'' sprint départ arrêté\nRetour au calme :\n15' souple` }),
  long: (P, minutes, phase) => {
    const specific = /spécifique|triathlon|été/i.test(phase);
    const body = specific
      ? `${fmtDur(minutes - 30)} @${P.bike.z2} dont 3*12' allure course S @${P.bike.raceS} (R : 8' Z2)`
      : /duathlon/i.test(phase)
      ? `${fmtDur(minutes - 30)} @${P.bike.z2} dont 2*20' @${P.bike.raceS} (allure duathlon)`
      : `${fmtDur(minutes - 30)} continu @${P.bike.z2} Z2, relais appuyés en groupe si sortie club`;
    return bike(P, { title: 'Sortie longue', minutes, intensity: P.bike.z2mid, effortZone: specific || /duathlon/i.test(phase) ? 'Z2-Z4' : 'Z2', rpe: 'RPE 5/10', structure: `Sortie longue ${fmtDur(minutes)}${specific ? ' avec blocs allure course' : ''}.`, desc: `Échauffement :\n20' progressif\nCorps de séance :\n${body}\nRetour au calme :\n10' souple, transition rapide vers la course` });
  },
  raceRappel: (P) => bike(P, { title: "Rappel allure course 3×8'", minutes: 75, intensity: P.bike.raceS, effortZone: 'Z4', rpe: 'RPE 7/10', restTime: "4' souple", structure: "Rappel d'intensité court avant une course : 3×8' à allure S.", desc: `Échauffement :\n20' progressif + 3*30'' vite\nCorps de séance :\n3*(8' @${P.bike.raceS} - 4' souple)\nRetour au calme :\n15' souple` }),
  openers: (P, minutes) => bike(P, { title: 'Déblocage avant course', minutes, intensity: P.bike.z2mid, effortZone: 'Z2-Z4', rpe: 'RPE 4/10', structure: 'Sortie courte avec 3 rappels à allure course.', desc: `Échauffement :\n15' progressif\nCorps de séance :\n3*(2' @${P.bike.raceS} - 3' souple)\nRetour au calme :\n${minutes - 30}' souple, vérification du vélo` }),
};

// ------------------------------------------------------------------ course à pied
function run(P, { title, minutes, intensity, effortZone, rpe, restTime = '-', structure, desc, cadence = '176-182 spm' }) {
  restTime = restFrom(desc, restTime);
  const cardio = { Z1: P.hr.z1, Z2: P.hr.z2, Z3: P.hr.z3, Z4: P.hr.z4, Z5: P.hr.z5 }[effortZone.split('-').pop()] || P.hr.z2;
  return { type: 'C.A.P', title, duration: fmtDur(minutes), intensity: /\d:\d\d/.test(intensity) ? `${intensity} /km` : intensity, effortZone, cardio, rpe, cadence, restTime, structure, desc };
}
const RUN = {
  recup: (P, minutes) => run(P, { title: 'Footing récupération', minutes, intensity: P.run.recup, effortZone: 'Z1', rpe: 'RPE 3/10', structure: `Footing très facile ${fmtDur(minutes)}.`, desc: `Corps de séance :\n${minutes}' très facile @${P.run.recup}/km, sol souple si possible\nRetour au calme :\n5' de mobilité (chevilles, hanches)` }),
  easy: (P, minutes, gainage = false) => run(P, { title: gainage ? 'Footing Z2 + gainage' : 'Footing Z2', minutes, intensity: P.run.z2, effortZone: 'Z2', rpe: 'RPE 4/10', structure: `Footing Z2 ${fmtDur(minutes)}${gainage ? ' puis gainage 15\'' : ''}.`, desc: `Échauffement :\n10' très facile\nCorps de séance :\n${minutes - (gainage ? 25 : 15)}' @${P.run.z2}/km Z2 + 4 lignes droites\nRetour au calme :\n5' facile${gainage ? "\n15' gainage : 3*(planche 45'' / latérale 30''×2 / pont fessier 45'')" : ''}` }),
  long: (P, minutes, withPace = false) => run(P, { title: 'Sortie longue', minutes, intensity: P.run.z2, effortZone: withPace ? 'Z2-Z3' : 'Z2', rpe: 'RPE 5/10', structure: `Sortie longue ${fmtDur(minutes)} Z2${withPace ? ', fin à allure tempo' : ''}.`, desc: `Échauffement :\n15' facile\nCorps de séance :\n${withPace ? `${minutes - 35}' @${P.run.z2}/km Z2 puis 15' @${P.run.tempo}/km` : `${minutes - 20}' @${P.run.z2}/km Z2`}\nRetour au calme :\n5' facile` }),
  hills: (P, k) => { const n = Math.min(12, 8 + k); return run(P, { title: `Côtes ${n}×45''`, minutes: 60, intensity: 'RPE 8-9', effortZone: 'Z5', rpe: 'RPE 8/10', restTime: 'Descente en trot', structure: `Échauffement 20', ${n} côtes de 45'', retour au calme.`, desc: `Échauffement :\n20' footing Z2 + 3 lignes droites\nCorps de séance :\n${n}*(45'' côte 6-8 % à fond contrôlé - descente en trot)\nRetour au calme :\n15' souple` }); },
  tempo: (P, k) => { const sets = [[4, 6], [3, 10], [2, 15], [3, 12]][Math.min(3, k)]; return run(P, { title: `Tempo ${sets[0]}×${sets[1]}'`, minutes: 25 + sets[0] * sets[1] + (sets[0] - 1) * 2 + 10, intensity: P.run.tempo, effortZone: 'Z3', rpe: 'RPE 6/10', restTime: "2' trot", structure: `${sets[0]}×${sets[1]}' tempo.`, desc: `Échauffement :\n20' Z2 + 3 lignes droites\nCorps de séance :\n${sets[0]}*(${sets[1]}' @${P.run.tempo}/km - 2' trot)\nRetour au calme :\n10' facile` }); },
  threshold: (P, k) => { const sets = [[3, 8], [3, 10], [2, 15], [4, 8]][Math.min(3, k)]; return run(P, { title: `Seuil ${sets[0]}×${sets[1]}' (piste)`, minutes: 25 + sets[0] * sets[1] + (sets[0] - 1) * 2 + 10, intensity: P.run.seuil, effortZone: 'Z4', rpe: 'RPE 7/10', restTime: "2' trot", structure: `${sets[0]}×${sets[1]}' au seuil.`, desc: `Échauffement :\n20' Z2 + gammes + 3 lignes droites\nCorps de séance :\n${sets[0]}*(${sets[1]}' @${P.run.seuil}/km - 2' trot)\nRetour au calme :\n10' facile` }); },
  vmaShort: (P, k) => { const n = Math.min(16, 10 + 2 * k); return run(P, { title: `VMA courte ${n}×400 m (piste)`, minutes: 30 + Math.round(n * 2.6) + 10, intensity: P.run.vmaCourt, effortZone: 'Z5', rpe: 'RPE 9/10', restTime: "1'15 trot", structure: `${n}×400 m à 100-105 % VMA (≈ ${P.run.t400} au 400).`, desc: `Échauffement :\n20' Z2 + gammes + 3 lignes droites\nCorps de séance :\n${n}*(400 m @${P.run.vmaCourt}/km ≈ ${P.run.t400} - 1'15 trot)\nRetour au calme :\n10' facile` }); },
  vmaLong: (P, k) => { const n = Math.min(6, 4 + k); return run(P, { title: `VMA longue ${n}×1000 m (piste)`, minutes: 30 + n * 5.5 + 10, intensity: P.run.vmaLong, effortZone: 'Z5', rpe: 'RPE 9/10', restTime: "2' trot", structure: `${n}×1000 m à 95 % VMA (≈ ${P.run.t1000}).`, desc: `Échauffement :\n20' Z2 + gammes + 3 lignes droites\nCorps de séance :\n${n}*(1000 m @${P.run.vmaLong}/km - 2' trot)\nRetour au calme :\n10' facile` }); },
  x4: (P) => run(P, { title: "VO2max 4×4' (piste)", minutes: 60, intensity: P.run.x4, effortZone: 'Z5', rpe: 'RPE 9/10', restTime: "3' trot", structure: "4×4' à 90-95 % FCmax (méthode 4×4), récupération active 3'.", desc: `Échauffement :\n20' Z2 + gammes + 3 lignes droites\nCorps de séance :\n4*(4' @${P.run.x4}/km - 3' trot)\nRetour au calme :\n12' facile` }),
  dtAm: (P) => run(P, { title: "Double seuil (matin) 5×6'", minutes: 60, intensity: P.run.dt, effortZone: 'Z4', rpe: 'RPE 6-7/10', restTime: "1' trot", structure: "Double seuil norvégien, séance 1 : 5×6' CONTRÔLÉS juste sous le seuil, jamais à fond.", desc: `Échauffement :\n15' Z2\nCorps de séance :\n5*(6' @${P.run.dt}/km, RPE 6-7, aisance respiratoire conservée - 1' trot)\nRetour au calme :\n10' facile` }),
  dtPm: (P) => run(P, { title: "Double seuil (soir) 10×3' (piste)", minutes: 60, intensity: P.run.dtPm, effortZone: 'Z4', rpe: 'RPE 7/10', restTime: "45'' trot", structure: "Double seuil norvégien, séance 2 (6-8 h après la 1re) : 10×3' contrôlés.", desc: `Échauffement :\n15' Z2 + gammes\nCorps de séance :\n10*(3' @${P.run.dtPm}/km - 45'' trot)\nRetour au calme :\n10' facile` }),
  brick: (P, minutes, phase) => {
    const specific = /spécifique|triathlon|été|duathlon/i.test(phase);
    return run(P, { title: 'Course enchaînée (après le vélo)', minutes, intensity: specific ? P.run.r5k : P.run.z2, effortZone: specific ? 'Z2-Z4' : 'Z2', rpe: specific ? 'RPE 7/10' : 'RPE 4/10', structure: `Transition rapide puis ${minutes}' ${specific ? 'avec blocs allure course' : 'en Z2'}.`, desc: `Échauffement :\nT2 rapide (< 1') : chaussures, casquette, dossard\nCorps de séance :\n${specific ? `${minutes - 10}' dont 2*(5' @${P.run.r5k}/km allure 5 km - 2' trot)` : `${minutes - 5}' @${P.run.z2}/km Z2, foulée courte les 5 premières minutes`}\nRetour au calme :\n5' facile` });
  },
  rappel: (P) => run(P, { title: "Rappel allure 5 km 5×3'", minutes: 55, intensity: P.run.r5k, effortZone: 'Z4', rpe: 'RPE 7/10', restTime: "2' trot", structure: "Rappel d'allure course court : 5×3' à allure 5 km.", desc: `Échauffement :\n20' Z2 + gammes + 3 lignes droites\nCorps de séance :\n5*(3' @${P.run.r5k}/km - 2' trot)\nRetour au calme :\n10' facile` }),
  activation: (P, minutes) => run(P, { title: 'Activation avant course', minutes, intensity: P.run.z2, effortZone: 'Z2', rpe: 'RPE 4/10', structure: 'Footing court avec 4 accélérations.', desc: `Corps de séance :\n${minutes - 6}' Z2 + 4*20'' allure course (R : 1')\nRetour au calme :\n2' facile` }),
};

// ------------------------------------------------------------------ semaines
const at = (day, s) => ({ ...s, day });

/** Semaine type selon la nature (charge, décharge, affûtage, course…) et la phase. */
export function buildWeek(P, wk, ctx) {
  const { kind, phase, idx = 3, k = 0, v = 0, race } = wk;
  const f = { 1: 0.9, 2: 0.95, 3: 1 }[idx] || 1;
  const sw = (x) => Math.max(ctx.swimMin, x);
  const isBuild = /développement|spécifique|été/i.test(phase);
  const isDuathlon = /duathlon/i.test(phase);
  const isTri = /triathlon|spécifique|été/i.test(phase);
  const S = [];
  if (kind === 'charge') {
    // Lundi : natation longue (solo), endurance vélo, footing récupération
    S.push(at('Lundi', isTri && /été/i.test(phase) ? SWIM.openWater(P, v, sw(3200)) : SWIM.long(P, v, sw(round5((3600 + 200 * idx) / 100) * 100))));
    S.push(at('Lundi', BIKE.endurance(P, round5(120 * f), v)));
    S.push(at('Lundi', RUN.recup(P, 40)));
    // Mardi : natation club (seuil CSS), sortie longue course, vélocité
    S.push(at('Mardi', SWIM.css(P, v, k, sw(2900))));
    S.push(at('Mardi', RUN.long(P, round5(80 * f), isBuild && idx === 3)));
    S.push(at('Mardi', BIKE.velocite(P, 50)));
    // Jeudi : piste le soir ; double seuil norvégien une semaine sur deux en développement.
    // Règle du double seuil : pas d'autre intensité la VEILLE ni le LENDEMAIN.
    const doubleThreshold = isBuild && ctx.expert && idx === 2 && k % 2 === 0;
    // Mercredi : natation club (éducatifs ou allures mêlées), vélo qualité
    S.push(at('Mercredi', v % 2 === 0 || doubleThreshold ? SWIM.drills(P, v, sw(2800)) : SWIM.speed(P, v + 3, sw(2800))));
    let bikeQ;
    if (doubleThreshold) bikeQ = BIKE.endurance(P, 105, v + 1);
    else if (!isBuild) bikeQ = [BIKE.force(P, k), BIKE.sweetSpot(P, k), BIKE.sweetSpot(P, k + 1)][idx - 1];
    else if (isDuathlon) bikeQ = [BIKE.threshold(P, k), BIKE.vo2(P, k), BIKE.fastStart(P, k)][idx - 1];
    else bikeQ = [BIKE.vo2(P, k), BIKE.relances(P, 120), BIKE.fastStart(P, k)][idx - 1];
    S.push(at('Mercredi', bikeQ));
    if (doubleThreshold) {
      S.push(at('Jeudi', RUN.dtAm(P)));
      S.push(at('Jeudi', RUN.dtPm(P)));
    } else {
      S.push(at('Jeudi', BIKE.endurance(P, 60, v + 1)));
      let runQ;
      if (!isBuild) runQ = k < 2 ? RUN.hills(P, k) : [RUN.tempo(P, k), RUN.vmaShort(P, k - 2), RUN.hills(P, k)][idx - 1];
      else runQ = [RUN.vmaShort(P, k), RUN.x4(P), RUN.threshold(P, k)][idx - 1];
      S.push(at('Jeudi', runQ));
    }
    // Vendredi : natation club (vitesse — éducatifs le lendemain d'un double seuil), footing + gainage, vélo facile
    S.push(at('Vendredi', doubleThreshold ? SWIM.drills(P, v + 1, sw(2700)) : SWIM.speed(P, v, sw(2700))));
    S.push(at('Vendredi', RUN.easy(P, 45, true)));
    S.push(at('Vendredi', BIKE.endurance(P, round5(75 * f), v + 2)));
    // Samedi : sortie longue + course enchaînée
    S.push(at('Samedi', BIKE.long(P, round5(210 * f), phase)));
    S.push(at('Samedi', RUN.brick(P, (idx === 3 ? 30 : 25) + (/été/i.test(phase) ? 15 : 0), phase)));
  } else if (kind === 'decharge' || kind === 'transition' || kind === 'recovery') {
    const t = kind === 'transition' ? 0.8 : kind === 'recovery' ? 0.85 : 1;
    S.push(at('Lundi', SWIM.drills(P, v, sw(3000))));
    S.push(at('Lundi', BIKE.endurance(P, round5(90 * t), v)));
    S.push(at('Lundi', RUN.recup(P, 35)));
    S.push(at('Mardi', kind === 'recovery' ? SWIM.recovery(P, v, sw(2500)) : SWIM.css(P, v + 1, 0, sw(2600))));
    S.push(at('Mardi', RUN.easy(P, round5(55 * t))));
    S.push(at('Mardi', BIKE.velocite(P, 45)));
    S.push(at('Mercredi', SWIM.drills(P, v + 1, sw(2600))));
    S.push(at('Mercredi', BIKE.endurance(P, round5(75 * t), v + 1)));
    S.push(at('Jeudi', BIKE.velocite(P, 50)));
    S.push(at('Jeudi', RUN.easy(P, round5(50 * t))));
    S.push(at('Vendredi', SWIM.recovery(P, v, sw(2500))));
    S.push(at('Vendredi', RUN.recup(P, 35)));
    S.push(at('Vendredi', BIKE.velocite(P, 50)));
    S.push(at('Samedi', BIKE.endurance(P, round5(135 * t), v + 2)));
    S.push(at('Samedi', RUN.brick(P, 20, 'base')));
  } else if (kind === 'taper') {
    S.push(at('Lundi', SWIM.drills(P, v, sw(2800))));
    S.push(at('Lundi', BIKE.endurance(P, 90, v)));
    S.push(at('Lundi', RUN.recup(P, 35)));
    S.push(at('Mardi', SWIM.css(P, v, 0, sw(2700))));
    S.push(at('Mardi', RUN.easy(P, 60)));
    S.push(at('Mardi', BIKE.velocite(P, 45)));
    S.push(at('Mercredi', SWIM.speed(P, v, sw(2600))));
    S.push(at('Mercredi', isDuathlon ? BIKE.threshold(P, 0) : BIKE.vo2(P, 0)));
    S.push(at('Jeudi', BIKE.endurance(P, 60, v + 1)));
    S.push(at('Jeudi', isDuathlon ? RUN.vmaShort(P, 0) : RUN.threshold(P, 0)));
    S.push(at('Vendredi', SWIM.recovery(P, v, sw(2500))));
    S.push(at('Vendredi', RUN.easy(P, 40)));
    S.push(at('Vendredi', BIKE.velocite(P, 50)));
    S.push(at('Samedi', BIKE.long(P, 150, phase)));
    S.push(at('Samedi', RUN.brick(P, 20, phase)));
  } else if (kind === 'raceB') {
    // MINI-AFFÛTAGE pour une course secondaire : début de semaine presque normal, rappel
    // d'allure le mercredi, jours faciles avant la course, déblocage la veille. Plus léger si la
    // course tombe dans une semaine de décharge (wk.base === 'decharge').
    const light = wk.base === 'decharge';
    const raceDay = race.day;
    S.push(at('Lundi', light ? SWIM.drills(P, v, sw(2800)) : SWIM.long(P, v, sw(3600))));
    S.push(at('Lundi', BIKE.endurance(P, light ? 75 : 105, v)));
    S.push(at('Lundi', RUN.recup(P, 35)));
    S.push(at('Mardi', SWIM.css(P, v, light ? 0 : k, sw(2700))));
    S.push(at('Mardi', RUN.easy(P, light ? 45 : 60)));
    S.push(at('Mardi', BIKE.velocite(P, 45)));
    S.push(at('Mercredi', SWIM.speed(P, v, sw(2600))));
    S.push(at('Mercredi', BIKE.raceRappel(P)));
    S.push(at('Jeudi', BIKE.endurance(P, 60, v + 1)));
    S.push(at('Jeudi', light || raceDay !== 'Dimanche' ? RUN.easy(P, 40) : RUN.rappel(P)));
    if (raceDay === 'Dimanche') {
      S.push(at('Vendredi', SWIM.recovery(P, v, sw(2500))));
      S.push(at('Vendredi', RUN.recup(P, 30)));
      S.push(at('Samedi', BIKE.openers(P, 40)));
      S.push(at('Samedi', RUN.activation(P, 15)));
    } else {
      S.push(at('Vendredi', BIKE.openers(P, 40)));
      S.push(at('Vendredi', RUN.activation(P, 15)));
    }
    S.push({
      day: raceDay, type: 'ENCHAÎNEMENT', title: `🏁 ${race.name}`, duration: race.duration || '1h05', intensity: 'Allure de course',
      effortZone: 'Z4-Z5', cardio: P.hr.z5, rpe: 'RPE 9/10', cadence: '', restTime: '-', structure: `Course secondaire (préparation) : ${race.name}${race.format ? ` (${race.format})` : ''}.`,
      desc: "Échauffement :\n15-20' progressif avec 3-4 accélérations par discipline\nCorps de séance :\nCourse de préparation : départ et relances à fond, puis gestion ; tester la routine de transition\nRetour au calme :\n10' très facile, hydratation, collation",
    });
  } else if (kind === 'race') {
    const raceDay = race.day;
    const dayBefore = raceDay === 'Dimanche' ? 'Samedi' : 'Vendredi';
    S.push(at('Lundi', SWIM.drills(P, v, sw(2600))));
    S.push(at('Lundi', BIKE.endurance(P, 60, v)));
    S.push(at('Mardi', SWIM.speed(P, v, sw(2500))));
    S.push(at('Mardi', RUN.easy(P, 40)));
    S.push(at('Mercredi', BIKE.openers(P, 60)));
    S.push(at('Mercredi', RUN.recup(P, 30)));
    if (raceDay === 'Dimanche') {
      S.push(at('Jeudi', SWIM.recovery(P, v, sw(2500))));
      S.push(at('Jeudi', RUN.activation(P, 30)));
      S.push(at('Vendredi', BIKE.velocite(P, 45)));
    } else {
      S.push(at('Jeudi', SWIM.recovery(P, v, sw(2500))));
      S.push(at('Jeudi', BIKE.velocite(P, 40)));
    }
    S.push(at(dayBefore, BIKE.openers(P, 40)));
    S.push(at(dayBefore, RUN.activation(P, 15)));
    S.push({
      day: raceDay, type: 'ENCHAÎNEMENT', title: `🏁 ${race.name}`, duration: race.duration || '1h15', intensity: 'Allure de course',
      effortZone: 'Z4-Z5', cardio: P.hr.z5, rpe: 'RPE 9/10', cadence: '', restTime: '-', structure: `Course : ${race.name}${race.format ? ` (${race.format})` : ''}.`,
      desc: "Échauffement :\n15-20' progressif avec 3-4 accélérations par discipline\nCorps de séance :\nCourse — voir ton plan d'exécution (onglet Objectif) ; départ prudent, gestion des relances\nRetour au calme :\n10' très facile, hydratation, collation",
    });
  }
  return S.map((s) => { const { _lines, ...rest } = s; return rest; });
}

// ------------------------------------------------------------------ saison
export function generateSeasonPlan(cfg) {
  const P = buildPaces(cfg.athlete);
  const ctx = { swimMin: cfg.swimMinMeters || 2500, expert: cfg.constraints?.trainingExperience === 'expert' };
  let k = 0; // progression dans la phase
  let lastPhase = null;
  const weeks = cfg.calendar.map((wk, i) => {
    if (wk.phase !== lastPhase) { k = 0; lastPhase = wk.phase; }
    const sessions = buildWeek(P, { ...wk, k, v: i }, ctx);
    if (wk.kind === 'charge' && wk.idx === 3) k += 1;
    const plannedHours = Math.round(sessions.reduce((sum, s) => sum + durMin(s.duration), 0) / 6) / 10;
    return { weekStart: wk.weekStart, phase: wk.phase, kind: wk.kind, label: wk.label, plannedHours, sessions };
  });
  return {
    format: 'tri-coach-season-plan',
    version: 1,
    meta: {
      title: cfg.title, targetDate: cfg.targetDate, startDate: cfg.calendar[0].weekStart, generatedAt: cfg.generatedAt,
      athlete: cfg.athlete.firstName, references: { ftp: cfg.athlete.ftp, vma: cfg.athlete.vma, css: cfg.athlete.css, fcMax: cfg.athlete.fcMax },
      assumptions: cfg.assumptions || [],
    },
    constraints: cfg.constraints || null,
    weeks,
  };
}

export function durMin(d) {
  const s = String(d || '');
  const h = s.match(/(\d+)h(\d+)?/);
  if (h) return Number(h[1]) * 60 + Number(h[2] || 0);
  const m = s.match(/(\d+)\s*min/);
  return m ? Number(m[1]) : 0;
}
