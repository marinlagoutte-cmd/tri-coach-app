import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseSeasonPlan, parseGuide, parseRaces, mergeSeasonRaces, removeSeasonRaces, seasonWeekInfo } from '../lib/seasonImport';
import { sanitizeWorkout, forceRecalcWorkoutPaces, scaleSeasonWatts, isSeasonPlanSession, classifyDiscipline, shortLabel, parseClubSessionDesc, parseDurationMinutes } from '../lib/workouts';
import { WORKOUT_TYPES } from '../lib/planSchema';

const raw = readFileSync(new URL('../plans/plan-marin-saison-2027-v2.json', import.meta.url), 'utf8');
const season = parseSeasonPlan(raw);
const all = season.weeks.flatMap((w) => w.sessions.map((s) => ({ ...s, weekStart: w.weekStart })));
const real = all.filter((s) => s.type !== 'REPOS');
const PROFILE = { ftp: 360, vma: 19.5, nat100: '1:39', fcMax: 191, fcRepos: 45 };

describe('plan de saison 2027 (trail & triathlon) — fichier importé', () => {
  it('se lit sans erreur : 46 semaines du 19/10/2026 au 30/08/2027, semaine en cours remplacée', () => {
    expect(season.weeks).toHaveLength(46);
    expect(season.meta.firstWeek).toBe('2026-10-19');
    expect(season.meta.lastWeek).toBe('2027-08-30');
    expect(season.meta.targetDate).toBe('2027-08-20');
    expect(season.meta.replaceCurrentWeek).toBe(true);
    expect(season.constraints.offDays).toBe('Lundi');
    expect(real.length).toBeGreaterThan(500);
  });

  it('chaque semaine a sa nature, son repère et son objectif', () => {
    season.weeks.forEach((w) => {
      expect(['charge', 'decharge', 'transition', 'taper', 'race', 'raceB', 'recovery']).toContain(w.kind);
      expect(w.code, w.weekStart).toMatch(/^(DK\d|S\d{1,2})$/);
      expect(w.focus.length, w.weekStart).toBeGreaterThan(10);
    });
    expect(seasonWeekInfo(season, '2026-11-16').label).toBe('Retour à Bordeaux');
    expect(seasonWeekInfo(season, '2027-08-16').kind).toBe('race');
  });

  it('types connus de l\'app, durées lisibles, feuille de séance « Corps de séance »', () => {
    real.forEach((s) => {
      expect(WORKOUT_TYPES, s.id).toContain(s.type);
      expect(parseDurationMinutes(s.duration), s.id).toBeGreaterThan(0);
      expect(parseClubSessionDesc(s.desc), s.id).not.toBeNull();
      expect(s.structure, s.id).toBeTruthy();
    });
    expect(new Set(all.map((s) => s.id)).size).toBe(all.length);
  });

  it('natation : jamais deux nages le même jour, ≥ 2 500 m, intention au RPE (aucun chrono /100 m)', () => {
    season.weeks.forEach((w) => {
      const days = w.sessions.filter((s) => s.type === 'NATATION').map((s) => s.day);
      expect(new Set(days).size, w.weekStart).toBe(days.length);
    });
    real.filter((s) => s.type === 'NATATION').forEach((s) => {
      const total = Number(parseClubSessionDesc(s.desc).total.replace(/\D/g, ''));
      expect(total, s.id).toBeGreaterThanOrEqual(2500);
      expect(s.intensity, s.id).toMatch(/RPE/);
      expect(s.intensity, s.id).not.toMatch(/\d:\d{2}\s*\/\s*100/);
    });
  });

  it('vélo : récupération exacte sur toutes les séances par intervalles', () => {
    real.filter((s) => ['V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'VA'].includes(s.code)).forEach((s) => {
      expect(s.restTime, s.id).toMatch(/\d+('|")/);
    });
  });

  it('renfo toujours le soir, lundi off (hors séances déjà faites du 19/10 et stage montagne)', () => {
    real.filter((s) => s.type === 'RENFO').forEach((s) => expect(s.slot, s.id).toBe('Soir'));
    const monday = real.filter((s) => s.day === 'Lundi');
    monday.forEach((s) => expect(['2026-10-19', '2027-07-19'], s.id).toContain(s.weekStart));
    all.filter((s) => s.weekStart === '2026-10-19' && s.day === 'Lundi' && s.type !== 'REPOS')
      .forEach((s) => expect(s.doneBeforeImport, s.id).toBe(true));
  });

  it('courses : 11 fiches (Échappée Belle en A) et guide complet', () => {
    expect(season.races).toHaveLength(11);
    const eb = season.races.find((r) => r.id === 'season-EB');
    expect(eb.priority).toBe('A');
    expect(eb.date).toBe('2027-08-20');
    expect(season.guide.sections.length).toBeGreaterThanOrEqual(12);
    const lib = season.guide.sections.find((s) => s.id === 'bibliotheque');
    expect(lib.blocks.filter((b) => b.t === 'card').length).toBeGreaterThanOrEqual(40);
    // chaque course datée renvoie à sa fiche
    real.filter((s) => s.raceId).forEach((s) => expect(season.races.some((r) => r.id === s.raceId), s.id).toBe(true));
  });
});

describe('séances du plan de saison dans l\'app', () => {
  const swim = real.find((s) => s.type === 'NATATION' && !s.doneBeforeImport);
  const footing = real.find((s) => s.code === 'C1' && !s.doneBeforeImport);
  const renfo = real.find((s) => s.type === 'RENFO');
  const v1 = real.find((s) => s.code === 'V1' && !s.doneBeforeImport);

  it('les garde-fous IA ne réécrivent pas une séance du plan (intention de nage, footing au cardio, renfo)', () => {
    expect(isSeasonPlanSession(swim)).toBe(true);
    expect(sanitizeWorkout(swim, PROFILE).intensity).toBe(swim.intensity);
    expect(sanitizeWorkout(footing, PROFILE).intensity).toBe(footing.intensity);
    expect(sanitizeWorkout(renfo, PROFILE).effortZone).toBe(renfo.effortZone);
    // une fois ajustée par le coach, la séance repasse par les garde-fous habituels
    expect(sanitizeWorkout({ ...swim, modified: true }, PROFILE).intensity).not.toBe(swim.intensity);
  });

  it('« Actualiser les séances » recalcule les watts sur la FTP du profil', () => {
    expect(forceRecalcWorkoutPaces(v1, PROFILE)).toEqual(v1);
    const up = forceRecalcWorkoutPaces(v1, { ...PROFILE, ftp: 378 });
    expect(up.refFtp).toBe(378);
    const [a, b] = v1.intensity.match(/(\d{3})-(\d{3})/).slice(1).map(Number);
    const [a2, b2] = up.intensity.match(/(\d{3})-(\d{3})/).slice(1).map(Number);
    expect(a2).toBe(Math.round((a * 1.05) / 5) * 5);
    expect(b2).toBe(Math.round((b * 1.05) / 5) * 5);
    expect(up.desc).not.toBe(v1.desc);
    expect(scaleSeasonWatts({ intensity: '200 W' }, { ftp: 300 })).toEqual({ intensity: '200 W' });
  });

  it('le renfo est une discipline à part (jamais classé en course, libellé RENFO)', () => {
    expect(classifyDiscipline('RENFO')).toBeNull();
    expect(shortLabel('RENFO')).toBe('RENFO');
  });
});

describe('courses, guide et action rapide', () => {
  it('fusionne les courses du plan sans toucher aux courses ajoutées à la main', () => {
    const manual = { id: 'm1', name: 'Course perso', date: '2027-06-12', priority: 'C' };
    const clash = { id: 'm2', name: 'Hostens (à la main)', date: '2027-04-25', priority: 'B' };
    const old = { id: 'season-OLD', name: 'Ancien plan', date: '2027-09-04', priority: 'A', source: 'season-plan' };
    const merged = mergeSeasonRaces([manual, clash, old], season.races);
    expect(merged.find((r) => r.id === 'season-OLD')).toBeUndefined();
    expect(merged.filter((r) => r.date === '2027-04-25')).toHaveLength(1);
    expect(merged.find((r) => r.id === 'm1')).toBeTruthy();
    expect(merged.some((r) => r.id === 'season-EB' && r.source === 'season-plan')).toBe(true);
    expect(merged.some((r) => r.id === 'season-STAGE')).toBe(false); // stage sans priorité
    expect(removeSeasonRaces(merged).every((r) => r.source !== 'season-plan')).toBe(true);
  });

  it('ignore les blocs et courses mal formés', () => {
    const g = parseGuide({ title: 'G', sections: [{ title: 'A', blocks: [{ t: 'p', text: 'ok' }, { t: 'script' }, null] }, { nope: 1 }] });
    expect(g.sections).toHaveLength(1);
    expect(g.sections[0].blocks).toEqual([{ t: 'p', text: 'ok' }]);
    expect(parseGuide({ sections: [] })).toBeNull();
    expect(parseRaces([{ name: 'X', date: 'demain' }, { name: 'Y', date: '2027-05-01', priority: 'Z' }])).toEqual([
      expect.objectContaining({ name: 'Y', priority: null, strategy: [] }),
    ]);
  });

  it('propose le guide dans les actions rapides', () => {
    // (composant JSX non importable tel quel par vitest : on lit sa source)
    const src = readFileSync(new URL('../components/ui/QuickActions.js', import.meta.url), 'utf8');
    expect(src).toMatch(/id: 'guide'/);
  });
});
