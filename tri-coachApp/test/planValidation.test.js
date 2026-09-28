import { describe, it, expect } from 'vitest';
import { WEEK_N, WEEK_N1, MARIN_WIZARD, MARIN_PROFILE } from './fixtures/marinPlan';
import {
  normalizeAiWeek, validatePlan, validateWeek, buildValidationContext, estimateSwimMetersFromDesc,
  parseAnnouncedSwimTotal, scoreViolations, findConsecutiveHardIssues,
} from '../lib/planValidation';
import {
  easeSession, isHardSession, mergeWorkoutPatches, enforceNoConsecutiveHardDays, enforceSwimVolumeFloor,
  enforceLongSessionFloor, applyEasierTrendProgression, getIncompleteWorkouts, sanitizeWorkout, parseDurationMinutes,
} from '../lib/workouts';
import { buildAthleteContext, buildChatPrompt, runZonesText } from '../lib/coachPrompts';

const clone = (x) => JSON.parse(JSON.stringify(x));
const ctx = buildValidationContext({ wizardData: MARIN_WIZARD, profile: MARIN_PROFILE, phaseKey: 'base' });
const codes = (v) => v.map((x) => x.code);

describe('validateurs', () => {
  it('plan cohérent → aucune violation', () => {
    const weeks = { N: normalizeAiWeek(WEEK_N, 'N'), 'N+1': normalizeAiWeek(WEEK_N1, 'N+1') };
    expect(validatePlan(weeks, ctx)).toEqual([]);
  });

  it('détecte nombre de séances, jour de repos, unité d\'allure, doublon de discipline', () => {
    const week = clone(WEEK_N);
    week.find((w) => w.id === 'n6').day = 'Dimanche';
    week.find((w) => w.id === 'n9').intensity = '15 km/h';
    week.find((w) => w.id === 'n8').type = 'C.A.P'; // vendredi : 2 séances C.A.P
    week.splice(week.findIndex((w) => w.id === 'n12'), 1); // 11 séances
    const v = validateWeek(normalizeAiWeek(week, 'N'), ctx, 'N');
    expect(codes(v)).toEqual(expect.arrayContaining(['SESSION_COUNT', 'OFF_DAY', 'RUN_PACE_UNIT', 'SAME_DISCIPLINE_DAY']));
    expect(scoreViolations(v)).toBeGreaterThanOrEqual(40);
  });

  it('lit les séries natation et repère un "Total" faux', () => {
    expect(estimateSwimMetersFromDesc(WEEK_N[0].desc)).toBe(3000);
    expect(estimateSwimMetersFromDesc("Échauffement :\n400 NC\nCorps de séance :\n2*(200 PULL R : 20'' / 4*50 educ R : 15'')\n---\n200 souple\nTotal : 1400m")).toBe(1400);
    const bad = { ...WEEK_N[0], desc: WEEK_N[0].desc.replace('Total : 3000m', 'Total : 4500m') };
    const v = validateWeek(normalizeAiWeek([bad, ...WEEK_N.slice(1)], 'N'), ctx, 'N');
    expect(codes(v)).toContain('SWIM_TOTAL_MISMATCH');
    expect(parseAnnouncedSwimTotal(bad.desc)).toBe(4500);
  });

  it('accepte les en-têtes natation EN/ES', () => {
    const en = { ...WEEK_N[0], desc: "Warm-up:\n400 easy\nMain set:\n10*100 Z4 R : 10''\n---\n200 easy\nTotal : 1600m", duration: '35 min' };
    const v = validateWeek(normalizeAiWeek([en, ...WEEK_N.slice(1)], 'N'), ctx, 'N');
    expect(codes(v)).not.toContain('SWIM_FORMAT');
  });

  it('séances dures consécutives : règle adaptée au niveau', () => {
    const N = normalizeAiWeek(WEEK_N, 'N');
    // Expert : qualité natation (jeudi) le lendemain du seuil vélo (mercredi) → OK.
    expect(findConsecutiveHardIssues(N, [], ctx)).toEqual([]);
    // Intermédiaire : deux jours durs consécutifs → signalé.
    const inter = buildValidationContext({ wizardData: { ...MARIN_WIZARD, trainingExperience: 'intermediaire' }, profile: MARIN_PROFILE });
    expect(findConsecutiveHardIssues(N, [], inter).length).toBeGreaterThan(0);
  });

  it('normalise une semaine brute (types, jours, REPOS manquants, ids uniques)', () => {
    const used = new Set();
    const w = normalizeAiWeek([{ id: 'a', day: 'lundi', type: 'Course à pied', title: 'x', duration: '30 min' }, { id: 'a', day: 'Mar.', type: 'velo', title: 'y', duration: '1h' }], 'N', used);
    expect(w).toHaveLength(7);
    expect(w[0].type).toBe('C.A.P');
    expect(w[1].type).toBe('CYCLISME');
    expect(new Set(w.map((x) => x.id)).size).toBe(7);
  });
});

describe('garde-fous cohérents', () => {
  it('easeSession réécrit TOUTE la séance (titre, intensité, description)', () => {
    const hills = WEEK_N.find((w) => w.id === 'n3');
    const eased = easeSession(hills, MARIN_PROFILE, 'test');
    expect(eased.title).toMatch(/allégée/);
    expect(eased.desc).not.toMatch(/côte/i);
    expect(eased.intensity).toMatch(/^\d:\d{2} \/km/);
    expect(eased.duration).toBe(hills.duration);
    expect(eased.autoNote).toMatch(/Côtes courtes/);
    expect(isHardSession(eased)).toBe(false);

    const swim = easeSession(WEEK_N.find((w) => w.id === 'n7'), MARIN_PROFILE, 'test');
    expect(estimateSwimMetersFromDesc(swim.desc)).toBe(parseAnnouncedSwimTotal(swim.desc));

    const brick = easeSession({ id: 'b', day: 'Samedi', type: 'ENCHAÎNEMENT', title: 'Brick', duration: '1h30', desc: '' }, MARIN_PROFILE, 'test');
    expect(brick.type).toBe('ENCHAÎNEMENT');
    expect(brick.desc).toMatch(/vélo Z2/);
  });

  it('expert : séances clés course/vélo conservées, course dure 2 jours de suite allégée', () => {
    const N = normalizeAiWeek(WEEK_N, 'N');
    const kept = enforceNoConsecutiveHardDays(N, [], { expRank: 5, profile: MARIN_PROFILE });
    expect(kept.N.filter((w) => /allégée/.test(w.title))).toHaveLength(0);
    // Mercredi devient une séance dure en COURSE, juste après les côtes du mardi.
    const twoRuns = clone(N);
    twoRuns.find((w) => w.id === 'n5').type = 'C.A.P';
    const fixed = enforceNoConsecutiveHardDays(twoRuns, [], { expRank: 5, profile: MARIN_PROFILE });
    expect(fixed.N.find((w) => w.id === 'n5').title).toMatch(/allégée/); // 2e course dure allégée
    expect(fixed.N.find((w) => w.id === 'n3').title).toBe('Côtes courtes'); // la 1re est conservée
  });

  it('plancher natation selon le format, jamais sur une séance de récupération', () => {
    const recov = WEEK_N.find((w) => w.id === 'n12');
    expect(enforceSwimVolumeFloor([recov], 5, 'expert', 'base', 'S')[0]).toEqual(recov);
    const short = { ...WEEK_N[0], title: 'Aérobie', desc: WEEK_N[0].desc.replace('Total : 3000m', 'Total : 1800m') };
    const out = enforceSwimVolumeFloor([short], 5, 'expert', 'base', 'S')[0];
    expect(parseAnnouncedSwimTotal(out.desc)).toBe(2400);
    expect(out.autoNote).toMatch(/Volume complété/);
  });

  it('plancher de sortie longue : aucun pour un format S, appliqué en L', () => {
    const long = { id: 'l', day: 'Samedi', type: 'CYCLISME', title: 'Sortie longue', duration: '2h00', desc: "Échauffement :\n15'\nCorps de séance :\n1h30 Z2\n15' souple" };
    expect(enforceLongSessionFloor([long], 'expert', 'base', { sportType: 'triathlon', triathlonFormat: 'S' })[0].duration).toBe('2h00');
    expect(enforceLongSessionFloor([long], 'expert', 'base', { sportType: 'triathlon', triathlonFormat: 'L' })[0].duration).toBe('3h00');
  });

  it('densification réelle (le contenu change, pas seulement le titre)', () => {
    const out = applyEasierTrendProgression(normalizeAiWeek(WEEK_N, 'N'), 'easier');
    const d = out.find((w) => /densifiée/.test(w.title));
    expect(d.desc).toMatch(/tempo/);
    expect(parseDurationMinutes(d.duration)).toBeGreaterThanOrEqual(50);
  });

  it('allure EF choisie par l\'IA conservée si elle est dans la zone, corrigée sinon', () => {
    const ef = WEEK_N.find((w) => w.id === 'n6');
    expect(sanitizeWorkout(ef, MARIN_PROFILE).intensity).toBe('4:55 /km');
    expect(sanitizeWorkout({ ...ef, intensity: '3:20 /km' }, MARIN_PROFILE).intensity).toMatch(/65% VMA/);
    const brick = WEEK_N.find((w) => w.id === 'n11');
    expect(sanitizeWorkout(brick, MARIN_PROFILE).intensity).toBe('4:05 /km');
  });

  it('un REPOS n\'est jamais "incomplet" (plus d\'appels IA de complétion inutiles)', () => {
    expect(getIncompleteWorkouts({ N: [{ id: 'r', day: 'Dimanche', type: 'REPOS', title: 'Repos' }], 'N+1': [] })).toEqual([]);
  });
});

describe('patchs du chat', () => {
  const workouts = () => ({ N: normalizeAiWeek(WEEK_N, 'N'), 'N+1': normalizeAiWeek(WEEK_N1, 'N+1') });

  it('modifie la bonne semaine grâce à week + targetId', () => {
    const src = workouts();
    const out = mergeWorkoutPatches(src, [{ week: 'N+1', patchMode: 'modify', targetId: 'm6', day: 'Jeudi', type: 'C.A.P', title: 'Footing court', duration: '40 min', intensity: '5:00 /km', desc: 'x' }], MARIN_PROFILE);
    expect(out['N+1'].find((w) => w.id === 'm6').title).toBe('Footing court');
    expect(out.N.find((w) => w.id === 'n6').title).toBe(src.N.find((w) => w.id === 'n6').title);
  });

  it('supprime une séance (REPOS si c\'était la seule du jour)', () => {
    const src = workouts();
    const out = mergeWorkoutPatches(src, [{ week: 'N', patchMode: 'remove', targetId: 'n5', day: 'Mercredi', type: 'CYCLISME' }], MARIN_PROFILE);
    expect(out.N.find((w) => w.id === 'n5')).toBeUndefined(); // mercredi garde la natation n12
    const out2 = mergeWorkoutPatches(src, [{ week: 'N', patchMode: 'remove', targetId: 'n9', day: 'Vendredi' }], MARIN_PROFILE);
    expect(out2.N.filter((w) => w.day === 'Vendredi' && w.type !== 'REPOS')).toHaveLength(1);
  });

  it('un ajout remplace l\'entrée REPOS du jour', () => {
    const src = workouts();
    const out = mergeWorkoutPatches(src, [{ week: 'N', patchMode: 'add', targetId: '', day: 'Dimanche', type: 'C.A.P', title: 'Footing', duration: '30 min', intensity: '5:00 /km', desc: 'x' }], MARIN_PROFILE);
    expect(out.N.filter((w) => w.day === 'Dimanche').map((w) => w.type)).toEqual(['C.A.P']);
  });
});

describe('prompts', () => {
  it('le chat reçoit la date, les dates des séances, les ids et l\'historique', () => {
    const c = buildAthleteContext({ wizardData: MARIN_WIZARD, profile: MARIN_PROFILE, clientDate: '2026-09-25' });
    const { system, prompt } = buildChatPrompt(c, {
      message: 'et jeudi ?',
      history: [{ sender: 'user', text: 'Je suis fatigué, allège mardi prochain' }, { sender: 'coach', text: 'OK, côtes remplacées.' }],
      workouts: { N: normalizeAiWeek(WEEK_N, 'N'), 'N+1': normalizeAiWeek(WEEK_N1, 'N+1') },
    });
    expect(prompt).toContain("Aujourd'hui : vendredi 25/09/2026");
    expect(prompt).toContain('[m3] Mardi mar. 29/09');
    expect(prompt).toContain('Athlète : Je suis fatigué');
    expect(system).toMatch(/UNE question précise/);
  });

  it('zones course contiguës et cohérentes avec lib/zones.js', () => {
    const txt = runZonesText(20);
    expect(txt).toContain('Z2 endurance fondamentale : 4:00 à 4:50 /km');
  });
});
