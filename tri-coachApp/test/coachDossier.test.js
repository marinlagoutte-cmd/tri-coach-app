import { describe, it, expect } from 'vitest';
import { diffSessions, appendJournal, buildCoachDossier, JOURNAL_MAX, dossierFileName } from '../lib/coachDossier';

const w = (id, title, duration = '1h00', extra = {}) => ({ id, day: 'Lundi', type: 'CYCLISME', title, duration, ...extra });

describe('suivi par Claude : journal et dossier', () => {
  it('diffSessions : séances modifiées (avant / après), ajoutées, supprimées ; repos ignorés', () => {
    const before = [w('a', 'Seuil 3×15'), w('b', 'Endurance'), { id: 'r', day: 'Dimanche', type: 'REPOS', title: 'Repos' }];
    const after = [w('a', 'Seuil 3×15', '45 min'), w('c', 'Vélocité')];
    const d = diffSessions(before, after);
    expect(d).toContainEqual({ id: 'a', change: 'modifiée', fields: ['duration'], before: { duration: '1h00' }, after: { duration: '45 min' } });
    expect(d.find((x) => x.id === 'c').change).toBe('ajoutée');
    expect(d.find((x) => x.id === 'b').change).toBe('supprimée');
    expect(d.some((x) => x.id === 'r')).toBe(false);
  });
  it('journal daté et borné', () => {
    let j = [];
    j = appendJournal(j, 'validation-seance', { workoutId: 'a' }, new Date('2026-10-12T08:00:00Z'));
    expect(j[0]).toEqual({ at: '2026-10-12T08:00:00.000Z', type: 'validation-seance', workoutId: 'a' });
    const big = Array.from({ length: JOURNAL_MAX }, (_, i) => ({ at: 'x', type: 't', i }));
    const capped = appendJournal(big, 'dernier');
    expect(capped).toHaveLength(JOURNAL_MAX);
    expect(capped[capped.length - 1].type).toBe('dernier');
  });
  it('dossier : toutes les rubriques, sans photo encodée ni flux GPS', () => {
    const d = buildCoachDossier({
      profile: { firstName: 'Marin', ftp: 360, photo: 'data:image/png;base64,AAAA' },
      seasonPlan: { meta: { title: 'Saison 2027', weeksCount: 47 }, weeks: [{ weekStart: '2026-10-12' }] },
      workouts: { N: [w('a', 'Seuil')], 'N+1': [] }, weekAnchor: '2026-10-12',
      journal: [{ at: 'x', type: 'ajustement-coach' }],
      stravaActivities: [{ id: 1, name: 'Sortie', streams: { watts: [1, 2] }, ai_analysis: 'Bonne séance' }],
      exportedAt: new Date('2026-10-12T10:00:00Z'),
    });
    expect(d.format).toBe('tri-coach-dossier');
    expect(d.athlete).toEqual({ firstName: 'Marin', ftp: 360 });
    expect(d.plan.seasonPlan).toEqual({ title: 'Saison 2027', weeksCount: 47 });
    expect(d.currentWeeks.weekStart).toBe('2026-10-12');
    expect(d.stravaActivities[0]).toEqual({ id: 1, name: 'Sortie', ai_analysis: 'Bonne séance' });
    ['weekHistory', 'sessionFeedback', 'sessionStatus', 'health', 'injuries', 'races', 'coachChat', 'journal', 'zones', 'questionnaire']
      .forEach((k) => expect(d, k).toHaveProperty(k));
    expect(dossierFileName(new Date('2026-10-12T10:00:00Z'))).toBe('tri-coach-dossier-2026-10-12.json');
  });
});
