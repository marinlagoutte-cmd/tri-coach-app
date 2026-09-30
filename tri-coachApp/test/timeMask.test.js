import { describe, it, expect } from 'vitest';
import { maskTime, normalizeTime, timeIsInvalid } from '../lib/timeMask';

describe('saisie de temps au clavier numérique', () => {
  it('les chiffres entrent par la droite, les « : » se placent seuls', () => {
    expect(maskTime('3', 'hh:mm')).toBe('00:03');
    expect(maskTime('30', 'hh:mm')).toBe('00:30');
    expect(maskTime('115', 'hh:mm')).toBe('01:15');
    expect(maskTime('3830', 'hh:mm:ss')).toBe('00:38:30');
    expect(maskTime('145', 'mm:ss')).toBe('01:45');
  });
  it('taper un chiffre de plus dans le champ déjà formaté décale vers la gauche', () => {
    expect(maskTime('00:301', 'hh:mm')).toBe('03:01');
    expect(maskTime('00:3', 'hh:mm')).toBe('00:03'); // effacement du dernier chiffre
    expect(maskTime('00:0', 'hh:mm')).toBe(''); // plus rien → champ vide
  });
  it('coller une valeur déjà écrite avec « : »', () => {
    expect(maskTime('1:45', 'mm:ss')).toBe('01:45');
    expect(normalizeTime('1:45', 'mm:ss')).toBe('01:45');
    expect(normalizeTime('38:30', 'hh:mm:ss')).toBe('00:38:30');
    expect(normalizeTime('1:05:30', 'hh:mm:ss')).toBe('01:05:30');
    expect(normalizeTime('01:15', 'hh:mm')).toBe('01:15');
  });
  it('signale minutes ou secondes ≥ 60', () => {
    expect(timeIsInvalid('00:75', 'hh:mm')).toBe(true);
    expect(timeIsInvalid('01:15', 'hh:mm')).toBe(false);
    expect(timeIsInvalid('00:38:65', 'hh:mm:ss')).toBe(true);
  });
});
