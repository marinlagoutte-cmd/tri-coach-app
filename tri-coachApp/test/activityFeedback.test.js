import { describe, it, expect, vi } from 'vitest';

const seen = { prompt: '' };
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    constructor() {
      this.models = {
        generateContent: async ({ contents }) => {
          seen.prompt = String(contents);
          // Le modèle répond « below_target » : ne doit PAS passer pour une séance hors plan.
          return { text: JSON.stringify({ verdict: 'below_target', analysis: 'Réalisé : 1h25, 205 W (57 % FTP, Z2).\nPar rapport au plan : Séance hors plan.\nPour la suite : rien à changer.' }) };
        },
      };
    }
  },
}));
process.env.GEMINI_API_KEY = 'x';

const { weekKeyForDate, findAutoMatch, plannedSessionsOnDay } = await import('../lib/stravaMatch');
const { describeActivityFacts } = await import('../lib/activityFacts');
const { analyzeStravaActivity } = await import('../lib/gemini');

const W39 = [
  { id: 'a', day: 'Lundi', type: 'NATATION', title: 'Test CSS', duration: '1h00' },
  { id: 'b', day: 'Mercredi', type: 'CYCLISME', title: "Sweet Spot 3x15'", duration: '1h45', intensity: '330W' },
];
const W40 = [
  { id: 'c', day: 'Lundi', type: 'NATATION', title: 'Technique appuis', duration: '1h15' },
  { id: 'd', day: 'Lundi', type: 'C.A.P', title: 'Sortie endurance', duration: '1h30' },
  { id: 'e', day: 'Mercredi', type: 'CYCLISME', title: "Sweet Spot 3x18'", duration: '2h00', intensity: '335W' },
];
// Sortie vélo réelle du lundi 28/09 (chiffres du retour reçu par l'athlète).
const RIDE = { id: 1, sport_type: 'Ride', start_date_local: '2026-09-28T08:30:00', moving_time_s: 85 * 60, distance_m: 42000, average_watts: 205, max_watts: 228, average_heartrate: 122, max_heartrate: 130 };
const PROFILE = { ftp: 360, fcMax: 191 };

describe('association activité ↔ séance', () => {
  it('la semaine vient de la date de l\'activité', () => {
    expect(weekKeyForDate('2026-09-28', '2026-09-28')).toBe('N');
    expect(weekKeyForDate('2026-10-05', '2026-09-28')).toBe('N+1');
    expect(weekKeyForDate('2026-09-27', '2026-09-28')).toBeNull();
    expect(weekKeyForDate('2026-09-28', null)).toBe('N'); // anciens plans
  });
  it('serveur resté sur la semaine 39 : la sortie du 28/09 est cherchée en semaine 40, jamais dans le sweet spot de la 39', () => {
    const r = findAutoMatch(RIDE, { N: W39, 'N+1': W40 }, new Set(), { weekAnchor: '2026-09-21' });
    expect(r.weekKey).toBe('N+1');
    expect(r.confidence).toBe('fuzzy'); // pas de vélo lundi : simple piste (mercredi)
    expect(plannedSessionsOnDay(RIDE, { N: W39, 'N+1': W40 }, '2026-09-21').map((w) => w.title)).toEqual(['Technique appuis', 'Sortie endurance']);
  });
});

describe('faits chiffrés dans les zones de l\'athlète', () => {
  it('vélo : % FTP et zone ; FC : zone', () => {
    const f = describeActivityFacts(RIDE, PROFILE).join(' | ');
    expect(f).toContain('durée en mouvement 1h25');
    expect(f).toContain('42 km');
    expect(f).toContain('Puissance moyenne 205 W = 57 % de la FTP (360 W) → Z2');
    expect(f).toContain('FC moyenne 122 bpm → Z2');
  });
});

describe('retour de séance hors plan', () => {
  it('pas de comparaison, pas de verdict négatif, style sans accroche', async () => {
    const out = await analyzeStravaActivity({
      activity: RIDE, plannedWorkout: null, movedCandidate: W40[2], sameDayPlanned: W40.slice(0, 2), profile: PROFILE,
    });
    expect(out.verdict).toBe('no_comparison');
    expect(seen.prompt).toContain('séance HORS PLAN');
    expect(seen.prompt).toContain('Prévu ce jour-là (autres disciplines) : NATATION « Technique appuis »');
    expect(seen.prompt).toMatch(/Piste possible[^\n]*UNIQUEMENT au conditionnel/);
    expect(seen.prompt).toContain('AUCUNE formule d\'accroche');
    expect(seen.prompt).toContain('Puissance moyenne 205 W = 57 % de la FTP');
    expect(out.analysis.split('\n')).toHaveLength(3);
  });
});
