import { describe, it, expect } from 'vitest';
import { buildAthleteContext, buildPlanPrompt } from '../lib/coachPrompts';
import { enforceSessionCount, enforceMaxSessionsPerDay, sessionWeight, classifyDiscipline } from '../lib/workouts';
import { buildLoadCycle } from '../lib/trainingCycle';
import { getSeasonOutlook } from '../lib/seasonPlan';

// Cas réel de l'athlète : D3 triathlon S, 20 h/semaine, 15 séances, dimanche repos, cycle 3:1
// démarré la semaine 39 (lundi 21/09).
const MARIN = {
  sportType: 'triathlon', triathlonFormat: 'S', customDistances: { swim: 0.75, bike: 20, run: 5 },
  hoursPerWeek: 20, maxSessionsPerWeek: 15, offDays: 'Dimanche', fitnessLevel: 5, trainingExperience: 'expert',
  hasExistingTrainingBase: true, targetDate: '2027-06-27', loadCycle: buildLoadCycle('3:1', 1, '2026-09-21'),
  knownPhysio: { vma: '', ftp: '360', css: '', fcMax: '191', fcRepos: '45' },
};

// Semaine 40 telle que générée (lue sur la vidéo) : 11 cartes = 12 séances comptées.
const S40 = [
  ['Lundi', 'NATATION', 'Technique appuis', '1h15'], ['Lundi', 'C.A.P', 'Sortie endurance', '1h30'],
  ['Mardi', 'C.A.P', 'VMA courte 12x400m', '1h05'], ['Mardi', 'NATATION', 'Fréquence et rythme', '1h24'],
  ['Mercredi', 'CYCLISME', "Sweet Spot 3x18'", '2h00'], ['Mercredi', 'NATATION', 'Endurance aérobie', '1h00'],
  ['Jeudi', 'CYCLISME', 'Vélocité', '1h30'], ['Jeudi', 'NATATION', 'Volume', '1h15'],
  ['Vendredi', 'CYCLISME', 'Sortie endurance', '3h30'], ['Vendredi', 'C.A.P', 'Tempo', '50 min'],
  ['Samedi', 'ENCHAÎNEMENT', 'Brick intensité', '2h45'], ['Dimanche', 'REPOS', 'Repos', '0 min'],
].map(([day, type, title, duration], i) => ({ id: `s40-${i}`, day, type, title, duration, intensity: 'Z2', desc: 'x', structure: 'x' }));

const weighted = (list) => list.filter((w) => w.type !== 'REPOS').reduce((s, w) => s + sessionWeight(w), 0);

describe('cas réel : 15 séances sur 6 jours', () => {
  it('la consigne donne une répartition possible (et non « 9 jours avec 2 ou 3 séances »)', () => {
    const { prompt } = buildPlanPrompt(buildAthleteContext({ wizardData: MARIN, profile: {}, clientDate: '2026-09-27' }));
    expect(prompt).toContain('Pour 15 séances sur 6 jours disponibles : 3 jour(s) à 3 séances, 3 jour(s) à 2 séances');
    expect(prompt).not.toContain('il faut 9 jour(s)');
  });

  it('la semaine 40 rendue à 12 séances est complétée à 15, sans dépasser 3 par jour', () => {
    let list = enforceSessionCount(S40, 15, 'Dimanche', {}, 'triathlon', { tripleEligible: true });
    list = enforceMaxSessionsPerDay(list, 'Dimanche', 'triathlon', 15, { fitnessLevel: 5, hoursPerWeek: 20, trainingExperience: 'expert' });
    expect(weighted(list)).toBe(15);
    const perDay = {};
    list.filter((w) => w.type !== 'REPOS').forEach((w) => { perDay[w.day] = (perDay[w.day] || 0) + 1; });
    expect(Math.max(...Object.values(perDay))).toBeLessThanOrEqual(3);
    expect(perDay.Dimanche).toBeUndefined();
    expect(list.filter((w) => w.day === 'Samedi' && w.type !== 'REPOS').map((w) => classifyDiscipline(w.type))).toEqual(['ENCHAÎNEMENT']);
  });

  it('sans droit aux journées à 3 séances, le plafond reste 12 (inchangé)', () => {
    expect(weighted(enforceSessionCount(S40, 15, 'Dimanche', {}, 'triathlon'))).toBe(12);
  });

  it('aperçu des semaines 41 et 42 : charge pleine puis décharge', () => {
    const [w41, w42] = getSeasonOutlook(MARIN, '2026-09-21', [], [2, 3], new Date('2026-09-27T20:00:00'));
    expect(w41).toMatchObject({ estHoursPerWeek: 20, sessionsTarget: 15, kindLabel: 'Charge 3/3' });
    expect(w42).toMatchObject({ estHoursPerWeek: 14, sessionsTarget: 15, kindLabel: 'Décharge' });
  });
});
