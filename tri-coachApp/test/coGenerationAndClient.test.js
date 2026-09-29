import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WEEK_N, WEEK_N1 } from './fixtures/marinPlan';

const plans = { gemini: [], groq: [] };
vi.mock('../lib/gemini', () => ({
  generatePlanWithAI: vi.fn(async ({ provider }) => plans[provider].shift()),
  regenerateWeekWithAI: vi.fn(),
  chatWithCoach: vi.fn(),
  generateNutritionAdvice: vi.fn(),
  answerNutritionQuestion: vi.fn(),
  checkZoneBoundsWithAI: vi.fn(),
  pickBestRouteWithAI: vi.fn(),
  analyzeStravaActivity: vi.fn(),
  scorePatchedPlan: vi.fn(() => 0),
}));

const { compareWeek, coGeneratePlan, comparePatches } = await import('../lib/coGeneration');
const { extractJson, classifyError, callAI, toStrictSchema } = await import('../lib/aiClient');
const { createDeadline } = await import('../lib/aiConfig');

const clone = (x) => JSON.parse(JSON.stringify(x));
const result = (N, N1, score, tag) => ({ workouts: { N, 'N+1': N1 }, validation: { score }, autoFixNotes: [], tag });

describe('co-génération', () => {
  beforeEach(() => { plans.gemini = []; plans.groq = []; delete process.env.CO_GEN_COMPROMISE; });

  it('compare par jour et discipline, pas par position dans le tableau', () => {
    const shuffled = clone(WEEK_N).reverse();
    expect(compareWeek(WEEK_N, shuffled)).toEqual([]);
    const other = clone(WEEK_N);
    other.find((w) => w.id === 'n6').type = 'CYCLISME';
    expect(compareWeek(WEEK_N, other)).toHaveLength(1);
  });

  it('accord au 1er essai → version Gemini', async () => {
    plans.gemini.push(result(WEEK_N, WEEK_N1, 0, 'g1'));
    plans.groq.push(result(clone(WEEK_N).reverse(), WEEK_N1, 3, 'q1'));
    const out = await coGeneratePlan({});
    expect(out.tag).toBe('g1');
    expect(out.autoFixNotes.join()).toMatch(/1er essai/);
  });

  it('désaccord persistant → plan entier le mieux validé (mode "best")', async () => {
    const other = clone(WEEK_N);
    other.find((w) => w.id === 'n6').duration = '2h30';
    plans.gemini.push(result(WEEK_N, WEEK_N1, 12, 'g1'), result(WEEK_N, WEEK_N1, 11, 'g2'));
    plans.groq.push(result(other, WEEK_N1, 5, 'q1'), result(other, WEEK_N1, 2, 'q2'));
    const out = await coGeneratePlan({});
    expect(out.tag).toBe('q2');
    expect(out.autoFixNotes.join()).toMatch(/Groq retenu/);
  });

  it('mode "average" disponible, sans ajouter les séances en trop de Groq', async () => {
    process.env.CO_GEN_COMPROMISE = 'average';
    const other = clone(WEEK_N);
    other.find((w) => w.id === 'n6').duration = '2h00';
    other.push({ id: 'extra', day: 'Lundi', type: 'C.A.P', title: 'En trop', duration: '30 min' });
    plans.gemini.push(result(WEEK_N, WEEK_N1, 0, 'g'), result(WEEK_N, WEEK_N1, 0, 'g'));
    plans.groq.push(result(other, WEEK_N1, 0, 'q'), result(other, WEEK_N1, 0, 'q'));
    const out = await coGeneratePlan({});
    expect(out.workouts.N.find((w) => w.id === 'n6').duration).toBe('90 min');
    expect(out.workouts.N.find((w) => w.id === 'extra')).toBeUndefined();
  });

  it('saute le 2e round si le budget restant est insuffisant', async () => {
    const other = clone(WEEK_N);
    other.find((w) => w.id === 'n6').duration = '2h30';
    plans.gemini.push(result(WEEK_N, WEEK_N1, 1, 'g1'));
    plans.groq.push(result(other, WEEK_N1, 4, 'q1'));
    const out = await coGeneratePlan({ deadline: createDeadline(60_000) });
    expect(out.tag).toBe('g1');
    expect(out.autoFixNotes.join()).toMatch(/après 1 essai/);
  });

  it('compare les patchs du chat par semaine/jour/discipline', () => {
    const p = { week: 'N+1', patchMode: 'modify', day: 'Jeudi', type: 'C.A.P', duration: '40 min' };
    expect(comparePatches([p], [{ ...p, duration: '45 min' }]).agree).toBe(true);
    expect(comparePatches([p], [{ ...p, week: 'N' }]).agree).toBe(false);
  });
});

describe('client IA', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; delete process.env.GROQ_API_KEY; });

  it('extractJson : JSON pur, bloc ```json, texte autour', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('Voici :\n```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(extractJson('blabla {"a":"x}y","b":{"c":3}} fin')).toEqual({ a: 'x}y', b: { c: 3 } });
    expect(() => extractJson('rien')).toThrow();
  });

  it('classifyError', () => {
    expect(classifyError({ status: 429, message: 'x' })).toBe('QUOTA');
    expect(classifyError({ message: 'Request too large for model' })).toBe('TOO_LARGE');
    expect(classifyError({ status: 404, message: 'model not found' })).toBe('MODEL_NOT_FOUND');
    expect(classifyError({ message: 'API key not valid' })).toBe('AUTH');
  });

  it('schéma strict : toutes les propriétés requises, aucune en plus', () => {
    const s = toStrictSchema({ type: 'object', properties: { a: { type: 'string' }, b: { type: 'object', properties: { c: { type: 'string' } } } } });
    expect(s.required).toEqual(['a', 'b']);
    expect(s.additionalProperties).toBe(false);
    expect(s.properties.b.required).toEqual(['c']);
  });

  it('Groq : json_schema strict + instruction système + reasoning_effort, repli json_object si refusé', async () => {
    process.env.GROQ_API_KEY = 'k';
    const bodies = [];
    global.fetch = vi.fn(async (_url, opts) => {
      const body = JSON.parse(opts.body);
      bodies.push(body);
      if (body.response_format.type === 'json_schema') {
        return { ok: false, status: 400, text: async () => 'response_format json_schema not supported' };
      }
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"reply":"ok","patches":[]}' } }] }) };
    });
    const out = await callAI({ provider: 'groq', tier: 'chat', system: 'SYS', prompt: 'P', schema: { type: 'object', properties: { reply: { type: 'string' } } } });
    expect(out).toEqual({ reply: 'ok', patches: [] });
    expect(bodies[0].messages[0]).toEqual({ role: 'system', content: 'SYS' });
    expect(bodies[0].response_format.json_schema.strict).toBe(true);
    expect(bodies[0].reasoning_effort).toBe('low');
    expect(bodies[1].response_format).toEqual({ type: 'json_object' });
  });

  it('budget épuisé → aucun appel lancé', async () => {
    process.env.GROQ_API_KEY = 'k';
    global.fetch = vi.fn();
    await expect(callAI({ provider: 'groq', tier: 'plan', prompt: 'P', deadline: createDeadline(1_000) })).rejects.toMatchObject({ code: 'BUDGET' });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
