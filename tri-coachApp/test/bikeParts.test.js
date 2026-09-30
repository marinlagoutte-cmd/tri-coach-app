import { describe, it, expect } from 'vitest';
import { BIKE_PARTS, isTrackedPart, partWear, legacyUpdatesFor, formatMonths } from '../lib/bikeParts';
import { DEFAULT_BIKE_COMPONENTS } from '../lib/equipment';

const ZONES = ['transmission-avant', 'transmission-arriere', 'roues', 'cockpit'];

describe('référentiel des pièces de vélo', () => {
  it('toutes les pièces : zone autorisée en base, clé unique, critère renseigné', () => {
    const keys = BIKE_PARTS.map((p) => p.part_key);
    expect(new Set(keys).size).toBe(keys.length);
    BIKE_PARTS.forEach((p) => {
      expect(ZONES, p.part_key).toContain(p.zone);
      expect(p.guide.length, p.part_key).toBeGreaterThan(15);
      expect(p.lifespan_km).toBeGreaterThanOrEqual(0);
    });
  });
  it('contient les pièces d\'usure courantes', () => {
    const keys = new Set(BIKE_PARTS.map((p) => p.part_key));
    ['chaine', 'cassette', 'plateaux', 'galets', 'cales', 'boitier-pedalier', 'pneu-av', 'pneu-ar', 'plaquettes', 'disques',
      'preventif', 'liquide-frein', 'moyeux', 'jeu-direction', 'ruban', 'cables-derailleur'].forEach((k) => expect(keys.has(k), k).toBe(true));
  });
  it('les colonnes envoyées en base restent celles de la table', () => {
    DEFAULT_BIKE_COMPONENTS.forEach((c) => expect(Object.keys(c).sort()).toEqual(['cost_eur', 'lifespan_km', 'mechanicalOnly', 'name', 'part_key', 'zone']));
  });
});

describe('usure au kilomètre et au temps', () => {
  it('pièce au km : ratio = km / durée de vie', () => {
    const w = partWear({ part_key: 'chaine', lifespan_km: 3500 }, 1750, null);
    expect(w.ratio).toBe(0.5);
    expect(w.byTime).toBe(false);
  });
  it('pièce au temps : préventif posé il y a 3 mois → 75 %', () => {
    const w = partWear({ part_key: 'preventif', lifespan_km: 0 }, 0, '2026-06-30T00:00:00Z', new Date('2026-09-28T00:00:00Z'));
    expect(w.days).toBe(90);
    expect(Math.round(w.ratio * 100)).toBe(75);
    expect(isTrackedPart({ part_key: 'preventif', lifespan_km: 0 })).toBe(true);
    expect(formatMonths(90)).toBe('3 mois');
  });
  it('pièce de référence : ni km ni temps', () => {
    expect(isTrackedPart({ part_key: 'cadre', lifespan_km: 0 })).toBe(false);
  });
});

describe('mise à jour des pièces déjà créées', () => {
  it('ancienne valeur par défaut → nouvelle valeur documentée', () => {
    expect(legacyUpdatesFor({ part_key: 'cassette', lifespan_km: 9000, name: 'Cassette' })).toEqual({ lifespan_km: 10000 });
    expect(legacyUpdatesFor({ part_key: 'manivelles', lifespan_km: 20000, name: 'Manivelles / plateau' })).toEqual({ lifespan_km: 0, name: 'Manivelles (et capteur de puissance)' });
  });
  it('valeur réglée par l\'athlète : jamais écrasée', () => {
    expect(legacyUpdatesFor({ part_key: 'chaine', lifespan_km: 4200, name: 'Chaîne' })).toEqual({});
    expect(legacyUpdatesFor({ part_key: 'pneu-ar', lifespan_km: 5000, name: 'Mon pneu' })).toEqual({});
  });
});
