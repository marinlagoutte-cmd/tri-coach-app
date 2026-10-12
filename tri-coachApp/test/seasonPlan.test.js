import { describe, it, expect } from 'vitest';
import { parseSeasonPlan, fillWeeksFromSeason, seasonWeek, mondayOfIso, addDaysIso } from '../lib/seasonImport';
import { validatePlan, buildValidationContext, estimateSwimMetersFromDesc } from '../lib/planValidation';
import { classifyDiscipline } from '../lib/workouts';
import { generateSeasonPlan } from '../scripts/season-plan/generator.js';
import { MARIN_2026_2027 } from '../scripts/season-plan/config-marin-2026-2027.js';

const mini = (weeks) => ({ format: 'tri-coach-season-plan', version: 1, meta: { title: 'Test' }, weeks });
const S = (day, type = 'C.A.P', title = 'Footing') => ({ day, type, title, duration: '45 min' });

describe('import d\'un plan de saison', () => {
  it('refuse un fichier mal formé avec un message clair', () => {
    expect(() => parseSeasonPlan('pas du json')).toThrow(/JSON/);
    expect(() => parseSeasonPlan({ format: 'autre' })).toThrow(/format/);
    expect(() => parseSeasonPlan(mini([{ weekStart: '2026-10-13', sessions: [] }]))).toThrow(/lundi/);
    expect(() => parseSeasonPlan(mini([{ weekStart: '2026-10-12', sessions: [S('Lundy')] }]))).toThrow(/jour/);
  });
  it('complète les jours de repos et numérote les séances', () => {
    const season = parseSeasonPlan(mini([{ weekStart: '2026-10-12', sessions: [S('Mardi'), S('Lundi', 'NATATION', 'Nat')] }]));
    const w = season.weeks[0].sessions;
    expect(w).toHaveLength(7);
    expect(w[0].day).toBe('Lundi');
    expect(w.filter((x) => x.type === 'REPOS')).toHaveLength(5);
    expect(new Set(w.map((x) => x.id)).size).toBe(7);
  });
  it('remplit N / N+1 depuis le plan, sans écraser une semaine déjà ajustée', () => {
    const season = parseSeasonPlan(mini([{ weekStart: '2026-10-12', sessions: [S('Lundi')] }, { weekStart: '2026-10-19', sessions: [S('Mardi')] }]));
    const adjusted = [{ id: 'a', day: 'Lundi', type: 'C.A.P', title: 'Ajustée par le coach' }];
    const out = fillWeeksFromSeason({ N: adjusted, 'N+1': [] }, season, '2026-10-12');
    expect(out.N).toBe(adjusted);
    expect(out['N+1'].some((x) => x.title === 'Footing')).toBe(true);
    expect(fillWeeksFromSeason({ N: adjusted, 'N+1': [] }, season, '2026-10-12', { onlyEmpty: false }).N[0].title).toBe('Footing');
    expect(mondayOfIso('2026-10-18')).toBe('2026-10-12');
    expect(addDaysIso('2026-10-12', 7)).toBe('2026-10-19');
    expect(seasonWeek(season, '2027-01-04')).toBeNull();
  });
});

describe('plan de saison de Marin (généré)', () => {
  const season = parseSeasonPlan(JSON.parse(JSON.stringify(generateSeasonPlan(MARIN_2026_2027))));

  it('47 semaines, 15 séances en charge et en décharge, dimanche repos hors course', () => {
    expect(season.weeks).toHaveLength(47);
    season.weeks.forEach((w) => {
      const real = w.sessions.filter((s) => s.type !== 'REPOS');
      if (['charge', 'decharge'].includes(w.kind)) expect(real.length, w.weekStart).toBe(15);
      const sunday = real.filter((s) => s.day === 'Dimanche');
      expect(sunday.every((s) => /🏁/.test(s.title)), w.weekStart).toBe(true);
    });
  });

  it('natation : une par jour, ≥ 2500 m, éducatifs, total conforme aux séries', () => {
    season.weeks.forEach((w) => {
      const swims = w.sessions.filter((s) => classifyDiscipline(s.type) === 'NATATION');
      const days = swims.map((s) => s.day);
      expect(new Set(days).size, w.weekStart).toBe(days.length);
      swims.forEach((s) => {
        const total = Number(s.desc.match(/Total : (\d+)m/)[1]);
        expect(total, `${w.weekStart} ${s.title}`).toBeGreaterThanOrEqual(2500);
        expect(estimateSwimMetersFromDesc(s.desc)).toBe(total);
        expect(s.desc).toMatch(/[ée]duc|godille|rattrap|visée|battements/);
      });
    });
  });

  it('le validateur de l\'app ne relève rien sur toute la saison', () => {
    const profile = { ftp: 360, vma: 19, nat100: '1:40', fcMax: 191, fcRepos: 45 };
    const issues = [];
    for (let i = 0; i < season.weeks.length - 1; i += 1) {
      const a = season.weeks[i]; const b = season.weeks[i + 1];
      const wctx = (w) => ({ kind: w.kind, sessionsTarget: ['charge', 'decharge'].includes(w.kind) ? 15 : null, phaseKey: /base/i.test(w.phase) ? 'base' : 'build' });
      const ctx = buildValidationContext({ wizardData: MARIN_2026_2027.constraints, profile, weekHours: { N: a.plannedHours, 'N+1': b.plannedHours }, weekCtx: { N: wctx(a), 'N+1': wctx(b) } });
      validatePlan({ N: a.sessions, 'N+1': b.sessions }, ctx).forEach((v) => issues.push(`${a.weekStart} ${v.code} ${v.message}`));
    }
    expect(issues).toEqual([]);
  });

  it('les 7 courses aux dates validées (calées sur 2026), Ambès non placé', () => {
    const DAY = { Lundi: 0, Mardi: 1, Mercredi: 2, Jeudi: 3, Vendredi: 4, Samedi: 5, Dimanche: 6 };
    const races = season.weeks.flatMap((w) => w.sessions.filter((s) => /🏁/.test(s.title)).map((s) => {
      const d = new Date(`${w.weekStart}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + DAY[s.day]);
      return `${d.toISOString().slice(0, 10)} ${s.title.replace('🏁 ', '')}`;
    }));
    expect(races).toEqual([
      '2027-03-28 Demi-finale Duathlon D3',
      "2027-04-25 Triathlon d'Hostens",
      '2027-05-01 Triathlon de Bègles',
      '2027-05-09 Sélection régionale Triathlon D3',
      '2027-06-12 Triathlon du Lac de Cadarsac',
      '2027-07-03 Demi-finale Triathlon D3',
      '2027-09-04 Triathlon de Bordeaux (M)',
    ]);
    expect(races.join(' ')).not.toMatch(/Ambès/);
  });

  it('mini-affûtage : déblocage la veille de chaque course secondaire', () => {
    season.weeks.filter((w) => w.kind === 'raceB').forEach((w) => {
      const race = w.sessions.find((s) => /🏁/.test(s.title));
      const veille = race.day === 'Dimanche' ? 'Samedi' : 'Vendredi';
      expect(w.sessions.some((s) => s.day === veille && /Déblocage/.test(s.title)), w.weekStart).toBe(true);
      expect(w.plannedHours, w.weekStart).toBeLessThan(15);
    });
  });

  it('double seuil : jamais d\'intensité la veille ni le lendemain', () => {
    season.weeks.forEach((w) => {
      if (!w.sessions.some((s) => /double seuil/i.test(s.title))) return;
      const wed = w.sessions.filter((s) => s.day === 'Mercredi' && s.type !== 'NATATION');
      expect(wed.every((s) => /Z1|Z2/.test(s.effortZone)), w.weekStart).toBe(true);
      expect(w.sessions.filter((s) => s.day === 'Vendredi' && s.type === 'NATATION').every((s) => /éducatifs/.test(s.title)), w.weekStart).toBe(true);
    });
  });
});
