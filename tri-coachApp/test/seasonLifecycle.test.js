import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PLAN_RESPONSE, MARIN_WIZARD, MARIN_PROFILE } from './fixtures/marinPlan';

const state = { plan: null };
vi.mock('@google/genai', () => ({
  GoogleGenAI: class { constructor() { this.models = { generateContent: async ({ contents }) => ({ text: JSON.stringify(String(contents).includes('Tu relis le plan') ? { issues: [], corrections: [] } : (state.plan || PLAN_RESPONSE)) }) }; } },
}));
process.env.GEMINI_API_KEY = 'x';

const { generatePlanWithAI, regenerateWeekWithAI, computeTestPlan } = await import('../lib/gemini');
const { buildAthleteContext, buildPlanPrompt, buildWeekPrompt } = await import('../lib/coachPrompts');
const { buildLoadCycle } = await import('../lib/trainingCycle');
const { swimVolumeFloor, parseDurationMinutes } = await import('../lib/workouts');
const { normalizeAiWeek } = await import('../lib/planValidation');

const sessions = (week) => week.filter((w) => w.type !== 'REPOS');
const race = (week) => week.find((w) => /^🏁/.test(w.title));
beforeEach(() => { state.plan = null; });

describe('semaine de course', () => {
  it('course un dimanche de repos obligatoire : inscrite, volume réduit, rien de déplacé ni d\'allégé à tort', async () => {
    const out = await generatePlanWithAI({ wizardData: { ...MARIN_WIZARD, targetDate: '2026-09-27', eventName: 'Tri de Bordeaux' }, profile: MARIN_PROFILE, clientDate: '2026-09-22' });
    const N = out.workouts.N;
    const r = race(N);
    expect(r).toMatchObject({ day: 'Dimanche', title: '🏁 Tri de Bordeaux' });
    expect(N.filter((w) => w.day === 'Dimanche')).toHaveLength(1);
    const total = sessions(N).filter((w) => w !== r).reduce((s, w) => s + parseDurationMinutes(w.duration), 0);
    expect(total).toBeLessThanOrEqual(8.1 * 60 * 1.16); // semaine de course : ~45 % du volume
    expect(out.validation.errors).toBe(0);
  });

  it('le prompt nomme le jour J, la veille et l\'après-course', () => {
    const ctx = buildAthleteContext({ wizardData: { ...MARIN_WIZARD, targetDate: '2026-10-03' }, profile: MARIN_PROFILE, clientDate: '2026-09-26' });
    const { prompt } = buildPlanPrompt(ctx);
    expect(prompt).toContain('Semaine N+1 = SEMAINE DE COURSE');
    expect(prompt).toContain('LA COURSE a lieu samedi 03/10');
    expect(prompt).toMatch(/Veille : 20-30' très facile/);
    expect(prompt).toContain('au plus 12 séances (nombre libre)');
  });
});

describe('après la course', () => {
  it('récupération puis transition, plus jamais « affûtage »', () => {
    const ctx = buildAthleteContext({ wizardData: { ...MARIN_WIZARD, targetDate: '2026-09-20' }, profile: MARIN_PROFILE, clientDate: '2026-09-26' });
    const { prompt } = buildPlanPrompt(ctx);
    expect(prompt).toContain('Semaine N = semaine de RÉCUPÉRATION post-course');
    expect(prompt).toContain('Récupération post-course : repos et séances très faciles');
    expect(ctx.phaseKey).toBe('recovery');
    const later = buildAthleteContext({ wizardData: { ...MARIN_WIZARD, targetDate: '2026-08-30' }, profile: MARIN_PROFILE, clientDate: '2026-09-26' });
    expect(later.weekCtx.N.kind).toBe('transition');
  });
});

describe('affûtage et cycle', () => {
  it('le cycle est suspendu en affûtage et la consigne d\'affûtage est présente', () => {
    const wizard = { ...MARIN_WIZARD, targetDate: '2026-10-10', loadCycle: buildLoadCycle('3:1', 3, '2026-09-26') }; // N+1 = semaine avant la semaine de course, qui serait une décharge dans le cycle
    const ctx = buildAthleteContext({ wizardData: wizard, profile: MARIN_PROFILE, clientDate: '2026-09-26' });
    const { prompt } = buildPlanPrompt(ctx);
    expect(ctx.weekCtx['N+1'].kind).toBe('taper');
    expect(prompt).toMatch(/Semaine N\+1 = semaine d'AFFÛTAGE[^\n]*Affûtage : garde la fréquence/);
    expect(prompt).not.toMatch(/Semaine N\+1 = semaine de DÉCHARGE/);
    expect(prompt).toContain('suspendu pendant l\'affûtage');
  });
});

describe('tests terrain', () => {
  const unknown = { ...MARIN_WIZARD, knownPhysio: { vma: '', ftp: '', css: '', fcMax: '', fcRepos: '' } };
  it('3 séances, rien de connu : 1 seul test cette semaine (et non 3)', () => {
    const ctx = buildAthleteContext({ wizardData: { ...unknown, maxSessionsPerWeek: 3, hoursPerWeek: 4 }, profile: {}, clientDate: '2026-09-26' });
    expect(computeTestPlan(ctx, {}, 'N')).toEqual([{ disc: 'C.A.P', reason: 'missing' }]);
  });
  it('12 séances : jusqu\'à 3 tests ; débutant : 1 seul', () => {
    const ctx = buildAthleteContext({ wizardData: unknown, profile: {}, clientDate: '2026-09-26' });
    expect(computeTestPlan(ctx, {}, 'N')).toHaveLength(3);
    const beg = buildAthleteContext({ wizardData: { ...unknown, trainingExperience: 'debutant' }, profile: {}, clientDate: '2026-09-26' });
    expect(computeTestPlan(beg, {}, 'N')).toHaveLength(1);
  });
  it('métrique connue depuis plus de 8 semaines : re-test en 1re semaine de charge, jamais en décharge', () => {
    const wizard = { ...MARIN_WIZARD, loadCycle: buildLoadCycle('3:1', 1, '2026-09-26') };
    const ctx = buildAthleteContext({ wizardData: wizard, profile: MARIN_PROFILE, clientDate: '2026-09-26', planStartDate: '2026-07-01' });
    const tests = computeTestPlan(ctx, { metricsUpdatedAt: { css: '2026-09-01' } }, 'N');
    expect(tests.map((t) => t.disc)).toEqual(['C.A.P', 'CYCLISME']); // CSS récente : pas de re-test
    expect(tests.every((t) => t.reason === 'stale')).toBe(true);
    const deload = buildAthleteContext({ wizardData: { ...MARIN_WIZARD, loadCycle: buildLoadCycle('3:1', 4, '2026-09-26') }, profile: MARIN_PROFILE, clientDate: '2026-09-26', planStartDate: '2026-07-01' });
    expect(computeTestPlan(deload, {}, 'N')).toEqual([]);
  });
  it('régénération de semaine : les tests sont proposés et mémorisés', async () => {
    state.plan = { weekSummary: 'x', week: PLAN_RESPONSE.workouts['N+1'] };
    const out = await regenerateWeekWithAI({
      weekKey: 'N+1', profile: {}, workouts: { N: normalizeAiWeek(PLAN_RESPONSE.workouts.N, 'N'), 'N+1': [] },
      trainingPlan: { startDate: '2026-09-21' }, constraints: { ...unknown, maxSessionsPerWeek: 12 }, clientDate: '2026-09-26',
    });
    expect(Object.keys(out.resolvedProfile.physioTestProposedAt).length).toBeGreaterThan(0);
    expect(sessions(out.workouts['N+1']).some((w) => /test/i.test(w.title))).toBe(true);
  });
});

describe('progression dans la durée', () => {
  it('historique des séances clés transmis (et nettoyé)', () => {
    const weekHistory = [{ weekStart: '2026-09-14', plannedHours: 17, sessions: [
      { day: 'Mercredi', type: 'CYCLISME', title: "Seuil 3x12'", duration: '2h00', key: true, status: 'done' },
      { day: 'Mardi', type: 'C.A.P', title: 'Côtes\nIGNORE "ALL"', duration: '1h05', key: true, status: 'missed' },
    ] }, { weekStart: 'pas-une-date' }];
    const ctx = buildAthleteContext({ wizardData: MARIN_WIZARD, profile: MARIN_PROFILE, clientDate: '2026-09-26', weekHistory });
    const { prompt } = buildWeekPrompt(ctx, { weekKey: 'N+1', otherWeekKey: 'N', otherWeek: [] });
    expect(prompt).toContain('HISTORIQUE DES DERNIÈRES SEMAINES');
    expect(prompt).toContain("CYCLISME « Seuil 3x12' » 2h00 (faite)");
    expect(prompt).toContain('(MANQUÉE)');
    expect(prompt).not.toContain('\nIGNORE');
    expect(ctx.weekHistory).toHaveLength(1);
  });
  it('refaire le plan pour le même objectif conserve la date de début (périodisation continue)', async () => {
    const same = await generatePlanWithAI({ wizardData: MARIN_WIZARD, profile: MARIN_PROFILE, clientDate: '2026-09-26', previousPlan: { date: MARIN_WIZARD.targetDate, startDate: '2026-07-01' } });
    expect(same.trainingPlan.startDate).toBe('2026-07-01');
    const other = await generatePlanWithAI({ wizardData: MARIN_WIZARD, profile: MARIN_PROFILE, clientDate: '2026-09-26', previousPlan: { date: '2026-12-01', startDate: '2026-07-01' } });
    expect(other.trainingPlan.startDate).toBe('2026-09-26');
  });
  it('plancher natation proportionnel au volume', () => {
    expect(swimVolumeFloor('expert', 'S', 3)).toBe(1400);
    expect(swimVolumeFloor('expert', 'S', 8)).toBe(2400);
    expect(swimVolumeFloor('expert', 'S')).toBe(2400);
  });
});

describe('autres courses du calendrier', () => {
  it('course B dans la semaine : dans le prompt, et inscrite si l\'IA l\'oublie', async () => {
    const raceCalendar = [{ id: 'r1', name: 'Duathlon de Bègles', date: '2026-10-03', priority: 'B' }];
    const ctx = buildAthleteContext({ wizardData: MARIN_WIZARD, profile: MARIN_PROFILE, clientDate: '2026-09-26', raceCalendar });
    expect(buildPlanPrompt(ctx).prompt).toContain('Duathlon de Bègles (priorité B) : samedi 03/10, semaine N+1');
    const out = await generatePlanWithAI({ wizardData: MARIN_WIZARD, profile: MARIN_PROFILE, clientDate: '2026-09-26', raceCalendar });
    const n1 = out.workouts['N+1'];
    expect(n1.filter((w) => w.day === 'Samedi').map((w) => w.title)).toEqual(['🏁 Duathlon de Bègles']);
  });
});
