// lib/defaults.js

export const DAYS_OF_WEEK = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

export const DEFAULT_PROFILE = {
  firstName: '',
  // Aucune valeur inventée par défaut : tant que l'athlète ne l'a pas renseignée
  // (au questionnaire, dans cet onglet, ou via un chrono récent), le champ reste
  // vide plutôt que d'afficher un chiffre plausible mais faux (voir lib/physiology.js).
  vma: null,
  ftp: null,
  nat100: null,
  weight: 70,
  fcMax: null,
  fcRepos: null,
  vfc: null, // HRV en ms, mesure au réveil
  gender: 'M',
};

export const DEFAULT_TRAINING_PLAN = {
  title: 'Triathlon L - Deauville',
  // Format ISO (YYYY-MM-DD) obligatoire : c'est ce que `new Date()` sait parser de façon
  // fiable dans tous les navigateurs, et c'est le même format que celui demandé à l'IA
  // (voir lib/gemini.js). Un format texte ("15 Juin 2026") casse silencieusement le
  // compte à rebours de l'onglet Objectif (Date invalide -> NaN -> 0 jours restants).
  date: '2026-06-15',
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

// État "aucun plan" — utilisé quand l'athlète supprime son plan sans en
// recréer un autre : garde une forme valide (splits/cycles présents mais
// vides) pour que l'UI ne crashe pas, sans jamais afficher un faux objectif.
export const EMPTY_TRAINING_PLAN = {
  title: '',
  date: '',
  startDate: '',
  targetTime: '',
  splits: { nat: '—', bike: '—', run: '—' },
  cycles: [],
};

export const EMPTY_WORKOUTS = { N: [], 'N+1': [] };

export const DEFAULT_WIZARD_DATA = {
  targetDate: '2026-06-15',
  goalType: 'Triathlon L',
  hoursPerWeek: 8,
  maxSessionsPerWeek: 5,
  offDays: 'Mercredi',
};

export const DEFAULT_WORKOUTS = {
  N: [
    { id: 'w1', day: 'Lundi', type: 'NATATION', title: 'Endurance & Technique', duration: '45 min', intensity: '1:35 /100m', cadence: '35 mvt/min', cardio: 'Z2', rpe: 'RPE 5/10', modified: false, desc: 'Échauffement puis séries de 100m.', structure: "Échauffement 200m souple + 6x100m technique (retour au calme entre les longueurs) + 200m retour au calme." },
    { id: 'w2', day: 'Mardi', type: 'C.A.P', title: 'Seuil 85% VMA', duration: '50 min', intensity: '4:17 /km (75% VMA)', cadence: '180 spm', cardio: 'Z3-Z4', rpe: 'RPE 7/10', modified: false, desc: '3x 6min au seuil.', structure: "Échauffement 15min Z1-Z2 + 3x6min au seuil (récup. trot 2min entre chaque) + retour au calme 10min." },
    { id: 'w3', day: 'Mercredi', type: 'REPOS', title: 'Repos complet', duration: '0 min', intensity: 'Récupération', cadence: '-', cardio: '< 55 bpm', rpe: 'RPE 1/10', modified: false, desc: 'Repos total.', structure: "Repos total : sommeil, hydratation, mobilité légère si besoin." },
    { id: 'w4', day: 'Jeudi', type: 'CYCLISME', title: 'Force & Puissance', duration: '1h30', intensity: '210W (75% FTP)', cadence: '85 rpm', cardio: 'Z3', rpe: 'RPE 6/10', modified: false, desc: 'Travail en force sous cadence.', structure: "Échauffement 15min souple + blocs de force en côte à cadence <70rpm + retour au calme 15min." },
    { id: 'w5', day: 'Vendredi', type: 'NATATION', title: 'Pagaie & Allure', duration: '50 min', intensity: '1:35 /100m', cadence: '36 mvt/min', cardio: 'Z3', rpe: 'RPE 6/10', modified: false, desc: 'Séries allure spécifique.', structure: "Échauffement 300m + série allure spécifique 8x100m (repos 20s) + retour au calme 200m." },
    { id: 'w6', day: 'Samedi', type: 'CYCLISME', title: 'Sortie longue endurance', duration: '2h30', intensity: '190W (75% FTP)', cadence: '90 rpm', cardio: 'Z2', rpe: 'RPE 5/10', modified: false, desc: 'Sortie longue en zone 2.', structure: "Sortie longue continue en Z2, ravitaillement toutes les 45min." },
    { id: 'w7', day: 'Dimanche', type: 'C.A.P', title: 'Sortie longue', duration: '1h15', intensity: '5:00 /km (75% VMA)', cadence: '175 spm', cardio: 'Z2', rpe: 'RPE 5/10', modified: false, desc: 'Footing long progressif.', structure: "Footing long progressif, allure Z2 stable, hydratation régulière." },
  ],
  'N+1': [
    { id: 'w8', day: 'Lundi', type: 'NATATION', title: 'Vitesse & Fréquence de bras', duration: '40 min', intensity: '1:28 /100m', cadence: '38 mvt/min', cardio: 'Z4', rpe: 'RPE 7.5/10', modified: false, desc: "Focus éducatifs et prises d'appui.", structure: "Échauffement 300m + éducatifs bras/jambes + 10x50m vitesse (repos 30s) + retour au calme 200m." },
    { id: 'w9', day: 'Mardi', type: 'CYCLISME', title: 'Tempo Sweetspot', duration: '1h30', intensity: '310W (88% FTP)', cadence: '85 rpm', cardio: 'Z3-Z4 (160 bpm)', rpe: 'RPE 7/10', modified: false, desc: '3x15min Sweetspot avec 5min de récupération.', structure: "Échauffement 15min + 3x15min Sweetspot (récup. souple 5min entre les blocs) + retour au calme 10min." },
    { id: 'w10', day: 'Mercredi', type: 'REPOS', title: 'Repos complet', duration: '30 min', intensity: 'Récupération', cadence: '-', cardio: '< 55 bpm', rpe: 'RPE 1/10', modified: false, desc: 'Sommeil prioritaire & hydratation.', structure: "Repos actif léger : mobilité, étirements, sommeil prioritaire." },
    { id: 'w11', day: 'Jeudi', type: 'C.A.P', title: 'VMA Courte', duration: '45 min', intensity: '4:00 /km', cadence: '185 spm', cardio: 'Z5', rpe: 'RPE 8.5/10', modified: false, desc: '10x 30/30.', structure: "Échauffement 15min progressif + 10x30/30 à VMA (récup. trot 30s) + retour au calme 10min." },
    { id: 'w12', day: 'Vendredi', type: 'NATATION', title: 'Endurance active', duration: '45 min', intensity: '1:35 /100m', cadence: '35 mvt/min', cardio: 'Z2-Z3', rpe: 'RPE 5/10', modified: false, desc: 'Nage continue.', structure: "Nage continue Z2-Z3, focus technique et respiration bilatérale." },
    { id: 'w13', day: 'Samedi', type: 'CYCLISME', title: 'Sortie spécifique', duration: '3h00', intensity: '210W', cadence: '90 rpm', cardio: 'Z3', rpe: 'RPE 6/10', modified: false, desc: 'Enchaînement blocs allure course.', structure: "Sortie spécifique avec blocs allure course, gestion du ravitaillement." },
    { id: 'w14', day: 'Dimanche', type: 'C.A.P', title: 'Footing & Brick', duration: '1h20', intensity: '4:48 /km', cadence: '178 spm', cardio: 'Z2', rpe: 'RPE 5/10', modified: false, desc: 'Suivi de 15 min de home trainer.', structure: "Footing 1h05 Z2 enchaîné avec 15min de home trainer en Z2 (transition rapide, brick)." },
  ]
};
