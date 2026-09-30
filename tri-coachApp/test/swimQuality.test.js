import { describe, it, expect } from 'vitest';
import { enforceSwimVolumeFloor, enforceSwimQuality, parseDurationMinutes, enforceOneSwimPerDay } from '../lib/workouts';
import { validatePlan, buildValidationContext } from '../lib/planValidation';
import { weeklySwimTarget, realisticSwimMeters, cssMinutes, longSwimTarget, swimMinimumMeters } from '../lib/swimPlanning';
import { buildAthleteContext, buildPlanPrompt } from '../lib/coachPrompts';
import { buildLoadCycle } from '../lib/trainingCycle';

const MARIN = { sportType: 'triathlon', triathlonFormat: 'S', hoursPerWeek: 20, maxSessionsPerWeek: 15, offDays: 'Dimanche', fitnessLevel: 5, trainingExperience: 'expert', hasExistingTrainingBase: true, targetDate: '2027-06-27', loadCycle: buildLoadCycle('3:1', 1, '2026-09-21') };
const swim = (id, day, title, duration, total) => ({
  id, day, type: 'NATATION', title, duration, intensity: '1:50 /100m',
  desc: `Échauffement :\n400 NC souple Z1\nCorps de séance :\n${total - 600}m NC Z2\n---\n200 souple\nTotal : ${total}m`,
});
// Les 4 natations réelles de la semaine 40 (plan généré avant ce correctif).
const WEEK = [
  swim('a', 'Lundi', 'Technique et glisse', '1h00', 2400),
  swim('b', 'Mardi', 'Natation endurance technique (allégée)', '45 min', 1800),
  swim('c', 'Mercredi', 'Endurance CSS', '1h00', 2600),
  swim('d', 'Jeudi', 'Technique nage complète', '45 min', 1500),
];
const tot = (w) => Number(String(w.desc).match(/Total : (\d+)m/)[1]);

describe('repères natation', () => {
  it('distance réaliste pour une durée (CSS 1:40) et cible hebdomadaire (expert S, 20 h)', () => {
    expect(realisticSwimMeters(60, cssMinutes('1:40'))).toBe(2900);
    expect(weeklySwimTarget(MARIN)).toBe(14300);
    expect(weeklySwimTarget(MARIN, 19)).toBe(13600); // semaine de charge 2/3
    expect(longSwimTarget(MARIN, { kind: 'charge', phaseKey: 'base' }, 13600)).toBe(4000);
    expect(longSwimTarget(MARIN, { kind: 'decharge', phaseKey: 'base' }, 13600)).toBeNull();
    expect(longSwimTarget({ ...MARIN, trainingExperience: 'intermediaire' }, { kind: 'charge', phaseKey: 'base' })).toBeNull();
  });
});

describe('tes 4 natations réelles, corrigées', () => {
  let out;
  it('les séances « technique » n\'échappent plus au plancher chez un expert', () => {
    out = enforceSwimVolumeFloor(WEEK, 5, 'expert', 'base', 'S', 20);
    expect(tot(out.find((w) => w.id === 'd'))).toBeGreaterThanOrEqual(2400);
  });
  it('densité + séance longue ; minimum 2500 m même pour la séance allégée (demande de l\'athlète)', () => {
    out = enforceSwimQuality(out, { wizardData: MARIN, nat100: '1:40', weekCtx: { kind: 'charge', phaseKey: 'base' }, weekHours: 19 });
    const byId = Object.fromEntries(out.map((w) => [w.id, w]));
    // allégée (fatigue) : portée au minimum de 2500 m, en nage facile et variée, sans densification
    expect(tot(byId.b)).toBe(2500);
    expect(byId.b.desc).toMatch(/dos|godille|éducatifs|brasse|battements/);
    expect(byId.b.autoNote).toMatch(/distance minimale/);
    // plus aucun complément monotone « k*200 NC Z2 » / « k*400 PULL Z2 »
    out.forEach((w) => expect(w.desc).not.toMatch(/\d+\*200 NC Z2 R : 20''|\d+\*400 PULL Z2 R : 30''/));
    // chaque séance non allégée contient ≥ 85 % du réaliste pour sa durée
    ['a', 'c', 'd'].forEach((id) => {
      const w = byId[id];
      expect(tot(w), id).toBeGreaterThanOrEqual(realisticSwimMeters(parseDurationMinutes(w.duration), cssMinutes('1:40')) * 0.85 - 100);
    });
    const longest = Math.max(...out.map(tot));
    expect(longest).toBeGreaterThanOrEqual(4000);
    const total = out.reduce((s, w) => s + tot(w), 0);
    expect(total).toBeGreaterThan(8300 + 2500); // était 8,3 km
    expect(out.some((w) => /Séance longue de la semaine/.test(w.autoNote || ''))).toBe(true);
  });
});

describe('consigne natation du prompt', () => {
  it('volume visé, densité, séance longue, pas de « technique » légère pour un expert', () => {
    const { prompt } = buildPlanPrompt(buildAthleteContext({ wizardData: MARIN, profile: { nat100: '1:40' }, clientDate: '2026-09-28' }));
    expect(prompt).toMatch(/Volume natation visé : semaine N ≈ 13\.6 km dont une séance LONGUE de ~4 km/);
    expect(prompt).toContain('60 min ≈ 2900 m');
    expect(prompt).toContain('PAS de séance « technique » légère');
    expect(prompt).toContain('~75 % facile (Z1-Z2), ~15 % au seuil (CSS), ~10 % au-dessus');
    expect(prompt).not.toContain('séances de récupération/technique : plus courtes');
  });
});

describe('une natation par jour, minimum réglable, séances variées', () => {
  const S = (id, day, type, title, total = 3000) => ({ id, day, type, title, duration: '1h00', desc: type === 'NATATION' ? `Échauffement :\n400 NC souple Z1\n4*50 educ (rattrapé) R : 15''\nCorps de séance :\n${total - 1000}m NC Z2\n4*50 jambes R : 15''\n---\n200 souple\nTotal : ${total}m` : 'x' });

  it('récupération + séance longue le même jour → la récupération change de jour (jamais repos ni enchaînement)', () => {
    const week = [
      S('a', 'Lundi', 'NATATION', 'Séance longue', 4200), S('b', 'Lundi', 'NATATION', 'Récupération', 2500),
      S('c', 'Mardi', 'NATATION', 'Seuil CSS'), S('d', 'Mercredi', 'CYCLISME', 'Vélo'),
      S('e', 'Samedi', 'ENCHAÎNEMENT', 'Brick'), { id: 'z', day: 'Dimanche', type: 'REPOS', title: 'Repos', duration: '0 min', desc: '' },
    ];
    const out = enforceOneSwimPerDay(week, { offDays: 'Dimanche' });
    const b = out.find((w) => w.id === 'b');
    expect(b.day).not.toBe('Lundi');
    expect(['Dimanche', 'Samedi', 'Mardi']).not.toContain(b.day);
    expect(b.autoNote).toMatch(/une seule natation par jour/);
  });

  it('distance minimale : réglée par l\'athlète, sinon selon niveau et volume', () => {
    expect(swimMinimumMeters({ trainingExperience: 'expert', hoursPerWeek: 20 })).toBe(2500);
    expect(swimMinimumMeters({ trainingExperience: 'confirme', hoursPerWeek: 12 })).toBe(2200);
    expect(swimMinimumMeters({ trainingExperience: 'intermediaire', hoursPerWeek: 8 })).toBeNull();
    expect(swimMinimumMeters({ trainingExperience: 'intermediaire', hoursPerWeek: 8, swimMinMeters: 3000 })).toBe(3000);
  });

  it('le validateur signale : séance monotone, deux natations le même jour, sous le minimum', () => {
    const wiz = { ...MARIN, hoursPerWeek: 20 };
    const monotone = { id: 'm', day: 'Lundi', type: 'NATATION', title: 'Endurance', duration: '1h00', intensity: 'RPE 5/10', desc: "Échauffement :\n500 NC souple\nCorps de séance :\n6*600 PULL Z2 R : 20''\n---\n200 souple\nTotal : 4300m" };
    const court = { id: 'r', day: 'Lundi', type: 'NATATION', title: 'Récupération', duration: '30 min', intensity: 'RPE 3/10', desc: "Échauffement :\n200 NC souple\n4*50 educ (godille) R : 15''\nCorps de séance :\n4*100 NC Z1\n4*50 dos\n---\n200 souple\nTotal : 1400m" };
    const ctx = buildValidationContext({ wizardData: wiz, profile: {} });
    const codes = validatePlan({ N: [monotone, court], 'N+1': [] }, ctx).map((v) => v.code);
    expect(codes).toContain('SWIM_MONOTONOUS');
    expect(codes).toContain('SWIM_SAME_DAY');
    expect(codes).toContain('SWIM_MIN_DISTANCE');
  });
});
