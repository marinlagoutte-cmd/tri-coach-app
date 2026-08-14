// lib/defaults.js

export const DEFAULT_PROFILE = {
  vma: 16.5,
  ftp: 280,
  nat100: '1:35',
  weight: 70,
  fcMax: 190,
  gender: 'M',
};

export const DEFAULT_TRAINING_PLAN = {
  title: 'Triathlon L - Deauville',
  date: '15 Juin 2026',
  startDate: '2026-05-01',
  targetTime: '4h45',
  splits: {
    nat: '32 min',
    bike: '2h35',
    run: '1h30',
  },
  cycles: [
    { id: 'c1', name: 'Développement foncier', dates: 'Mai - Sem 1 à 4', status: 'En cours' },
    { id: 'c2', name: 'Intensité & Seuil', dates: 'Juin - Sem 5 à 8', status: 'À venir' },
  ],
};

export const DEFAULT_WIZARD_DATA = {
  targetDate: '2026-06-15',
  goalType: 'Triathlon L',
  hoursPerWeek: 8,
  maxSessionsPerWeek: 5,
  offDays: 'Mercredi',
};

export const DEFAULT_WORKOUTS = {
  N: [
    { id: 'w1', day: 'Lundi', type: 'NATATION', title: 'Endurance & Technique', duration: '45 min', intensity: '1:35 /100m', cadence: '35 mvt/min', cardio: 'Z2', rpe: 'RPE 5/10', modified: false, desc: 'Échauffement puis séries de 100m.' },
    { id: 'w2', day: 'Mardi', type: 'C.A.P', title: 'Seuil 85% VMA', duration: '50 min', intensity: '14.0 km/h (75% VMA)', cadence: '180 spm', cardio: 'Z3-Z4', rpe: 'RPE 7/10', modified: false, desc: '3x 6min au seuil.' },
    { id: 'w3', day: 'Mercredi', type: 'REPOS', title: 'Repos complet', duration: '0 min', intensity: 'Récupération', cadence: '-', cardio: '< 55 bpm', rpe: 'RPE 1/10', modified: false, desc: 'Repos total.' },
    { id: 'w4', day: 'Jeudi', type: 'CYCLISME', title: 'Force & Puissance', duration: '1h30', intensity: '210W (75% FTP)', cadence: '85 rpm', cardio: 'Z3', rpe: 'RPE 6/10', modified: false, desc: 'Travail en force sous cadence.' },
    { id: 'w5', day: 'Vendredi', type: 'NATATION', title: 'Pagaie & Allure', duration: '50 min', intensity: '1:35 /100m', cadence: '36 mvt/min', cardio: 'Z3', rpe: 'RPE 6/10', modified: false, desc: 'Séries allure spécifique.' },
    { id: 'w6', day: 'Samedi', type: 'CYCLISME', title: 'Sortie longue endurance', duration: '2h30', intensity: '190W (75% FTP)', cadence: '90 rpm', cardio: 'Z2', rpe: 'RPE 5/10', modified: false, desc: 'Sortie longue en zone 2.' },
    { id: 'w7', day: 'Dimanche', type: 'C.A.P', title: 'Sortie longue', duration: '1h15', intensity: '12.0 km/h (75% VMA)', cadence: '175 spm', cardio: 'Z2', rpe: 'RPE 5/10', modified: false, desc: 'Footing long progressif.' },
  ],
  'N+1': [
    { id: 'w8', day: 'Lundi', type: 'NATATION', title: 'Vitesse & Fréquence de bras', duration: '40 min', intensity: '1:28 /100m', cadence: '38 mvt/min', cardio: 'Z4', rpe: 'RPE 7.5/10', modified: false, desc: "Focus éducatifs et prises d'appui." },
    { id: 'w9', day: 'Mardi', type: 'CYCLISME', title: 'Tempo Sweetspot', duration: '1h30', intensity: '310W (88% FTP)', cadence: '85 rpm', cardio: 'Z3-Z4 (160 bpm)', rpe: 'RPE 7/10', modified: false, desc: '3x15min Sweetspot avec 5min de récupération.' },
    { id: 'w10', day: 'Mercredi', type: 'REPOS', title: 'Repos complet', duration: '30 min', intensity: 'Récupération', cadence: '-', cardio: '< 55 bpm', rpe: 'RPE 1/10', modified: false, desc: 'Sommeil prioritaire & hydratation.' },
    { id: 'w11', day: 'Jeudi', type: 'C.A.P', title: 'VMA Courte', duration: '45 min', intensity: '15.0 km/h', cadence: '185 spm', cardio: 'Z5', rpe: 'RPE 8.5/10', modified: false, desc: '10x 30/30.' },
    { id: 'w12', day: 'Vendredi', type: 'NATATION', title: 'Endurance active', duration: '45 min', intensity: '1:35 /100m', cadence: '35 mvt/min', cardio: 'Z2-Z3', rpe: 'RPE 5/10', modified: false, desc: 'Nage continue.' },
    { id: 'w13', day: 'Samedi', type: 'CYCLISME', title: 'Sortie spécifique', duration: '3h00', intensity: '210W', cadence: '90 rpm', cardio: 'Z3', rpe: 'RPE 6/10', modified: false, desc: 'Enchaînement blocs allure course.' },
    { id: 'w14', day: 'Dimanche', type: 'C.A.P', title: 'Footing & Brick', duration: '1h20', intensity: '12.5 km/h', cadence: '178 spm', cardio: 'Z2', rpe: 'RPE 5/10', modified: false, desc: 'Suivi de 15 min de home trainer.' },
  ]
};
