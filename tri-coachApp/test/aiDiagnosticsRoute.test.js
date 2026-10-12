import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    constructor() {
      this.models = {
        generateContent: async ({ model }) => {
          if (model === 'gemini-3.8-flash') throw new Error('got status: 429 Too Many Requests. Quota exceeded for metric: generate_content_free_tier_requests, limit: 0');
          if (model === 'gemini-3.7-flash') throw new Error('{"error":{"code":404,"message":"models/gemini-3.7-flash is not found for API version v1beta"}}');
          return { text: '{"status":"ok"}' };
        },
      };
    }
  },
}));
vi.mock('../lib/aiGuard', () => ({ guardAiRoute: async () => ({ allowed: true }) }));

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

describe('route /api/ai-diagnostics', () => {
  it('explique les échecs, dit ce que l\'app utilisera, recommande une configuration, montre Mistral', async () => {
    process.env.GEMINI_API_KEY = 'g';
    process.env.GROQ_API_KEY = 'q';
    delete process.env.MISTRAL_API_KEY;
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"status":"ok"}' } }] }) }));
    const { default: handler } = await import('../pages/api/ai-diagnostics');
    let payload = null;
    const res = { status: () => res, json: (d) => { payload = d; return res; }, setHeader: () => {} };
    await handler({ method: 'POST', headers: {}, body: { language: 'fr' }, socket: {} }, res);

    const byModel = Object.fromEntries(payload.results.map((r) => [`${r.provider}:${r.model}`, r]));
    expect(byModel['gemini:gemini-3.8-flash'].reason.code).toBe('NO_FREE_QUOTA');
    expect(byModel['gemini:gemini-3.7-flash'].reason.code).toBe('NOT_FOUND');
    expect(byModel['mistral:MISTRAL_API_KEY'].reason.code).toBe('NO_KEY');

    const plan = payload.summary.find((s) => s.tier === 'plan');
    expect(plan).toMatchObject({ gemini: 'gemini-3.6-flash', groq: 'openai/gpt-oss-120b', mistral: null });
    expect(payload.recommendedEnv).toContain('GG_MODELS_PLAN=gemini-3.6-flash,gemini-3.5-flash,gemini-3.1-flash-lite');
    expect(payload.mistralConfigured).toBe(false);
  });

  it('panne passagère (5xx, délai) : jamais recommandée au retrait', async () => {
    const { __resetAvailability } = await import('../lib/aiAvailability');
    __resetAvailability();
    vi.resetModules();
    vi.doMock('@google/genai', () => ({
      GoogleGenAI: class {
        constructor() {
          this.models = {
            generateContent: async ({ model }) => {
              if (model === 'gemini-3.8-flash') throw new Error('got status: 503 Service Unavailable. The model is overloaded.');
              if (model === 'gemini-3.5-flash') throw new Error('Délai dépassé (15000ms)');
              return { text: '{"status":"ok"}' };
            },
          };
        }
      },
    }));
    vi.doMock('../lib/aiGuard', () => ({ guardAiRoute: async () => ({ allowed: true }) }));
    process.env.MISTRAL_API_KEY = 'm';
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"status":"ok"}' } }] }) }));
    const { default: handler } = await import('../pages/api/ai-diagnostics');
    let payload = null;
    const res = { status: () => res, json: (d) => { payload = d; return res; }, setHeader: () => {} };
    await handler({ method: 'POST', headers: {}, body: {}, socket: {} }, res);
    const byModel = Object.fromEntries(payload.results.map((r) => [`${r.provider}:${r.model}`, r]));
    expect(byModel['gemini:gemini-3.8-flash'].reason.code).toBe('SERVER');
    expect(byModel['gemini:gemini-3.5-flash'].reason.code).toBe('TIMEOUT');
    expect(payload.recommendedEnv).toEqual([]);
    expect(payload.summary.find((s) => s.tier === 'plan')).toMatchObject({ gemini: 'gemini-3.7-flash', groq: 'openai/gpt-oss-120b', mistral: 'mistral-medium-latest' });
    expect(payload.mistralConfigured).toBe(true);
    delete process.env.MISTRAL_API_KEY;
  });
});
