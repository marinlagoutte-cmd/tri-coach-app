import { describe, it, expect } from 'vitest';
import { CHECKLIST_CATEGORIES, migrateChecklistState } from '../lib/raceChecklist';

const bySport = (sport) => CHECKLIST_CATEGORIES.filter((c) => c.sports.includes(sport)).map((c) => c.id);
const allItems = CHECKLIST_CATEGORIES.flatMap((c) => c.items).join(' | ');

describe('checklist de course', () => {
  it('catégories adaptées au sport', () => {
    expect(bySport('triathlon')).toEqual(['admin', 'tenue', 'natation', 'velo', 'course', 'divers']);
    expect(bySport('duathlon')).toEqual(['admin', 'tenue', 'velo', 'course', 'divers']);
    expect(bySport('running')).toEqual(['admin', 'tenue', 'course', 'divers']);
  });
  it('contient la tenue et les papiers demandés au retrait du dossard', () => {
    ['Trifonction', 'Chaussettes', 'Coupe-vent', 'Casquette', 'Licence FFTri ou Pass Compétition', "Pièce d'identité", 'Combinaison néoprène', 'Ceinture porte-dossard', 'Puce de chronométrage']
      .forEach((w) => expect(allItems, w).toContain(w));
  });
  it('migration de l\'ancienne liste : ajouts personnels et cases cochées conservés', () => {
    const old = { items: ['Puce de chronométrage', 'Lunettes de vélo', 'Mon gel préféré'], checked: ['Lunettes de vélo', 'Mon gel préféré'] };
    expect(migrateChecklistState(old)).toEqual({ custom: ['Mon gel préféré'], hidden: [], checked: ['Lunettes de vélo', 'Mon gel préféré'] });
    expect(migrateChecklistState(null)).toEqual({ custom: [], hidden: [], checked: [] });
    const v2 = { version: 2, custom: ['x'], hidden: ['y'], checked: ['x'] };
    expect(migrateChecklistState(v2)).toEqual({ custom: ['x'], hidden: ['y'], checked: ['x'] });
  });
});
