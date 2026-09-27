import { describe, it, expect, vi, beforeEach } from 'vitest';

const tried = [];
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    constructor() {
      this.models = {
        generateContent: async ({ model }) => {
          tried.push(model);
          if (model === 'gemini-3.8-flash') {
            throw Object.assign(new Error('got status: 429 Too Many Requests. {"error":{"code":429,"message":"Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 0, model: gemini-3.8-flash"}}'), { status: 429 });
          }
          if (model === 'gemini-3.7-flash') {
            throw Object.assign(new Error('{"error":{"code":404,"message":"models/gemini-3.7-flash is not found for API version v1beta, or is not supported for generateContent."}}'), { status: 404 });
          }
          return { text: '{"ok":true}', candidates: [{ finishReason: 'STOP' }] };
        },
      };
    }
  },
}));
process.env.GEMINI_API_KEY = 'x';

const { explainModelError, __resetAvailability, isModelSkipped } = await import('../lib/aiAvailability');
const { callAI } = await import('../lib/aiClient');

beforeEach(() => { tried.length = 0; __resetAvailability(); });

describe('causes lisibles des erreurs de modèle', () => {
  it('pas de quota gratuit (429 + limit: 0)', () => {
    expect(explainModelError('got status: 429 Too Many Requests. Quota exceeded for metric: generate_content_free_tier_requests, limit: 0').code).toBe('NO_FREE_QUOTA');
  });
  it('modèle non accessible (404)', () => {
    expect(explainModelError('{"error":{"code":404,"message":"models/x is not found for API version v1beta"}}').code).toBe('NOT_FOUND');
    expect(explainModelError('Groq HTTP 404: {"error":{"message":"The model `x` does not exist"}}').code).toBe('NOT_FOUND');
  });
  it('quota momentanément épuisé (429 ordinaire)', () => {
    expect(explainModelError('Groq HTTP 429: Rate limit reached for model, limit: 30, used: 30').code).toBe('QUOTA');
  });
  it('clé refusée / absente / délai', () => {
    expect(explainModelError('Groq HTTP 401: Invalid API Key').code).toBe('AUTH');
    expect(explainModelError('Clé MISTRAL_API_KEY absente côté serveur.').code).toBe('NO_KEY');
    expect(explainModelError('Délai dépassé (20000ms)').code).toBe('TIMEOUT');
  });
});

describe('mise à l\'écart en production', () => {
  it('un modèle sans quota gratuit ou introuvable n\'est plus réessayé à l\'appel suivant', async () => {
    await callAI({ provider: 'gemini', tier: 'plan', prompt: 'p' });
    expect(tried.slice(0, 3)).toEqual(['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash']);
    expect(isModelSkipped('gemini', 'gemini-3.8-flash')).toBe(true);
    expect(isModelSkipped('gemini', 'gemini-3.7-flash')).toBe(true);
    tried.length = 0;
    await callAI({ provider: 'gemini', tier: 'plan', prompt: 'p' });
    expect(tried).toEqual(['gemini-3.6-flash']);
  });
});
