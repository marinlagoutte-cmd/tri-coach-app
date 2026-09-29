import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Supabase simulé -------------------------------------------------------------------
const db = { count: 0, inserted: [], tableMissing: false };
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: async (token) => (token === 'good' ? { data: { user: { id: 'u1' } }, error: null } : { data: null, error: { message: 'bad jwt' } }) },
    from: () => ({
      select: () => ({ eq: () => ({ gte: async () => (db.tableMissing ? { count: null, error: { code: '42P01', message: 'relation "ai_usage" does not exist' } } : { count: db.count, error: null }) }) }),
      insert: async (row) => { db.inserted.push(row); return { error: null }; },
    }),
  }),
}));

async function loadGuard(env) {
  vi.resetModules();
  Object.assign(process.env, { NEXT_PUBLIC_SUPABASE_URL: '', NEXT_PUBLIC_SUPABASE_ANON_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '', AI_REQUIRE_AUTH: '', AI_DAILY_LIMIT: '' }, env);
  return import('../lib/aiGuard');
}
const req = (token, ip = '1.2.3.4') => ({ headers: { authorization: token ? `Bearer ${token}` : '', 'x-forwarded-for': ip }, body: { language: 'fr' }, socket: {} });

describe('garde des routes IA', () => {
  beforeEach(() => { db.count = 0; db.inserted = []; db.tableMissing = false; });

  it('sans Supabase configuré : accès libre (mode sans compte inchangé)', async () => {
    const { guardAiRoute } = await loadGuard({});
    expect((await guardAiRoute(req(null), { id: 't1', limit: 5, windowMs: 60_000 })).allowed).toBe(true);
  });

  it('Supabase configuré : session exigée par défaut (401 sinon)', async () => {
    const { guardAiRoute } = await loadGuard({ NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon' });
    const noToken = await guardAiRoute(req(null), { id: 't2', limit: 5, windowMs: 60_000 });
    expect(noToken).toMatchObject({ allowed: false, status: 401, code: 'AUTH_REQUIRED' });
    expect((await guardAiRoute(req('forged'), { id: 't2', limit: 5, windowMs: 60_000 })).status).toBe(401);
    expect((await guardAiRoute(req('good'), { id: 't2', limit: 5, windowMs: 60_000 })).allowed).toBe(true);
  });

  it('AI_REQUIRE_AUTH=false : le mode sans compte reste possible', async () => {
    const { guardAiRoute } = await loadGuard({ NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon', AI_REQUIRE_AUTH: 'false' });
    expect((await guardAiRoute(req(null), { id: 't3', limit: 5, windowMs: 60_000 })).allowed).toBe(true);
  });

  it('limite par minute comptée par compte (pas par IP)', async () => {
    const { guardAiRoute } = await loadGuard({ NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon' });
    const opts = { id: 't4', limit: 2, windowMs: 60_000 };
    expect((await guardAiRoute(req('good', '1.1.1.1'), opts)).allowed).toBe(true);
    expect((await guardAiRoute(req('good', '2.2.2.2'), opts)).allowed).toBe(true); // autre IP, même compte
    const third = await guardAiRoute(req('good', '3.3.3.3'), opts);
    expect(third).toMatchObject({ allowed: false, status: 429, code: 'RATE_LIMIT' });
  });

  it('quota quotidien persistant : enregistre l\'appel, bloque au-delà, ignore une table absente', async () => {
    const env = { NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'svc', AI_DAILY_LIMIT: '3' };
    let { guardAiRoute } = await loadGuard(env);
    db.count = 1;
    expect((await guardAiRoute(req('good'), { id: 't5', limit: 50, windowMs: 60_000 })).allowed).toBe(true);
    expect(db.inserted).toEqual([{ user_id: 'u1', route: 't5' }]);
    db.count = 3;
    expect(await guardAiRoute(req('good'), { id: 't5', limit: 50, windowMs: 60_000 })).toMatchObject({ allowed: false, code: 'DAILY_LIMIT' });
    ({ guardAiRoute } = await loadGuard(env));
    db.tableMissing = true;
    expect((await guardAiRoute(req('good'), { id: 't6', limit: 50, windowMs: 60_000 })).allowed).toBe(true);
  });
});

// --- Duathlon ----------------------------------------------------------------------------
describe('duathlon', () => {
  const DUATHLON = {
    firstName: 'Marin', gender: 'homme', weight: 89, fitnessLevel: 5, trainingExperience: 'expert', hasExistingTrainingBase: true,
    sportType: 'duathlon', triathlonFormat: 'S', customDistances: { run: 5, bike: 20, run2: 2.5 }, targetTime: '01:00',
    targetDate: '2027-03-28', hoursPerWeek: 14, maxSessionsPerWeek: 10, offDays: 'Dimanche', ppgEnabled: false,
    knownPhysio: { vma: '19', ftp: '360', css: '', fcMax: '191', fcRepos: '' }, recentResult: {},
  };

  it('prompt : course→vélo→course, FTP et zones vélo, aucune natation ni test CSS', async () => {
    const { buildAthleteContext, buildPlanPrompt } = await import('../lib/coachPrompts');
    const ctx = buildAthleteContext({ wizardData: DUATHLON, profile: {}, clientDate: '2026-09-25' });
    expect(ctx).toMatchObject({ sportType: 'duathlon', hasBike: true, hasSwim: false });
    const { prompt } = buildPlanPrompt(ctx);
    expect(prompt).toContain('Duathlon format S (course 5 km, vélo 20 km, course 2.5 km)');
    expect(prompt).toContain('AUCUNE séance NATATION');
    expect(prompt).toContain('FTP : 360 W');
    expect(prompt).not.toContain('CSS natation');
    expect(prompt).not.toContain('Natation :');
  });

  it('validateur : une séance de natation en duathlon est une erreur', async () => {
    const { buildValidationContext, validateWeek, normalizeAiWeek } = await import('../lib/planValidation');
    const vctx = buildValidationContext({ wizardData: DUATHLON, profile: { vma: 19, ftp: 360 } });
    const week = normalizeAiWeek([{ id: 'a', day: 'Lundi', type: 'NATATION', title: 'Nage', duration: '45 min', desc: "Échauffement :\n200\nCorps de séance :\n4*100 R : 15''\n---\n200\nTotal : 800m" }], 'N');
    expect(validateWeek(week, vctx, 'N').map((v) => v.code)).toContain('WRONG_DISCIPLINE');
  });

  it('séances ajoutées par le garde-fou : jamais de natation en duathlon', async () => {
    const { enforceSessionCount, classifyDiscipline } = await import('../lib/workouts');
    const week = [
      { id: 'a', day: 'Lundi', type: 'C.A.P', title: 'Footing', duration: '45 min', desc: 'x' },
      { id: 'b', day: 'Mardi', type: 'CYCLISME', title: 'Vélo', duration: '1h00', desc: 'x' },
    ];
    const out = enforceSessionCount(week, 8, 'Dimanche', { vma: 19, ftp: 360 }, 'duathlon');
    expect(out.filter((w) => w.type !== 'REPOS').length).toBe(8);
    expect(out.some((w) => classifyDiscipline(w.type) === 'NATATION')).toBe(false);
  });

  it('outils : prédiction et plan de course non disponibles, sans résultat faux', async () => {
    const { predictRaceTime } = await import('../lib/racePredictor');
    const { buildRaceExecutionPlan } = await import('../lib/raceExecution');
    expect(predictRaceTime({ sportType: 'duathlon', distances: { run: 5, bike: 20, run2: 2.5 }, physio: { vma: 19, ftp: 360 } })).toMatchObject({ available: false });
    expect(buildRaceExecutionPlan({ constraints: { sportType: 'duathlon' }, profile: {} })).toBeNull();
  });
});
