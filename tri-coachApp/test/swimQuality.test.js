import { describe, it, expect } from 'vitest';
import { enforceSwimVolumeFloor, enforceSwimQuality, parseDurationMinutes } from '../lib/workouts';
import { weeklySwimTarget, realisticSwimMeters, cssMinutes, longSwimTarget } from '../lib/swimPlanning';
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
  it('densité + séance longue ; la séance allégée pour fatigue reste intacte', () => {
    out = enforceSwimQuality(out, { wizardData: MARIN, nat100: '1:40', weekCtx: { kind: 'charge', phaseKey: 'base' }, weekHours: 19 });
    const byId = Object.fromEntries(out.map((w) => [w.id, w]));
    expect(tot(byId.b)).toBe(1800); // allégée : pas touchée
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
