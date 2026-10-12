import { describe, it, expect, vi } from 'vitest';

vi.mock('../lib/strava', () => ({
  fetchStravaAthlete: vi.fn(async () => ({ bikes: [] })),
  extractStravaGear: vi.fn(() => [{ kind: 'bike', name: 'Canyon Aeroad CF SLX', stravaGearId: 'g1', distanceM: 6_000_000, retired: false }]),
}));
const { syncEquipmentFromStrava } = await import('../lib/equipment');

// Base simulée : Aeroad déjà suivi avec les ANCIENNES valeurs par défaut ; la chaîne a été
// réglée à 4 200 km par l'athlète (à conserver).
function fakeAdmin() {
  const existing = [
    { id: 'x1', part_key: 'chaine', details: 'SRAM Rival E1', cost_eur: 35, lifespan_km: 4200, name: 'Chaîne' },
    { id: 'x2', part_key: 'cassette', details: 'x', cost_eur: 60, lifespan_km: 9000, name: 'Cassette' },
    { id: 'x3', part_key: 'manivelles', details: 'x', cost_eur: 250, lifespan_km: 20000, name: 'Manivelles / plateau' },
    { id: 'x4', part_key: 'pneu-ar', details: 'x', cost_eur: 35, lifespan_km: 3500, name: 'Pneu arrière' },
  ];
  const log = { inserts: [], updates: [] };
  const from = (table) => {
    const ctx = { table, op: 'select', filters: {} };
    const chain = {
      select: () => chain,
      eq: (k, v) => { ctx.filters[k] = v; if (ctx.op === 'update') log.updates.push({ table, id: v, values: ctx.values }); return chain; },
      in: () => chain,
      maybeSingle: async () => ({ data: table === 'equipment' ? { id: 'e1' } : null }),
      single: async () => ({ data: { id: 'e1' } }),
      update: (values) => { ctx.op = 'update'; ctx.values = values; return chain; },
      insert: async (rows) => { log.inserts.push({ table, rows }); return { error: null }; },
      then: (r) => Promise.resolve(table === 'equipment_components' ? { data: existing, error: null } : { data: [], error: null }).then(r),
    };
    return chain;
  };
  return { admin: { from }, log };
}

describe('synchro Strava : pièces de l\'Aeroad', () => {
  it('ajoute les nouvelles pièces, met à jour les anciennes valeurs par défaut, garde les réglages de l\'athlète', async () => {
    const { admin, log } = fakeAdmin();
    await syncEquipmentFromStrava(admin, 'u1', 'token');
    const inserted = log.inserts.find((i) => i.table === 'equipment_components')?.rows || [];
    const keys = inserted.map((r) => r.part_key);
    ['plateaux', 'galets', 'cales', 'preventif', 'liquide-frein', 'moyeux', 'jeu-direction'].forEach((k) => expect(keys, k).toContain(k));
    expect(keys).not.toContain('cables-derailleur'); // Aeroad = SRAM AXS
    expect(keys).not.toContain('chaine'); // déjà présente
    inserted.forEach((r) => expect(r).not.toHaveProperty('mechanicalOnly'));
    const upd = Object.fromEntries(log.updates.filter((u) => u.table === 'equipment_components').map((u) => [u.id, u.values]));
    expect(upd.x2).toMatchObject({ lifespan_km: 10000 }); // cassette 9 000 → 10 000
    expect(upd.x3).toMatchObject({ lifespan_km: 0, name: 'Manivelles (et capteur de puissance)' });
    expect(upd.x4).toMatchObject({ lifespan_km: 4500 });
    expect(upd.x1?.lifespan_km).toBeUndefined(); // 4 200 km réglé par l'athlète : conservé
  });
});
