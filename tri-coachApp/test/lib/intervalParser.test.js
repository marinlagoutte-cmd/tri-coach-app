import { describe, it, expect } from 'vitest';
import { parseIntervalStructure } from '../../lib/intervalParser';

describe('parseIntervalStructure', () => {
  it('ne découpe pas les plages de valeurs (60-65rpm, Z2-Z3)', () => {
    const r = parseIntervalStructure("Échauffement :\n20'\nCorps de séance :\n5*(8' @300W 60-65rpm - 4' souple)\n15' souple");
    expect(r.reps).toBe(5);
    expect(r.blocks).toHaveLength(10);
    expect(r.blocks.filter((b) => !b.isRecovery)).toHaveLength(5);
  });
  it('reconnaît trot / descente comme récupération', () => {
    const r = parseIntervalStructure("10*(45'' côte effort VMA - descente trot)");
    expect(r.blocks.filter((b) => b.isRecovery)).toHaveLength(10);
  });
  it('notation à 3 segments et notation natation plate', () => {
    expect(parseIntervalStructure("4*(3' @3:30/km - 1' @3:15/km - 2' souple)").blocks).toHaveLength(12);
    const swim = parseIntervalStructure("10*100 NC Z4 R : 15''");
    expect(swim.reps).toBe(10);
    expect(swim.blocks[1].isRecovery).toBe(true);
  });
  it('texte sans structure → null', () => {
    expect(parseIntervalStructure('Footing continu')).toBeNull();
  });
});
