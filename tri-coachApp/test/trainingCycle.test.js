import { describe, it, expect } from 'vitest';
import { buildLoadCycle, weekLoadInfo, weekHoursTarget, rolloverWorkouts, mondayIso, addWeeksIso } from '../lib/trainingCycle';
import { buildAthleteContext, buildPlanPrompt, buildChatPrompt } from '../lib/coachPrompts';
import { buildValidationContext, validateWeek, normalizeAiWeek } from '../lib/planValidation';
import { MARIN_WIZARD, MARIN_PROFILE, WEEK_N } from './fixtures/marinPlan';

describe('cycle charge/décharge', () => {
  it('lundi de semaine, décalage de semaines', () => {
    expect(mondayIso('2026-09-25')).toBe('2026-09-21');
    expect(mondayIso('2026-09-27')).toBe('2026-09-21'); // dimanche
    expect(addWeeksIso('2026-09-21', 1)).toBe('2026-09-28');
  });

  it('1:1 — la semaine en cours est une charge, la suivante une décharge', () => {
    const cycle = buildLoadCycle('1:1', 1, '2026-09-25');
    expect(cycle.anchor).toBe('2026-09-21');
    expect(weekLoadInfo(cycle, '2026-09-24').kind).toBe('charge');
    expect(weekLoadInfo(cycle, '2026-09-30').kind).toBe('decharge');
    expect(weekLoadInfo(cycle, '2026-10-06').kind).toBe('charge');
  });

  it('3:1 — position déclarée 3 → semaine suivante = décharge, puis charge 1', () => {
    const cycle = buildLoadCycle('3:1', 3, '2026-09-25');
    expect(weekLoadInfo(cycle, '2026-09-25')).toMatchObject({ kind: 'charge', index: 3 });
    expect(weekLoadInfo(cycle, '2026-09-28')).toMatchObject({ kind: 'decharge', index: 4 });
    expect(weekLoadInfo(cycle, '2026-10-05')).toMatchObject({ kind: 'charge', index: 1 });
    // fonctionne aussi pour une date antérieure à l'ancre
    expect(weekLoadInfo(cycle, '2026-09-10')).toMatchObject({ kind: 'charge', index: 1 });
  });

  it('volume de décharge = 70 %', () => {
    expect(weekHoursTarget(18, { kind: 'decharge' })).toBe(12.6);
    expect(weekHoursTarget(18, { kind: 'charge' })).toBe(18);
    expect(weekHoursTarget(18, null)).toBe(18);
  });

  it('aucun cycle → pas d\'info', () => {
    expect(weekLoadInfo(buildLoadCycle('none', 1, '2026-09-25'), '2026-09-25')).toBeNull();
  });
});

describe('bascule de semaine', () => {
  const W = { N: [{ id: 'a' }], 'N+1': [{ id: 'b' }] };
  it('même semaine : inchangé', () => {
    expect(rolloverWorkouts(W, '2026-09-21', '2026-09-27')).toMatchObject({ shifted: 0, weekAnchor: '2026-09-21', workouts: W });
  });
  it('semaine suivante : N+1 devient N', () => {
    const r = rolloverWorkouts(W, '2026-09-21', '2026-09-28');
    expect(r.shifted).toBe(1);
    expect(r.workouts).toEqual({ N: [{ id: 'b' }], 'N+1': [] });
    expect(r.weekAnchor).toBe('2026-09-28');
  });
  it('deux semaines plus tard : tout est périmé', () => {
    expect(rolloverWorkouts(W, '2026-09-21', '2026-10-06').workouts).toEqual({ N: [], 'N+1': [] });
  });
  it('plan sans ancre : ancre posée sur la semaine courante, rien ne bouge', () => {
    expect(rolloverWorkouts(W, null, '2026-09-25')).toMatchObject({ shifted: 0, weekAnchor: '2026-09-21' });
  });
});

describe('intégration prompt + validation', () => {
  const wizard = {
    ...MARIN_WIZARD,
    loadCycle: buildLoadCycle('1:1', 1, '2026-09-25'),
    focusAreas: ['transitions', 'drafting'],
    coachNotes: 'Natation club imposée mardi matin et vendredi matin.',
  };
  it('le prompt donne un volume par semaine, les priorités et les consignes', () => {
    const ctx = buildAthleteContext({ wizardData: wizard, profile: MARIN_PROFILE, clientDate: '2026-09-25' });
    const { prompt } = buildPlanPrompt(ctx);
    expect(prompt).toMatch(/Semaine N = semaine de CHARGE 1\/1 \(phase : [^\n]*\) → ~18 h/);
    expect(prompt).toMatch(/Semaine N\+1 = semaine de DÉCHARGE \(phase : [^\n]*\) → ~12.6 h/);
    expect(prompt).toContain('transitions T1/T2');
    expect(prompt).toContain('Natation club imposée mardi matin');
    const chat = buildChatPrompt(ctx, { message: 'x', workouts: { N: [], 'N+1': [] } });
    expect(chat.prompt).toContain('PLAN — SEMAINE N+1 (semaine de DÉCHARGE, ~12.6 h)');
  });
  it('le validateur juge le volume de la décharge sur sa propre cible', () => {
    const ctx = buildAthleteContext({ wizardData: wizard, profile: MARIN_PROFILE, clientDate: '2026-09-25' });
    const vctx = buildValidationContext({ wizardData: wizard, profile: MARIN_PROFILE, weekHours: ctx.weekHours });
    const week = normalizeAiWeek(WEEK_N, 'N+1'); // ~15h45 : trop pour une décharge à 12,6 h
    expect(validateWeek(week, vctx, 'N+1').map((v) => v.code)).toContain('VOLUME');
    expect(validateWeek(normalizeAiWeek(WEEK_N, 'N'), vctx, 'N').map((v) => v.code)).not.toContain('VOLUME');
  });
});
