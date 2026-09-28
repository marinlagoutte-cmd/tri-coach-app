import { describe, it, expect } from 'vitest';
import { computeWeekContext, weeksSinceTarget, racesInWeek } from '../lib/seasonPlan';
import { buildLoadCycle } from '../lib/trainingCycle';

const MARIN = {
  hoursPerWeek: 18, maxSessionsPerWeek: 12, targetDate: '2027-06-27', hasExistingTrainingBase: true,
  loadCycle: buildLoadCycle('3:1', 1, '2026-09-28'),
};
const wk = (weekMonday, extra = {}) => computeWeekContext({ wizardData: { ...MARIN, ...extra }, planStartDate: '2026-09-28', weekMonday });

describe('contexte de semaine sur une saison', () => {
  it('base + cycle 3:1 : paliers 90/95/100 % puis décharge 70 %', () => {
    expect(wk('2026-09-28')).toMatchObject({ kind: 'charge', index: 1, phaseKey: 'base', hours: 16.2, sessionsTarget: 12 });
    expect(wk('2026-10-05')).toMatchObject({ kind: 'charge', index: 2, hours: 17.1 });
    expect(wk('2026-10-12')).toMatchObject({ kind: 'charge', index: 3, hours: 18 });
    expect(wk('2026-10-19')).toMatchObject({ kind: 'decharge', hours: 12.6 });
  });

  it('sans base existante : montée progressive pendant la phase de base', () => {
    const early = wk('2026-09-28', { hasExistingTrainingBase: false, loadCycle: null });
    const late = wk('2027-01-04', { hasExistingTrainingBase: false, loadCycle: null });
    expect(early.hours).toBe(15.3); // 85 %
    expect(late.hours).toBeGreaterThan(early.hours);
    expect(late.hours).toBeLessThanOrEqual(18);
  });

  it('affûtage : cycle suspendu, volume décroissant à l\'approche', () => {
    const taper = [wk('2027-06-07'), wk('2027-06-14')];
    taper.forEach((t) => expect(t.kind).toBe('taper'));
    expect(taper.map((t) => t.hours)).toEqual([13.5, 10.8]);
  });

  it('semaine de course : jour J identifié, nombre de séances libre (maximum seulement)', () => {
    expect(wk('2027-06-21')).toMatchObject({ kind: 'race', raceDay: 'Dimanche', raceDate: '2027-06-27', hours: 8.1, sessionsTarget: null, maxSessions: 12 });
  });

  it('après la course : récupération 40 %, 60 %, puis transition 70 % (plus jamais "affûtage")', () => {
    expect(wk('2027-06-28')).toMatchObject({ kind: 'recovery', hours: 7.2, phaseKey: 'recovery' });
    expect(wk('2027-07-05')).toMatchObject({ kind: 'recovery', hours: 10.8 });
    expect(wk('2027-07-12')).toMatchObject({ kind: 'transition', hours: 12.6 });
    expect(wk('2027-10-04')).toMatchObject({ kind: 'transition' });
  });

  it('autre course du calendrier dans la semaine : listée, nombre de séances non imposé', () => {
    const c = computeWeekContext({ wizardData: MARIN, planStartDate: '2026-09-28', weekMonday: '2026-10-05', raceCalendar: [{ name: 'Duathlon de Bègles', date: '2026-10-11', priority: 'B' }] });
    expect(c.otherRaces).toEqual([{ name: 'Duathlon de Bègles', date: '2026-10-11', day: 'Dimanche', priority: 'B' }]);
    expect(c.sessionsTarget).toBeNull();
    expect(racesInWeek([{ name: 'x', date: '2026-10-12' }], '2026-10-05')).toEqual([]);
  });

  it('semaines écoulées depuis l\'objectif', () => {
    expect(weeksSinceTarget('2027-06-27', '2027-07-06')).toBe(2); // semaines calendaires depuis la semaine de course
    expect(weeksSinceTarget('2027-06-27', '2027-06-20')).toBeNull();
  });
});
