import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';

const state = { columns: [], upserts: [] };
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }) },
    from: () => ({
      upsert: async (row) => {
        state.upserts.push(row);
        const bad = Object.keys(row).find((k) => !state.columns.includes(k));
        return { error: bad ? { message: `Could not find the '${bad}' column of 'strava_tokens' in the schema cache` } : null };
      },
    }),
  }),
}));
vi.mock('../lib/strava', () => ({
  isStravaConfigured: () => true,
  // Réponse d'échange SANS scope (cas réel) : le scope accordé vient de l'adresse de retour.
  exchangeStravaCode: async () => ({ access_token: 'a', refresh_token: 'r', expires_at: 1, athlete: { id: 42 } }),
}));
const { default: handler } = await import('../pages/api/strava/callback');

const call = async (query) => {
  const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, writeHead(c, h) { this.statusCode = c; Object.assign(this.headers, h || {}); }, status(c) { this.statusCode = c; return this; }, end() {}, redirect(c, u) { this.statusCode = c; this.headers.Location = u; } };
  await handler({ method: 'GET', query, headers: {} }, res);
  return res;
};

describe('retour de Strava : autorisation enregistrée', () => {
  beforeEach(() => { state.upserts = []; });
  it('enregistre l\'autorisation lue dans l\'adresse de retour', async () => {
    state.columns = ['user_id', 'athlete_id', 'access_token', 'refresh_token', 'expires_at', 'scope', 'updated_at'];
    const res = await call({ code: 'c', state: 'jwt', scope: 'read,activity:read_all,profile:read_all' });
    expect(state.upserts[0].scope).toBe('read,activity:read_all,profile:read_all');
    expect(JSON.stringify(res.headers)).toMatch(/connected/);
  });
  it('base sans colonne updated_at : réessaie sans elle au lieu de garder l\'ancien jeton', async () => {
    state.columns = ['user_id', 'athlete_id', 'access_token', 'refresh_token', 'expires_at', 'scope'];
    const res = await call({ code: 'c', state: 'jwt', scope: 'read,activity:read_all,profile:read_all' });
    expect(state.upserts).toHaveLength(2);
    expect(state.upserts[1]).not.toHaveProperty('updated_at');
    expect(state.upserts[1].scope).toMatch(/profile:read_all/);
    expect(JSON.stringify(res.headers)).toMatch(/connected/);
  });
});
