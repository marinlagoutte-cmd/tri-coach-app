import { describe, it, expect } from 'vitest';
import { missingColumnFrom, insertWithFallback, updateWithFallback } from '../lib/supabaseFallback';

// Faux client Supabase : refuse toute écriture contenant une colonne absente de la table.
function fakeClient(columns) {
  const log = [];
  const check = (rows) => {
    for (const r of [].concat(rows)) {
      const bad = Object.keys(r).find((k) => !columns.includes(k));
      if (bad) return { error: { code: 'PGRST204', message: `Could not find the '${bad}' column of 'equipment_components' in the schema cache` } };
    }
    return { error: null };
  };
  return {
    log,
    from: () => ({
      insert: async (rows) => { log.push(['insert', rows]); return check(rows); },
      update: (v) => ({ eq: async () => { log.push(['update', v]); return check(v); } }),
    }),
  };
}

describe('base Supabase incomplète : repli sur les colonnes facultatives', () => {
  it('reconnaît le message « Could not find the … column »', () => {
    expect(missingColumnFrom({ message: "Could not find the 'cost_eur' column of 'equipment_components' in the schema cache" })).toBe('cost_eur');
    expect(missingColumnFrom({ message: 'column "details" of relation "equipment_components" does not exist' })).toBe('details');
    expect(missingColumnFrom(null)).toBeNull();
  });
  it('ajoute les pièces sans la colonne manquante et la signale (ton cas : cost_eur absente)', async () => {
    const client = fakeClient(['equipment_id', 'zone', 'part_key', 'name', 'lifespan_km', 'baseline_km', 'details']);
    const rows = [{ equipment_id: 'b1', zone: 'roues', part_key: 'galets', name: 'Galets', lifespan_km: 12000, baseline_km: 0, cost_eur: 30 }];
    const r = await insertWithFallback(client, 'equipment_components', rows, ['cost_eur', 'details']);
    expect(r.error).toBeNull();
    expect(r.missingColumns).toEqual(['cost_eur']);
    expect(client.log.at(-1)[1][0]).not.toHaveProperty('cost_eur');
  });
  it('plusieurs colonnes manquantes, puis mise à jour', async () => {
    const client = fakeClient(['id', 'lifespan_km']);
    const r = await updateWithFallback(client, 't', { lifespan_km: 10000, updated_at: 'x', details: 'y' }, ['id', 'c1'], ['updated_at', 'details']);
    expect(r.error).toBeNull();
    expect(r.missingColumns.sort()).toEqual(['details', 'updated_at']);
  });
  it('une colonne obligatoire manquante reste une vraie erreur', async () => {
    const client = fakeClient(['equipment_id']);
    const r = await insertWithFallback(client, 't', [{ equipment_id: 'b1', zone: 'roues' }], ['cost_eur']);
    expect(r.error.message).toMatch(/zone/);
  });
});
