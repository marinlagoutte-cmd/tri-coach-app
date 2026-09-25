// Fixture : réponse IA "idéale" (cohérente, écrite comme un vrai coach) pour un profil
// type Marin (triathlon S drafting, expert, ~18h/sem, 12 séances, repos dimanche).
// Sert de référence : un pipeline sain doit la laisser quasi intacte.
const swim = (id, day, title, duration, total, body, extra = {}) => ({
  id, day, type: 'NATATION', title, duration, intensity: '1:34 /100m', effortZone: 'Z2', cardio: 'Z2',
  rpe: 'RPE 6/10', cadence: '38 mvt/min', restTime: "15-20''",
  structure: `Échauffement 600m, corps de séance ${title.toLowerCase()}, retour au calme 200m (${total}m).`,
  desc: `Échauffement :\n400 NC souple Z1\n4*50 educ R : 15''\nCorps de séance :\n${body}\n---\n200 souple\nTotal : ${total}m`,
  modified: false, ...extra,
});
export const WEEK_N = [
  swim('n1', 'Lundi', 'Vitesse départ groupé', '1h00', 3000, "8*50 à fond départ dans l'eau Z5 R : 30''\n6*100 PLAQ Z4 R : 20''\n4*200 all SPRINT R : 30''\n4*100 PULL Z2 R : 15''", { effortZone: 'Z2-Z5', intensity: '1:28 /100m' }),
  { id: 'n2', day: 'Lundi', type: 'CYCLISME', title: 'Force basse cadence', duration: '1h30', intensity: '300W', cadence: '60-65 rpm', cardio: 'Z3 (150 bpm)', effortZone: 'Z3', rpe: 'RPE 6/10', restTime: "4' souple", structure: 'Échauffement 20min, 5 blocs force basse cadence, retour au calme 15min.', desc: "Échauffement :\n20' progressif Z1-Z2\nCorps de séance :\n5*(8' @300W 60-65rpm - 4' souple)\n15' souple Z1", modified: false },
  { id: 'n3', day: 'Mardi', type: 'C.A.P', title: 'Côtes courtes', duration: '1h05', intensity: '3:05 /km', cadence: '185 spm', cardio: 'Z5', effortZone: 'Z5', avgBpm: '165 bpm', rpe: 'RPE 8/10', restTime: 'Descente trot', structure: 'Échauffement 20min, 10 côtes de 45s, retour au calme 15min.', desc: "Échauffement :\n20' footing Z2 + 3 lignes droites\nCorps de séance :\n10*(45'' côte @VMA - descente trot)\n15' souple", modified: false },
  swim('n4', 'Mardi', 'Endurance aérobie', '55 min', 2800, "3*400 PULL Z2 R : 20''\n8*50 educ + NC R : 15''"),
  { id: 'n5', day: 'Mercredi', type: 'CYCLISME', title: 'Seuil 3x15', duration: '1h45', intensity: '345W', cadence: '90 rpm', cardio: 'Z4 (168 bpm)', effortZone: 'Z4', rpe: 'RPE 8/10', restTime: "5' souple", structure: 'Échauffement 20min, 3x15min au seuil, retour au calme 15min.', desc: "Échauffement :\n20' progressif + 3*1' vélocité\nCorps de séance :\n3*(15' @345W - 5' souple 180W)\n15' souple", modified: false },
  { id: 'n6', day: 'Jeudi', type: 'C.A.P', title: 'Footing endurance fondamentale', duration: '1h00', intensity: '4:55 /km', cadence: '178 spm', cardio: 'Z2 (138 bpm)', effortZone: 'Z2', avgBpm: '138 bpm', rpe: 'RPE 4/10', restTime: '-', structure: 'Footing continu Z2 1h.', desc: "Échauffement :\n10' très souple\nCorps de séance :\n45' continu Z2 (4:50-5:05 /km)\n5' marche/retour au calme", modified: false },
  swim('n7', 'Jeudi', 'Seuil CSS', '1h00', 3200, "10*100 Z4/CSS R : 10''\n2*400 PULL Z3 R : 30''\n4*50 palmes vitesse Z5 R : 30''", { effortZone: 'Z4', intensity: '1:30 /100m' }),
  { id: 'n8', day: 'Vendredi', type: 'CYCLISME', title: 'Endurance Z2', duration: '1h30', intensity: '240W', cadence: '90 rpm', cardio: 'Z2 (135 bpm)', effortZone: 'Z2', rpe: 'RPE 4/10', restTime: '-', structure: 'Sortie continue Z2 1h30.', desc: "Échauffement :\n15' progressif\nCorps de séance :\n1h10 continu @240W Z2\n5' souple", modified: false },
  { id: 'n9', day: 'Vendredi', type: 'C.A.P', title: 'Tempo court', duration: '50 min', intensity: '3:50 /km', cadence: '182 spm', cardio: 'Z3 (158 bpm)', effortZone: 'Z3', avgBpm: '158 bpm', rpe: 'RPE 6/10', restTime: "90'' trot", structure: 'Échauffement 15min, 4x6min tempo, retour au calme 10min.', desc: "Échauffement :\n15' footing Z2\nCorps de séance :\n4*(6' @3:50/km - 90'' trot)\n10' souple", modified: false },
  { id: 'n10', day: 'Samedi', type: 'CYCLISME', title: 'Sortie longue groupe', duration: '4h00', intensity: '250W', cadence: '88 rpm', cardio: 'Z2 (140 bpm)', effortZone: 'Z2', rpe: 'RPE 5/10', restTime: '-', structure: 'Sortie longue Z2 avec 4 relais appuyés.', desc: "Échauffement :\n20' progressif\nCorps de séance :\n3h30 continu Z2 @250W dont 4*(3' @380W relais - 10' Z2)\n10' souple", modified: false },
  { id: 'n11', day: 'Samedi', type: 'C.A.P', title: 'Course enchaînée', duration: '30 min', intensity: '4:05 /km', cadence: '182 spm', cardio: 'Z3 (155 bpm)', effortZone: 'Z3', avgBpm: '155 bpm', rpe: 'RPE 6/10', restTime: '-', structure: 'Transition rapide puis 30min allure course.', desc: "Échauffement :\nT2 rapide (<1')\nCorps de séance :\n20' @4:05/km puis 8' Z2\n2' marche", modified: false },
  swim('n12', 'Mercredi', 'Récupération technique', '40 min', 2000, "8*50 educ R : 15''\n4*150 PULL Z1 R : 20''", { effortZone: 'Z1-Z2', intensity: '1:45 /100m' }),
  { id: 'n13', day: 'Dimanche', type: 'REPOS', title: 'Repos complet', duration: '0 min', desc: 'Repos complet, priorité sommeil.', modified: false },
];
// N+1 = même structure, progression sur le seuil vélo (3x15 → 3x18) et les côtes (10 → 12)
export const WEEK_N1 = WEEK_N.map((w) => {
  const m = { ...w, id: w.id.replace('n', 'm') };
  if (w.id === 'n5') return { ...m, title: 'Seuil 3x18', duration: '1h55', desc: "Échauffement :\n20' progressif + 3*1' vélocité\nCorps de séance :\n3*(18' @345W - 5' souple 180W)\n15' souple", structure: 'Échauffement 20min, 3x18min au seuil, retour au calme 15min.' };
  if (w.id === 'n3') return { ...m, title: 'Côtes courtes x12', duration: '1h10', desc: "Échauffement :\n20' footing Z2 + 3 lignes droites\nCorps de séance :\n12*(45'' côte @VMA - descente trot)\n15' souple" };
  return m;
});
export const PLAN_RESPONSE = {
  weekSummary: 'Trois séances clés par semaine (côtes mardi, seuil vélo mercredi, tempo vendredi), le reste en endurance ; N+1 allonge le seuil et ajoute deux côtes.',
  trainingPlan: { title: 'Triathlon S D3', date: '2027-06-20', startDate: '2026-09-28', targetTime: '1h00', splits: { nat: '11 min', bike: '30 min', run: '17 min' }, terrain: 'plat', drafting: true, cycles: [] },
  workouts: { N: WEEK_N, 'N+1': WEEK_N1 },
};
export const MARIN_WIZARD = {
  firstName: 'Marin', gender: 'homme', weight: 89, fitnessLevel: 5, trainingExperience: 'expert', hasExistingTrainingBase: true,
  sportType: 'triathlon', triathlonFormat: 'S', customDistances: { swim: 0.75, bike: 20, run: 5 },
  triathlonTimes: { swim: '', transition_t1: '', bike: '', transition_t2: '', run: '', total: '' },
  targetDate: '2027-06-20', hoursPerWeek: 18, maxSessionsPerWeek: 12, offDays: 'Dimanche', ppgEnabled: false,
  knownPhysio: { vma: '20', ftp: '360', css: '1:30', fcMax: '191', fcRepos: '45' }, recentResult: { distanceKm: '', time: '', context: '' },
};
export const MARIN_PROFILE = { firstName: 'Marin', vma: 20, ftp: 360, nat100: '1:30', weight: 89, fcMax: 191, fcRepos: 45, gender: 'M' };
