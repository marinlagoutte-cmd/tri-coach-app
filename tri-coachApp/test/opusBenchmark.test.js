// Banc d'essai "plafond de qualité" : réponse rédigée par Claude Opus 5.5 au prompt EXACT
// de l'app pour le profil réel de Marin (01_Profil_Athlete.md : FTP 360 W, FC max 191,
// 10 km en 35:15, 89 kg, expert, tri S drafting D3, 18 h, 12 séances, dimanche repos ;
// CSS et FC repos non renseignées). Date d'objectif = hypothèse (calendrier FFTri 2027
// non publié). Ce plan cohérent doit traverser tout le pipeline sans une seule retouche.
// Il a révélé deux défauts, corrigés : RPE des côtes/PPG converti en allure de footing,
// et plafond "vélo ~2h" incompatible avec 18 h en format court.
import { describe, it, expect, vi } from 'vitest';
import RESP from './fixtures/opusMarinPlan.json';

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    constructor() {
      this.models = { generateContent: async ({ contents }) => ({ text: JSON.stringify(String(contents).includes('Tu relis le plan') ? { issues: [], corrections: [] } : RESP) }) };
    }
  },
}));
process.env.GEMINI_API_KEY = 'x';

export const MARIN_REAL = {
  firstName: 'Marin', gender: 'homme', weight: 89, fitnessLevel: 5, trainingExperience: 'expert', hasExistingTrainingBase: true,
  sportType: 'triathlon', triathlonFormat: 'S', customDistances: { swim: 0.75, bike: 20, run: 5 }, eventName: 'Demi-finale D3 triathlon',
  triathlonTimes: { swim: '', transition_t1: '', bike: '', transition_t2: '', run: '', total: '' },
  targetDate: '2027-06-27', hoursPerWeek: 18, maxSessionsPerWeek: 12, offDays: 'Dimanche', ppgEnabled: true, bikeTestEquipment: 'home_trainer',
  knownPhysio: { vma: '', ftp: '360', css: '', fcMax: '191', fcRepos: '' }, recentResult: { distanceKm: '10', time: '35:15', context: 'route' },
};
const MARIN_HR_ZONES = [{ min: 0 }, { min: 126 }, { min: 148 }, { min: 166 }, { min: 178 }];

describe('plafond de qualité (plan Opus, profil réel)', () => {
  it('traverse tout le pipeline sans aucune retouche', async () => {
    const { generatePlanWithAI } = await import('../lib/gemini');
    const out = await generatePlanWithAI({ wizardData: MARIN_REAL, profile: { weight: 89 }, clientDate: '2026-09-25', manualHrZones: MARIN_HR_ZONES });
    const before = Object.fromEntries([...RESP.weekN, ...RESP.weekN1].map((w) => [w.id, w]));
    [...out.workouts.N, ...out.workouts['N+1']].filter((w) => w.type !== 'REPOS').forEach((w) => {
      ['day', 'type', 'title', 'duration', 'intensity', 'desc'].forEach((f) => expect(w[f], `${w.id}.${f}`).toBe(before[w.id][f]));
      expect(w.autoNote, w.id).toBeFalsy();
    });
    expect(out.validation).toMatchObject({ initialScore: 0, score: 0, errors: 0 });
    expect(out.qualityWarnings).toEqual([]);
  });

  it('le prompt contient les zones FC de l\'athlète et un repère de sortie longue compatible avec 18 h', async () => {
    const { buildAthleteContext, buildPlanPrompt } = await import('../lib/coachPrompts');
    const ctx = buildAthleteContext({ wizardData: MARIN_REAL, profile: {}, clientDate: '2026-09-25', manualHrZones: MARIN_HR_ZONES });
    const { prompt } = buildPlanPrompt(ctx);
    expect(prompt).toContain('Z2 126-147');
    expect(prompt).toContain("zones saisies par l'athlète");
    expect(prompt).toMatch(/vélo Z2 de 2h30 à 3h30/);
    expect(prompt).not.toContain('vélo ~2h');
  });

  it('garde le RPE des côtes et de la PPG, convertit seulement un footing continu', async () => {
    const { sanitizeWorkout } = await import('../lib/workouts');
    const profile = { vma: 19.1 };
    const hills = RESP.weekN.find((w) => w.id === 'n5');
    const ppg = RESP.weekN.find((w) => w.id === 'n10');
    expect(sanitizeWorkout(hills, profile).intensity).toBe(hills.intensity);
    expect(sanitizeWorkout(ppg, profile).intensity).toBe(ppg.intensity);
    const footing = { id: 'f', day: 'Mardi', type: 'C.A.P', title: 'Footing', duration: '45 min', intensity: 'RPE 4/10', effortZone: 'Z2', desc: "40' continu Z2" };
    expect(sanitizeWorkout(footing, profile).intensity).toMatch(/\/km/);
  });
});
