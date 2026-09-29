import { describe, it, expect } from 'vitest';
import { timeFromVma, riegel, vmaFromPerformance, predictions, splitsTable, formatDuration, paceFromSpeed } from '../lib/runCalculator';

describe('outil allures & chronos', () => {
  it('prédiction depuis la VMA (VMA 20 km/h)', () => {
    expect(formatDuration(timeFromVma(20, 10000))).toBe('33:42'); // 89 % VMA = 17,8 km/h → 2022,5 s
    expect(formatDuration(timeFromVma(20, 1500))).toBe('4:22'); // 103 % VMA
  });
  it('Riegel depuis une perf de référence (10 km en 35:15)', () => {
    expect(formatDuration(riegel(35 * 60 + 15, 10000, 21097.5))).toBe('1:17:47');
    expect(formatDuration(riegel(35 * 60 + 15, 10000, 5000))).toBe('16:54'); // 2115 × 0,5^1,06 = 1014 s
  });
  it('VMA estimée depuis une perf', () => {
    expect(vmaFromPerformance(10000, 35 * 60 + 15)).toBe(19.1);
  });
  it('tableau des prédictions : la perf de référence prime sur la VMA', () => {
    const rows = predictions({ vma: 20, refMeters: 10000, refSeconds: 2115 });
    const ten = rows.find((r) => r.id === '10k');
    expect(Math.round(ten.fromRef)).toBe(2115);
    expect(ten.fromVma).toBeGreaterThan(0);
    expect(paceFromSpeed(18)).toBe('3:20 /km');
  });
  it('temps de passage au 100 m jusqu\'au 1500 m', () => {
    const t = splitsTable(20);
    expect(t).toHaveLength(15);
    expect(formatDuration(t[0].seconds, { tenths: true })).toBe('18.0"');
    expect(formatDuration(t[3].seconds, { tenths: true })).toBe('1:12.0');
    expect(formatDuration(t[14].seconds, { tenths: true })).toBe('4:30.0');
  });
});
