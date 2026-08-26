import { describe, it, expect } from 'vitest';
import { computeTirePressure, HOOKLESS_MAX_BAR } from '../../lib/tirePressure';

describe('lib/tirePressure computeTirePressure', () => {
  it('wider tires get lower pressure than narrower ones at equal load', () => {
    const narrow = computeTirePressure({ systemWeightKg: 75, tireWidthMm: 25, surface: 'smooth', tireType: 'clincher', weather: 'dry' });
    const wide = computeTirePressure({ systemWeightKg: 75, tireWidthMm: 45, surface: 'smooth', tireType: 'clincher', weather: 'dry' });
    expect(wide.rear.bar).toBeLessThan(narrow.rear.bar);
  });

  it('heavier system weight increases pressure at equal width', () => {
    const light = computeTirePressure({ systemWeightKg: 60, tireWidthMm: 28, surface: 'smooth', tireType: 'clincher', weather: 'dry' });
    const heavy = computeTirePressure({ systemWeightKg: 100, tireWidthMm: 28, surface: 'smooth', tireType: 'clincher', weather: 'dry' });
    expect(heavy.rear.bar).toBeGreaterThan(light.rear.bar);
  });

  it('front pressure is lower than rear under the default (neutral) load split', () => {
    const res = computeTirePressure({ systemWeightKg: 75, tireWidthMm: 28, surface: 'smooth', tireType: 'clincher', weather: 'dry' });
    expect(res.front.bar).toBeLessThan(res.rear.bar);
  });

  it('rougher surfaces reduce pressure vs smooth road', () => {
    const smooth = computeTirePressure({ systemWeightKg: 75, tireWidthMm: 32, surface: 'smooth', tireType: 'tubeless', weather: 'dry' });
    const gravel = computeTirePressure({ systemWeightKg: 75, tireWidthMm: 32, surface: 'gravel', tireType: 'tubeless', weather: 'dry' });
    expect(gravel.rear.bar).toBeLessThan(smooth.rear.bar);
  });

  it('tubeless runs lower than clincher at equal everything else', () => {
    const clincher = computeTirePressure({ systemWeightKg: 75, tireWidthMm: 28, surface: 'smooth', tireType: 'clincher', weather: 'dry' });
    const tubeless = computeTirePressure({ systemWeightKg: 75, tireWidthMm: 28, surface: 'smooth', tireType: 'tubeless', weather: 'dry' });
    expect(tubeless.rear.bar).toBeLessThan(clincher.rear.bar);
  });

  it('comfort priority is lower than performance priority', () => {
    const comfort = computeTirePressure({ systemWeightKg: 75, tireWidthMm: 28, surface: 'smooth', tireType: 'clincher', weather: 'dry', priority: 'comfort' });
    const performance = computeTirePressure({ systemWeightKg: 75, tireWidthMm: 28, surface: 'smooth', tireType: 'clincher', weather: 'dry', priority: 'performance' });
    expect(comfort.rear.bar).toBeLessThan(performance.rear.bar);
  });

  it('never exceeds the ETRTO hookless cap when hookless is set, and flags the warning', () => {
    const res = computeTirePressure({ systemWeightKg: 110, tireWidthMm: 23, surface: 'smooth', tireType: 'clincher', weather: 'dry', hookless: true });
    expect(res.rear.bar).toBeLessThanOrEqual(HOOKLESS_MAX_BAR);
    expect(res.front.bar).toBeLessThanOrEqual(HOOKLESS_MAX_BAR);
    expect(res.warnings).toContain('hookless');
  });

  it('respects a known max pressure limit and flags the warning', () => {
    const res = computeTirePressure({ systemWeightKg: 90, tireWidthMm: 25, surface: 'smooth', tireType: 'clincher', weather: 'dry', knownMaxBar: 6 });
    expect(res.rear.bar).toBeLessThanOrEqual(6);
    expect(res.warnings).toContain('knownMax');
  });

  it('never goes below the safety floor even for very wide tires / low load', () => {
    const res = computeTirePressure({ systemWeightKg: 45, tireWidthMm: 60, surface: 'offroad', tireType: 'tubeless', weather: 'wet' });
    expect(res.front.bar).toBeGreaterThanOrEqual(1.4);
    expect(res.rear.bar).toBeGreaterThanOrEqual(1.4);
  });

  it('returns a comfort-to-performance range that brackets the recommended value', () => {
    const res = computeTirePressure({ systemWeightKg: 75, tireWidthMm: 28, surface: 'smooth', tireType: 'clincher', weather: 'dry', priority: 'balanced' });
    expect(res.range.rear.comfort.bar).toBeLessThanOrEqual(res.rear.bar);
    expect(res.range.rear.performance.bar).toBeGreaterThanOrEqual(res.rear.bar);
  });
});
