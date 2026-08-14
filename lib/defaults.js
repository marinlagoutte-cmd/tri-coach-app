export const DAYS_OF_WEEK = [
  'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche',
];

export const DEFAULT_PROFILE = {
  name: 'Marin',
  gender: 'homme',
  vma: 20,
  ftp: 350,
  weight: 87,
  nat100: '1:38',
  fcMax: 192,
  fcRest: 48,
};

export const DEFAULT_TRAINING_PLAN = {
  title: 'Triathlon L - Deauville',
  date: '2026-09-15',
  startDate: '2026-06-01',
  targetTime: '4h45',
  splits: { nat: '0h38', bike: '2h25', run: '1h30' },
  terrain: 'Vallonné',
  drafting: false,
  cycles: [
    { id: 1, name: 'Cycle 1 - Base Aérobie & Technique', dates: 'Juin - Juillet', status: 'Terminé' },
    { id: 2, name: 'Cycle 2 - Développement Puissance & VMA', dates: 'Août - Septembre', status: 'En cours' },
    { id: 3, name: 'Cycle 3 - Spécifique & Affûtage Race', dates: 'Octobre - Course', status: 'À venir' },
  ],
};

export const DEFAULT_WORKOUTS = {
  N: [
    { id: 'w1', day: 'Lundi', type: 'NATATION', title: 'Aérobie & Technique CSS', duration: '45 min', intensity: '1:38 /100m', cadence: '34 mvt/min', cardio: 'Z2 (135-145 bpm)', rpe: 'RPE 6/10', modified: false, desc: '10x100m Dépassement CSS, récupération 15s.' },
    { id: 'w2', day: 'Mardi', type: 'CYCLISME', title: 'PMA Courte (30/30)', duration: '1h15', intensity: '385W (110% FTP)', cadence: '95-105 rpm', cardio: 'Z4-Z5 (>170 bpm)', rpe: 'RPE 8.5/10', modified: false, desc: '2 blocs de 10x (30s à 385W / 30s V2 active).' },
    { id: 'w3', day: 'Mercredi', type: 'REPOS', title: 'Récupération Active & Mobilité', duration: '30 min', intensity: 'Récupération', cadence: '-', cardio: '< 60 bpm', rpe: 'RPE 1/10', modified: false, desc: 'Pistolet de massage, étirements chaînes postérieures.' },
    { id: 'w4', day: 'Jeudi', type: 'C.A.P', title: 'Seuil Inversé / Intervalles', duration: '50 min', intensity: '3:45/km (16 km/h)', cadence: '180 spm', cardio: 'Z4 (168-175 bpm)', rpe: 'RPE 7.5/10', modified: false, desc: '3x2000m Allure Seuil avec 2min de recup active en trot.' },
    { id: 'w5', day: 'Vendredi', type: 'NATATION', title: 'Intensité & Repères Allure', duration: '50 min', intensity: '1:32 /100m', cadence: '36 mvt/min', cardio: 'Z3-Z4', rpe: 'RPE 8/10', modified: false, desc: 'Corps de séance : 400m / 300m / 200m / 100m crescendo.' },
    { id: 'w6', day: 'Samedi', type: 'CYCLISME', title: 'Sortie Longue Spécifique Race', duration: '2h30', intensity: '265W (75% FTP)', cadence: '88 rpm', cardio: 'Z2-Z3 (145-155 bpm)', rpe: 'RPE 6.5/10', modified: false, desc: 'Inclut 3 blocs de 15min intégrés à allure cible 280W.' },
    { id: 'w7', day: 'Dimanche', type: 'ENCHAÎNEMENT', title: 'Brick Vélo + CAP', duration: '1h30', intensity: '260W / 4:10/km', cadence: '90 rpm / 178 spm', cardio: 'Z3 (155-165 bpm)', rpe: 'RPE 8/10', modified: false, desc: '1h15 Vélo dynamique direct suivi de 15min CAP rapide transition T2.' },
  ],
  'N+1': [
    { id: 'w8', day: 'Lundi', type: 'NATATION', title: 'Vitesse & Fréquence de bras', duration: '40 min', intensity: '1:28 /100m', cadence: '38 mvt/min', cardio: 'Z4', rpe: 'RPE 7.5/10', modified: false, desc: "Focus éducatifs et prises d'appui." },
    { id: 'w9', day: 'Mardi', type: 'CYCLISME', title: 'Tempo Sweetspot', duration: '1h30', intensity: '310W (88% FTP)', cadence: '85 rpm', cardio: 'Z3-Z4 (160 bpm)', rpe: 'RPE 7/10', modified: false, desc: '3x15min Sweetspot avec 5min de récupération.' },
    { id: 'w10', day: 'Mercredi', type: 'REPOS', title: 'Repos complet', duration: '30 min', intensity: 'Récupération', cadence: '-', cardio: '< 55 bpm', rpe: 'RPE 1/10', modified: false, desc: 'Sommeil prioritaire & hydratation.' },
    { id: 'w11', day: 'Jeudi', type: 'C.A.P', title: 'VMA Courte sur Piste', duration: '45 min', intensity: '3:00/km (20 km/h)', cadence: '185 spm', cardio: 'Z5 (>178 bpm)', rpe: 'RPE 9/10', modified: false, desc: '12x400m à 100% VMA, recup 1min trot.' },
    { id: 'w12', day: 'Vendredi', type: 'NATATION', title: 'Endurance Pull/Plaquettes', duration: '1h00', intensity: '1:40 /100m', cadence: '32 mvt/min', cardio: 'Z2', rpe: 'RPE 5.5/10', modified: false, desc: '2000m continu travail de force et gainage.' },
    { id: 'w13', day: 'Samedi', type: 'CYCLISME', title: 'Over-Under Sur/Sous Seuil', duration: '2h00', intensity: '370W / 280W', cadence: '92 rpm', cardio: 'Z4', rpe: 'RPE 8.5/10', modified: false, desc: '4x (2min @ 370W / 3min @ 280W).' },
    { id: 'w14', day: 'Dimanche', type: 'C.A.P', title: 'Sortie Longue Vallonnée', duration: '1h20', intensity: '4:15/km', cadence: '176 spm', cardio: 'Z2-Z3', rpe: 'RPE 7/10', modified: false, desc: 'Travail musculaire en côte et foulée rase.' },
  ],
};

// Forme "riche" du questionnaire, alignée avec WizardModal.jsx
export const DEFAULT_WIZARD_DATA = {
  eventName: '',
  gender: 'homme',
  weight: '',
  fitnessLevel: 3,
  sportType: 'triathlon', // 'running' | 'triathlon'

  runningSubtype: 'road', // 'road' | 'trail'
  distance: '10km',
  trailKm: '',
  trailElevation: '',

  triathlonFormat: 'M',
  customDistances: { swim: 1.5, bike: 40, run: 10 },

  targetTime: '',
  triathlonTimes: { swim: '', transition: '', bike: '', total: '' },

  targetDate: '2026-09-15',
  hoursPerWeek: 8,
  maxSessionsPerWeek: 5,
  offDays: 'Mercredi',
};  'N+1': [
    { id: 'w8', day: 'Lundi', type: 'NATATION', title: 'Vitesse & Fréquence de bras', duration: '40 min', intensity: '1:28 /100m', cadence: '38 mvt/min', cardio: 'Z4', rpe: 'RPE 7.5/10', modified: false, desc: 'Focus éducatifs et prises d\'appui.' },
    { id: 'w9', day: 'Mardi', type: 'CYCLISME', title: 'Tempo Sweetspot', duration: '1h30', intensity: '310W (88% FTP)', cadence: '85 rpm', cardio: 'Z3-Z4 (160 bpm)', rpe: 'RPE 7/10', modified: false, desc: '3x15min Sweetspot avec 5min de récupération.' },
    { id: 'w10', day: 'Mercredi', type: 'REPOS', title: 'Repos complet', duration: '30 min', intensity: 'Récupération', cadence: '-', cardio: '< 55 bpm', rpe: 'RPE 1/10', modified: false, desc: 'Sommeil prioritaire & hydratation.' },
    { id: 'w11', day: 'Jeudi', type: 'C.A.P', title: 'VMA Courte sur Piste', duration: '45 min', intensity: '3:00/km (20 km/h)', cadence: '185 spm', cardio: 'Z5 (>178 bpm)', rpe: 'RPE 9/10', modified: false, desc: '12x400m à 100% VMA, recup 1min trot.' },
    { id: 'w12', day: 'Vendredi', type: 'NATATION', title: 'Endurance Pull/Plaquettes', duration: '1h00', intensity: '1:40 /100m', cadence: '32 mvt/min', cardio: 'Z2', rpe: 'RPE 5.5/10', modified: false, desc: '2000m continu travail de force et gainage.' },
    { id: 'w13', day: 'Samedi', type: 'CYCLISME', title: 'Over-Under Sur/Sous Seuil', duration: '2h00', intensity: '370W / 280W', cadence: '92 rpm', cardio: 'Z4', rpe: 'RPE 8.5/10', modified: false, desc: '4x (2min @ 370W / 3min @ 280W).' },
    { id: 'w14', day: 'Dimanche', type: 'C.A.P', title: 'Sortie Longue Vallonnée', duration: '1h20', intensity: '4:15/km', cadence: '176 spm', cardio: 'Z2-Z3', rpe: 'RPE 7/10', modified: false, desc: 'Travail musculaire en côte et foulée rase.' },
  ],
};
export const DEFAULT_WIZARD_DATA = {
  eventName: 'Triathlon L - Deauville',
  sports: ['NAT', 'VELO', 'CAP'],
  targetDate: '2026-09-15',
  hoursPerWeek: 11,
  offDays: 'Mercredi',
  targetGoal: 'Sous les 4h45',
};
