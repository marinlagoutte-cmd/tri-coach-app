// scripts/season-plan/config-marin-2026-2027.js — configuration du plan de saison de Marin.
// Modifier ici (repères, dates de course) puis relancer : node scripts/season-plan/generate.mjs

const C = (weekStart, phase, idx) => ({ weekStart, phase, kind: 'charge', idx, label: `Charge ${idx}/3` });
const D = (weekStart, phase) => ({ weekStart, phase, kind: 'decharge', label: 'Décharge' });

export const MARIN_2026_2027 = {
  title: 'Saison 2027 — D3 et Triathlon de Bordeaux',
  targetDate: '2027-07-03', // demi-finale D3 triathlon (provisoire, calée sur 2026)
  generatedAt: '2026-10-10',
  swimMinMeters: 2500,
  athlete: {
    firstName: 'Marin', ftp: 360, vma: 19, css: '1:40', fcMax: 191,
    hrZones: { z2: [126, 147], z3: [148, 165], z4: [166, 177], z5: [178, 191] },
  },
  constraints: {
    sportType: 'triathlon', triathlonFormat: 'S', customDistances: { swim: 0.75, bike: 20, run: 5 },
    hoursPerWeek: 20, maxSessionsPerWeek: 15, offDays: 'Dimanche', fitnessLevel: 5, trainingExperience: 'expert',
    hasExistingTrainingBase: true, targetDate: '2027-07-03', swimMinMeters: 2500,
    loadCycle: { pattern: '3:1', anchor: '2026-09-21' },
  },
  assumptions: [
    "Dates calées sur les éditions 2026 (calendrier 2027 non publié), validées par l'athlète : demi-finale duathlon D3 dim. 28/03, Hostens (S) dim. 25/04, Bègles (S) sam. 01/05, sélection régionale triathlon D3 dim. 09/05, Cadarsac (S) sam. 12/06, demi-finale triathlon D3 sam. 03/07, Triathlon de Bordeaux (M) sam. 04/09 — à recaler dès parution.",
    "Ambès (Low Triathlon) non placé : en 2026 il avait lieu le même samedi que le format M du Triathlon de Bordeaux (5/09), objectif de fin de saison retenu.",
    'Trois courses en 15 jours fin avril-début mai (Hostens, Bègles, sélection régionale) : Hostens et Bègles en mini-affûtage, à alléger si la fatigue s\'installe.',
    'Repères : FTP 360 W (test dédié), VMA 19 km/h (estimée d\'après le 10 km de référence et la Z2 confirmée à 4:45-5:10/km), CSS 1:40/100 m, FC max 191 et zones cardio manuelles.',
    'Retour à Bordeaux la semaine du 16/11 (semaine de transition) ; créneaux club (natation mardi matin, mercredi midi, vendredi matin ; piste jeudi soir) à partir du 23/11.',
    'Cycle 3:1 dans la continuité du cycle en cours (décharge du 12 au 18/10), dimanche repos complet.',
  ],
  calendar: [
    D('2026-10-12', 'Base'),
    C('2026-10-19', 'Base', 1), C('2026-10-26', 'Base', 2), C('2026-11-02', 'Base', 3), D('2026-11-09', 'Base'),
    { weekStart: '2026-11-16', phase: 'Base', kind: 'transition', label: 'Retour à Bordeaux' },
    C('2026-11-23', 'Base', 1), C('2026-11-30', 'Base', 2), C('2026-12-07', 'Base', 3), D('2026-12-14', 'Base'),
    C('2026-12-21', 'Base', 1), C('2026-12-28', 'Base', 2), C('2027-01-04', 'Base', 3), D('2027-01-11', 'Base'),
    C('2027-01-18', 'Développement duathlon', 1), C('2027-01-25', 'Développement duathlon', 2), C('2027-02-01', 'Développement duathlon', 3), D('2027-02-08', 'Développement duathlon'),
    C('2027-02-15', 'Développement duathlon', 1), C('2027-02-22', 'Développement duathlon', 2), C('2027-03-01', 'Développement duathlon', 3), D('2027-03-08', 'Développement duathlon'),
    { weekStart: '2027-03-15', phase: 'Affûtage duathlon', kind: 'taper', label: 'Affûtage' },
    { weekStart: '2027-03-22', phase: 'Affûtage duathlon', kind: 'race', label: 'Semaine de course', race: { day: 'Dimanche', name: 'Demi-finale Duathlon D3', format: 'duathlon S', duration: '1h00' } },
    { weekStart: '2027-03-29', phase: 'Récupération', kind: 'recovery', label: 'Récupération' },
    C('2027-04-05', 'Développement triathlon', 1), C('2027-04-12', 'Développement triathlon', 2),
    { weekStart: '2027-04-19', phase: 'Développement triathlon', kind: 'raceB', base: 'charge', idx: 3, label: 'Mini-affûtage (Hostens)', race: { day: 'Dimanche', name: 'Triathlon d\'Hostens', format: 'triathlon S', duration: '1h05' } },
    { weekStart: '2027-04-26', phase: 'Développement triathlon', kind: 'raceB', base: 'decharge', label: 'Décharge + course (Bègles)', race: { day: 'Samedi', name: 'Triathlon de Bègles', format: 'triathlon S', duration: '1h05' } },
    { weekStart: '2027-05-03', phase: 'Spécifique triathlon', kind: 'race', label: 'Semaine de course', race: { day: 'Dimanche', name: 'Sélection régionale Triathlon D3', format: 'triathlon S', duration: '1h05' } },
    { weekStart: '2027-05-10', phase: 'Spécifique triathlon', kind: 'recovery', label: 'Récupération' },
    C('2027-05-17', 'Spécifique triathlon', 1), C('2027-05-24', 'Spécifique triathlon', 2), C('2027-05-31', 'Spécifique triathlon', 3),
    { weekStart: '2027-06-07', phase: 'Spécifique triathlon', kind: 'raceB', base: 'decharge', label: 'Décharge + course (Cadarsac)', race: { day: 'Samedi', name: 'Triathlon du Lac de Cadarsac', format: 'triathlon S, 750 m / 22 km / 4,8 km', duration: '1h05' } },
    C('2027-06-14', 'Spécifique triathlon', 1),
    { weekStart: '2027-06-21', phase: 'Spécifique triathlon', kind: 'taper', label: 'Affûtage' },
    { weekStart: '2027-06-28', phase: 'Spécifique triathlon', kind: 'race', label: 'Semaine de course', race: { day: 'Samedi', name: 'Demi-finale Triathlon D3', format: 'triathlon S', duration: '1h05' } },
    { weekStart: '2027-07-05', phase: 'Récupération', kind: 'recovery', label: 'Récupération' },
    C('2027-07-12', 'Spécifique été (format M)', 1), C('2027-07-19', 'Spécifique été (format M)', 2), C('2027-07-26', 'Spécifique été (format M)', 3), D('2027-08-02', 'Spécifique été (format M)'),
    C('2027-08-09', 'Spécifique été (format M)', 1), C('2027-08-16', 'Spécifique été (format M)', 2),
    { weekStart: '2027-08-23', phase: 'Spécifique été (format M)', kind: 'taper', label: 'Affûtage' },
    { weekStart: '2027-08-30', phase: 'Spécifique été (format M)', kind: 'race', label: 'Semaine de course', race: { day: 'Samedi', name: 'Triathlon de Bordeaux (M)', format: 'triathlon M', duration: '2h05' } },
  ],
};
