import { describe, it, expect } from 'vitest';
import { planConfigBlockingReason, checkPlanCoherence, enforceDayDurationCaps, parseDurationMinutes } from '../lib/workouts';
import { buildValidationContext, validateWeek, normalizeAiWeek } from '../lib/planValidation';
import { buildAthleteContext, buildPlanPrompt } from '../lib/coachPrompts';
import { WEEK_N, MARIN_WIZARD, MARIN_PROFILE } from './fixtures/marinPlan';

const base = { hoursPerWeek: 10, maxSessionsPerWeek: 8, offDays: 'Dimanche', fitnessLevel: 3, trainingExperience: 'intermediaire', sportType: 'triathlon', triathlonFormat: 'M', targetDate: '2027-06-01' };

describe('configurations bloquantes', () => {
  it('trop de séances pour les créneaux disponibles', () => {
    expect(planConfigBlockingReason({ ...base, hoursPerWeek: 22, maxSessionsPerWeek: 14 })).toMatch(/impossibles/);
    expect(planConfigBlockingReason({ ...base, hoursPerWeek: 22, maxSessionsPerWeek: 14, fitnessLevel: 5, trainingExperience: 'expert' })).toBeNull();
    expect(planConfigBlockingReason({ ...base, maxSessionsPerWeek: 11, offDays: 'Lundi,Mercredi' })).toMatch(/maximum : 10/);
  });
  it('durée moyenne irréaliste', () => {
    expect(planConfigBlockingReason({ ...base, hoursPerWeek: 2, maxSessionsPerWeek: 10 })).toMatch(/trop court/);
  });
  it('volume qui ne tient pas dans les disponibilités', () => {
    const r = planConfigBlockingReason({ ...base, hoursPerWeek: 18, maxSessionsPerWeek: 10, dayCaps: { weekday: 60, weekend: 180 } });
    expect(r).toMatch(/disponibilités \(8h/); // dimanche de repos : 5 × 1h + samedi 3h
    expect(planConfigBlockingReason({ ...base, hoursPerWeek: 7, maxSessionsPerWeek: 8, dayCaps: { weekday: 60, weekend: 180 } })).toBeNull(); // 7h tiennent dans 8h
  });
});

describe('nouveaux avertissements', () => {
  it('débutant sans base à 10 séances', () => {
    expect(checkPlanCoherence({ ...base, fitnessLevel: 1, trainingExperience: 'debutant', maxSessionsPerWeek: 10, hoursPerWeek: 12 }).join(' ')).toMatch(/profil qui débute/);
  });
  it('duathlon : séances, volume, délai', () => {
    const w = checkPlanCoherence({ ...base, sportType: 'duathlon', triathlonFormat: 'M', maxSessionsPerWeek: 3, hoursPerWeek: 3, targetDate: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10) }).join(' ');
    expect(w).toMatch(/Duathlon M avec seulement 3/);
    expect(w).toMatch(/~5h\/semaine/);
    expect(w).toMatch(/au moins 8 semaines/);
  });
  it('trail 100 km : volume et délai', () => {
    const w = checkPlanCoherence({ ...base, sportType: 'running', runningSubtype: 'trail', trailKm: 100, maxSessionsPerWeek: 6, hoursPerWeek: 4, targetDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10) }).join(' ');
    expect(w).toMatch(/~8h\/semaine/);
    expect(w).toMatch(/au moins 16 semaines/);
  });
});

describe('disponibilités par jour', () => {
  const caps = { weekday: 90, weekend: 240 };
  it('garde-fou : un jour trop chargé est raccourci, les autres intacts', () => {
    const week = normalizeAiWeek(WEEK_N, 'N'); // mercredi : seuil 1h45 + natation 40 min = 2h25
    const out = enforceDayDurationCaps(week, caps);
    const wed = out.filter((w) => w.day === 'Mercredi' && w.type !== 'REPOS');
    expect(wed.reduce((s, w) => s + parseDurationMinutes(w.duration), 0)).toBeLessThanOrEqual(99);
    expect(wed.every((w) => /disponibilité du mercredi/.test(w.autoNote || ''))).toBe(true);
    // Règle générale : plus aucun jour ne dépasse sa disponibilité (+10 % de tolérance).
    ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'].forEach((day) => {
      const cap = day === 'Samedi' ? 240 : 90;
      const total = out.filter((w) => w.day === day && w.type !== 'REPOS').reduce((s, w) => s + parseDurationMinutes(w.duration), 0);
      expect(total, day).toBeLessThanOrEqual(cap * 1.1);
    });
  });
  it('validateur + prompt', () => {
    const wizard = { ...MARIN_WIZARD, dayCaps: caps };
    const vctx = buildValidationContext({ wizardData: wizard, profile: MARIN_PROFILE });
    expect(validateWeek(normalizeAiWeek(WEEK_N, 'N'), vctx, 'N').map((v) => v.code)).toContain('DAY_DURATION');
    const { prompt } = buildPlanPrompt(buildAthleteContext({ wizardData: wizard, profile: MARIN_PROFILE, clientDate: '2026-09-26' }));
    expect(prompt).toContain('du lundi au vendredi 1h30 maximum par jour ; samedi et dimanche 4h maximum par jour');
  });
  it('plusieurs jours de repos : respectés par le validateur et le prompt', () => {
    const wizard = { ...MARIN_WIZARD, offDays: 'Lundi,Dimanche', maxSessionsPerWeek: 10 };
    const vctx = buildValidationContext({ wizardData: wizard, profile: MARIN_PROFILE });
    expect(validateWeek(normalizeAiWeek(WEEK_N, 'N'), vctx, 'N').filter((v) => v.code === 'OFF_DAY').map((v) => v.day)).toEqual(['Lundi']);
    expect(buildPlanPrompt(buildAthleteContext({ wizardData: wizard, profile: MARIN_PROFILE, clientDate: '2026-09-26' })).prompt).toContain('Jour(s) de repos obligatoire(s) : Lundi, Dimanche');
  });
});
