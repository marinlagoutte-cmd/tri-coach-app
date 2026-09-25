// Banc d'essai du pipeline IA (lib/gemini.js) avec un modèle simulé.
// Référence : test/fixtures/marinPlan.js = plan cohérent tel qu'un coach l'écrirait.
// Mesure de départ (ancien pipeline, même fixture) : 4 appels IA, prompt de ~28 000
// caractères, 6 séances sur 12 modifiées dont la séance clé de seuil vélo détruite.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PLAN_RESPONSE, MARIN_WIZARD, MARIN_PROFILE, WEEK_N } from './fixtures/marinPlan';

const state = { calls: [], planResponse: null, reviewResponse: null, reviewThrows: false };

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    constructor() {
      this.models = {
        generateContent: async ({ contents, config }) => {
          const prompt = String(contents);
          const isReview = prompt.includes('Tu relis le plan');
          state.calls.push({ isReview, prompt, system: config?.systemInstruction, schema: config?.responseJsonSchema, thinking: config?.thinkingConfig });
          if (isReview) {
            if (state.reviewThrows) throw Object.assign(new Error('boom'), { status: 500 });
            return { text: JSON.stringify(state.reviewResponse || { issues: [], corrections: [] }) };
          }
          return { text: JSON.stringify(state.planResponse || PLAN_RESPONSE) };
        },
      };
    }
  },
}));

process.env.GEMINI_API_KEY = 'test-key';

const clone = (x) => JSON.parse(JSON.stringify(x));
const sessions = (week) => week.filter((w) => w.type !== 'REPOS');

async function run(overrides = {}) {
  const { generatePlanWithAI } = await import('../lib/gemini');
  return generatePlanWithAI({
    wizardData: MARIN_WIZARD, profile: MARIN_PROFILE, feedbackHistory: [], healthHistory: [],
    language: 'fr', provider: 'gemini', clientDate: '2026-09-25', ...overrides,
  });
}

beforeEach(() => {
  state.calls = [];
  state.planResponse = null;
  state.reviewResponse = null;
  state.reviewThrows = false;
});

describe('pipeline — plan cohérent', () => {
  it('ne dégrade aucune séance et ne fait que 2 appels (génération + relecture)', async () => {
    const out = await run();
    expect(state.calls).toHaveLength(2);
    const byId = Object.fromEntries(out.workouts.N.map((w) => [w.id, w]));
    WEEK_N.filter((w) => w.type !== 'REPOS').forEach((orig) => {
      const got = byId[orig.id];
      expect(got, orig.id).toBeTruthy();
      ['day', 'type', 'title', 'duration', 'intensity', 'desc'].forEach((f) => expect(got[f], `${orig.id}.${f}`).toBe(orig[f]));
      expect(got.autoNote).toBeFalsy();
    });
    expect(out.validation.score).toBe(0);
    expect(out.qualityWarnings).toEqual([]);
    expect(out.weekSummary).toMatch(/séances clés/);
  });

  it('utilise instruction système, schéma de sortie et réflexion', async () => {
    await run();
    const gen = state.calls[0];
    expect(gen.system).toMatch(/TRI COACH/);
    expect(gen.schema?.properties?.weekN).toBeTruthy();
    expect(gen.thinking?.thinkingLevel).toBe('MEDIUM');
    expect(gen.prompt.length + gen.system.length).toBeLessThan(12_000);
  });

  it('fait l\'arithmétique à la place du modèle (12 séances, 6 jours → 6 jours doubles)', async () => {
    await run();
    const p = state.calls[0].prompt;
    expect(p).toContain('EXACTEMENT 12 par semaine');
    expect(p).toContain('il faut donc 6 jour(s)');
    expect(p).not.toMatch(/-\d+ jours? REPOS/);
    expect(p).toContain('Semaine N = lun. 21/09 → dim. 27/09');
  });

  it('ancre les dates sur la date locale du client', async () => {
    await run({ clientDate: '2026-09-28' });
    expect(state.calls[0].prompt).toContain('Semaine N = lun. 28/09 → dim. 04/10');
  });

  it('fixe startDate/weekAnchor de façon déterministe', async () => {
    const out = await run();
    expect(out.trainingPlan.startDate).toBe('2026-09-25');
    expect(out.trainingPlan.weekAnchor).toBe('2026-09-21');
    expect(out.trainingPlan.date).toBe(MARIN_WIZARD.targetDate);
    expect(out.trainingPlan.cycles.length).toBeGreaterThan(0);
  });
});

describe('pipeline — plan défectueux', () => {
  function brokenPlan() {
    const plan = clone(PLAN_RESPONSE);
    const N = plan.workouts.N;
    // 1) séance sur le jour de repos obligatoire, 2) allure en km/h
    N.find((w) => w.id === 'n6').day = 'Dimanche';
    N.find((w) => w.id === 'n9').intensity = '15.5 km/h';
    return plan;
  }

  it('la relecture IA répare et ses corrections sont acceptées', async () => {
    state.planResponse = brokenPlan();
    const fixedRun = { ...WEEK_N.find((w) => w.id === 'n6'), week: 'N' };
    const fixedTempo = { ...WEEK_N.find((w) => w.id === 'n9'), week: 'N' };
    state.reviewResponse = {
      issues: [
        { week: 'N', id: 'n6', problem: 'Footing placé le dimanche (repos obligatoire), replacé jeudi.' },
        { week: 'N', id: 'n9', problem: 'Allure en km/h convertie en min/km.' },
      ],
      corrections: [fixedRun, fixedTempo],
    };
    const out = await run();
    expect(out.validation.initialScore).toBeGreaterThan(0);
    expect(out.validation.reviewAccepted).toBe(true);
    expect(out.validation.errors).toBe(0);
    expect(sessions(out.workouts.N).filter((w) => w.day === 'Dimanche')).toHaveLength(0);
    expect(out.workouts.N.find((w) => w.id === 'n9').intensity).toBe('3:50 /km');
    expect(out.autoFixNotes.join(' ')).toMatch(/repos obligatoire/);
    // La relecture a bien reçu la liste des problèmes détectés.
    expect(state.calls[1].prompt).toMatch(/OBLIGATOIRE.*Dimanche est le jour de repos obligatoire/);
  });

  it('rejette des corrections qui dégradent le plan', async () => {
    const bad = { ...WEEK_N.find((w) => w.id === 'n6'), week: 'N', intensity: '2:00 /km' }; // allure aberrante
    state.reviewResponse = { issues: [{ week: 'N', id: 'n6', problem: 'x' }], corrections: [bad] };
    const out = await run();
    expect(out.validation.reviewAccepted).toBe(false);
    expect(out.workouts.N.find((w) => w.id === 'n6').intensity).toBe('4:55 /km');
  });

  it('survit à une relecture en erreur, les garde-fous prennent le relais', async () => {
    state.planResponse = brokenPlan();
    state.reviewThrows = true;
    const out = await run();
    expect(sessions(out.workouts.N).filter((w) => w.day === 'Dimanche')).toHaveLength(0);
    const count = sessions(out.workouts.N).reduce((s, w) => s + (w.type === 'ENCHAÎNEMENT' ? 2 : 1), 0);
    expect(count).toBe(12);
  });

  it('refuse une réponse sans aucune séance (au lieu de livrer un plan vide)', async () => {
    state.planResponse = { weekSummary: '', trainingPlan: PLAN_RESPONSE.trainingPlan, weekN: [], weekN1: [] };
    await expect(run()).rejects.toMatchObject({ code: 'PARSE_ERROR' });
  });
});

describe('pipeline — régénération d\'une semaine', () => {
  it('ne touche jamais à l\'autre semaine et ancre la phase sur la date de début du plan', async () => {
    const { regenerateWeekWithAI } = await import('../lib/gemini');
    state.planResponse = { weekSummary: 'ok', week: PLAN_RESPONSE.workouts['N+1'] };
    const workouts = { N: clone(WEEK_N), 'N+1': [] };
    const out = await regenerateWeekWithAI({
      weekKey: 'N+1', profile: MARIN_PROFILE, workouts,
      trainingPlan: { startDate: '2026-06-01' }, constraints: MARIN_WIZARD, clientDate: '2026-09-25',
    });
    expect(out.workouts.N).toEqual(workouts.N);
    expect(sessions(out.workouts['N+1']).length).toBeGreaterThan(0);
    // Début de plan en juin → en septembre la phase n'est plus la première ("Base").
    expect(state.calls[0].prompt).toMatch(/Phase actuelle : (?!Base)/);
  });
});
