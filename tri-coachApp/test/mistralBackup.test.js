import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WEEK_N, WEEK_N1 } from './fixtures/marinPlan';

const behavior = { gemini: 'ok', groq: 'ok', mistral: 'ok' };
const calls = [];
vi.mock('../lib/gemini', () => ({
  generatePlanWithAI: vi.fn(async ({ provider }) => {
    calls.push(provider);
    if (behavior[provider] !== 'ok') throw Object.assign(new Error(`${provider} en panne (429)`), { code: 'QUOTA' });
    return { workouts: { N: WEEK_N, 'N+1': WEEK_N1 }, validation: { score: 0 }, autoFixNotes: [], meta: { provider } };
  }),
  regenerateWeekWithAI: vi.fn(), chatWithCoach: vi.fn(), generateNutritionAdvice: vi.fn(), answerNutritionQuestion: vi.fn(),
  checkZoneBoundsWithAI: vi.fn(), pickBestRouteWithAI: vi.fn(), analyzeStravaActivity: vi.fn(), scorePatchedPlan: vi.fn(() => 0),
}));

const { coGeneratePlan } = await import('../lib/coGeneration');
const { callAI } = await import('../lib/aiClient');

beforeEach(() => { calls.length = 0; Object.assign(behavior, { gemini: 'ok', groq: 'ok', mistral: 'ok' }); process.env.MISTRAL_API_KEY = 'm'; });
afterEach(() => { delete process.env.MISTRAL_API_KEY; });

describe('secours Mistral dans la co-génération', () => {
  it('Gemini et Groq disponibles : Mistral n\'est jamais appelé', async () => {
    const out = await coGeneratePlan({});
    expect(calls).not.toContain('mistral');
    expect(out.autoFixNotes.join()).toMatch(/Gemini \+ Groq : accord/);
  });
  it('Groq en panne : Mistral prend sa place, le double-check est conservé', async () => {
    behavior.groq = 'down';
    const out = await coGeneratePlan({});
    expect(calls).toContain('mistral');
    const notes = out.autoFixNotes.join(' ');
    expect(notes).toMatch(/Groq indisponible .*Mistral a pris le relais/);
    expect(notes).toMatch(/Double-check Gemini \+ Mistral : accord/);
  });
  it('Gemini et Groq en panne : Mistral seul, signalé comme tel', async () => {
    behavior.gemini = 'down'; behavior.groq = 'down';
    const out = await coGeneratePlan({});
    expect(out.meta.provider).toBe('mistral');
    expect(out.autoFixNotes.join(' ')).toMatch(/Gemini et Groq injoignable/);
  });
  it('sans clé Mistral : comportement d\'origine (IA restante seule)', async () => {
    delete process.env.MISTRAL_API_KEY;
    behavior.groq = 'down';
    const out = await coGeneratePlan({});
    expect(calls).not.toContain('mistral');
    expect(out.autoFixNotes.join(' ')).toMatch(/Groq injoignable/);
  });
});

describe('client Mistral', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });
  it('json_schema strict, puis repli json_object avec consigne JSON explicite', async () => {
    const bodies = [];
    global.fetch = vi.fn(async (url, opts) => {
      bodies.push({ url, body: JSON.parse(opts.body), auth: opts.headers.Authorization });
      if (bodies.length === 1) return { ok: false, status: 400, text: async () => 'invalid json_schema' };
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"reply":"ok","patches":[]}' } }] }) };
    });
    const schema = { type: 'object', properties: { reply: { type: 'string' } } };
    const out = await callAI({ provider: 'mistral', tier: 'chat', system: 'SYS', prompt: 'P', schema });
    expect(out).toEqual({ reply: 'ok', patches: [] });
    expect(bodies[0].url).toBe('https://api.mistral.ai/v1/chat/completions');
    expect(bodies[0].auth).toBe('Bearer m');
    expect(bodies[0].body.model).toBe('mistral-small-latest');
    expect(bodies[0].body.response_format.json_schema.strict).toBe(true);
    expect(bodies[0].body.reasoning_effort).toBeUndefined();
    expect(bodies[1].body.response_format).toEqual({ type: 'json_object' });
    expect(bodies[1].body.messages[0].content).toMatch(/UNIQUEMENT avec un objet JSON valide conforme à ce schéma/);
  });
});
