import { describe, it, expect, afterEach } from 'vitest';
import { REFERENCE_WEEKS, pickReferenceWeek, referenceWeekBlock } from '../lib/referenceWeeks';
import { normalizeAiWeek, buildValidationContext, validateWeek, findConsecutiveHardIssues } from '../lib/planValidation';
import { buildAthleteContext, buildPlanPrompt } from '../lib/coachPrompts';
import { MARIN_WIZARD, MARIN_PROFILE } from './fixtures/marinPlan';

const LEVEL = { debutant: { trainingExperience: 'debutant', fitnessLevel: 1 }, intermediaire: { trainingExperience: 'intermediaire', fitnessLevel: 3 }, expert: { trainingExperience: 'expert', fitnessLevel: 5 } };

describe('bibliothèque de semaines modèles', () => {
  it('contient 18 semaines : 6 familles × 3 niveaux', () => {
    expect(REFERENCE_WEEKS).toHaveLength(18);
    expect(new Set(REFERENCE_WEEKS.map((r) => `${r.family}/${r.level}`)).size).toBe(18);
  });

  // Chaque semaine modèle passe le validateur de l'app avec ZÉRO remarque (erreur ou avertissement).
  REFERENCE_WEEKS.forEach((ref) => {
    it(`${ref.id} : aucune violation`, () => {
      const wizard = { ...ref.context, ...LEVEL[ref.level] };
      const vctx = buildValidationContext({ wizardData: wizard, profile: {} });
      const week = normalizeAiWeek(ref.week.map((w, i) => ({ ...w, id: `r${i}` })), 'N');
      const issues = [...validateWeek(week, vctx, 'N'), ...findConsecutiveHardIssues(week, [], vctx)];
      expect(issues.map((v) => v.message)).toEqual([]);
    });
  });

  it('intensités en repères de zone uniquement (aucune allure ni puissance chiffrée à recopier)', () => {
    REFERENCE_WEEKS.forEach((ref) => ref.week.forEach((w) => {
      expect(`${w.intensity} ${w.desc}`, `${ref.id} ${w.title}`).not.toMatch(/\d:\d{2}\s*\/\s*(km|100)|\d{2,3}\s*W\b/);
    }));
  });

  it('sélection du modèle le plus proche', () => {
    expect(pickReferenceWeek(MARIN_WIZARD).id).toBe('tri-short-expert');
    expect(pickReferenceWeek({ sportType: 'running', runningSubtype: 'trail', trainingExperience: 'novice' }).id).toBe('trail-debutant');
    expect(pickReferenceWeek({ sportType: 'running', trainingExperience: 'confirme' }).id).toBe('run-road-expert');
    expect(pickReferenceWeek({ sportType: 'triathlon', triathlonFormat: 'XL', trainingExperience: 'intermediaire' }).id).toBe('tri-long-intermediaire');
    expect(pickReferenceWeek({ sportType: 'duathlon', triathlonFormat: 'M', trainingExperience: 'expert' }).id).toBe('duathlon-expert');
  });
});

describe('injection dans le prompt', () => {
  afterEach(() => { delete process.env.AI_REFERENCE_WEEKS; });
  it('le prompt de génération contient l\'exemple et la consigne d\'adaptation, pour ~2 000 caractères', () => {
    const { prompt } = buildPlanPrompt(buildAthleteContext({ wizardData: MARIN_WIZARD, profile: MARIN_PROFILE, clientDate: '2026-09-26' }));
    expect(prompt).toContain('EXEMPLE DE RÉFÉRENCE (profil proche : triathlon S avec aspiration, expert');
    expect(prompt).toContain('Ce n\'est PAS le plan de cet athlète');
    expect(referenceWeekBlock(MARIN_WIZARD).length).toBeLessThan(3000);
    expect(prompt.indexOf('EXEMPLE DE RÉFÉRENCE')).toBeLessThan(prompt.indexOf('TA TÂCHE'));
  });
  it('désactivable par variable d\'environnement', () => {
    process.env.AI_REFERENCE_WEEKS = 'false';
    const { prompt } = buildPlanPrompt(buildAthleteContext({ wizardData: MARIN_WIZARD, profile: MARIN_PROFILE, clientDate: '2026-09-26' }));
    expect(prompt).not.toContain('EXEMPLE DE RÉFÉRENCE');
  });
});
