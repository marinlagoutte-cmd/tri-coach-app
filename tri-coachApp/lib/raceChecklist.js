// lib/raceChecklist.js
//
// Données de l'outil « Transitions » (components/TransitionTrainer.js) : checklist de course
// par catégories, routines T1/T2, rappels du règlement, migration de l'ancienne liste.
// Voir l'en-tête du composant pour les sources des rappels du règlement (FFTri).

export const CHECKLIST_CATEGORIES = [
  {
    id: 'admin', label: 'Papiers', sports: ['triathlon', 'duathlon', 'running'],
    items: [
      'Licence FFTri ou Pass Compétition',
      "Pièce d'identité (demandée au retrait du dossard)",
      "Confirmation d'inscription",
    ],
  },
  {
    id: 'tenue', label: 'Tenue', sports: ['triathlon', 'duathlon', 'running'],
    items: [
      'Trifonction (tenue du club obligatoire en championnat des clubs)',
      'Chaussettes (facultatives en format court, utiles en long contre les ampoules)',
      'Coupe-vent ou manchettes selon la météo',
      'Casquette ou visière pour la course',
      "Tenue chaude et sèche pour l'après-course",
    ],
  },
  {
    id: 'natation', label: 'Natation', sports: ['triathlon'],
    items: [
      'Combinaison néoprène (selon la température annoncée le jour J)',
      "Bonnet de l'organisation",
      'Lunettes de natation + une paire de rechange',
      'Crème anti-frottements (cou, aisselles)',
      'Tongs pour rejoindre le départ',
    ],
  },
  {
    id: 'velo', label: 'Vélo', sports: ['triathlon', 'duathlon'],
    items: [
      'Vélo vérifié : freins, vitesses, pneus gonflés',
      'Casque (numéro collé, jugulaire réglée)',
      'Chaussures vélo (élastiques si départ chaussures clipsées)',
      'Lunettes de vélo',
      'Bidon(s) remplis',
      'Kit de réparation : chambre à air, démonte-pneus, CO2 ou pompe',
      "Numéros de l'organisation collés (tige de selle, cadre)",
    ],
  },
  {
    id: 'course', label: 'Course à pied', sports: ['triathlon', 'duathlon', 'running'],
    items: [
      'Chaussures de course (lacets élastiques ou rapides)',
      'Ceinture porte-dossard',
    ],
  },
  {
    id: 'divers', label: 'Nutrition et divers', sports: ['triathlon', 'duathlon', 'running'],
    items: [
      "Gels, barres, boisson d'effort",
      'Puce de chronométrage',
      'Montre / compteur chargés',
      'Crème solaire',
      'Petite serviette pour la zone de transition (si autorisée)',
      'Pompe à pied pour le gonflage avant le départ',
      'Sac pour la combinaison mouillée et les affaires sales',
    ],
  },
];

// Ancienne liste à plat (avant catégories) : tout élément absent de cette liste était un ajout
// personnel, conservé dans « Mes ajouts » lors de la migration.
export const LEGACY_DEFAULTS = [
  'Dossard sur porte-dossard 3 points', 'Puce de chronométrage', "Licence / pièce d'identité",
  'Casque (numéro collé, jugulaire réglée)', 'Bonnet + lunettes de natation', 'Combinaison (si autorisée)',
  'Chaussures vélo (élastiques si départ pieds dessus)', 'Lunettes de vélo', 'Chaussures de course (lacets rapides)',
  'Bidon + gels', 'Plaque de cadre / sticker tige de selle',
];

export const ROUTINES = {
  T1: [
    'Bonnet et lunettes retirés en courant vers le parc',
    'Combinaison retirée (si portée)',
    'Casque sur la tête, jugulaire ATTACHÉE',
    'Lunettes de vélo',
    'Porte-dossard : dossard DANS LE DOS (si exigé à vélo)',
    'Décrocher le vélo, sortir à pied vélo à la main',
    'Monter APRÈS la ligne de montée',
  ],
  T2: [
    'Descendre AVANT la ligne de descente',
    'Raccrocher le vélo à ton emplacement',
    'Détacher le casque SEULEMENT maintenant',
    'Chaussures de course',
    'Dossard tourné DEVANT',
    'Sortir du parc en courant',
  ],
};

export const RULES = [
  "Même tenue du départ à l'arrivée (hors distances L et plus) ; torse couvert à vélo et en course.",
  "Combinaison néoprène : obligatoire sous 16 °C, autorisée jusqu'à 24,5 °C, interdite au-delà. Si elle est interdite, tenue 100 % textile.",
  'En natation, mains et pieds ne doivent pas être couverts.',
  'Dossard dans le dos à vélo, devant en course à pied.',
  'Casque attaché avant de toucher le vélo, détaché seulement une fois le vélo raccroché. Circulation à pied dans le parc.',
  'Écouteurs et appareils audio interdits.',
];

export function migrateChecklistState(raw) {
  if (raw?.version === 2) return { custom: raw.custom || [], hidden: raw.hidden || [], checked: raw.checked || [] };
  if (raw && Array.isArray(raw.items)) {
    return { custom: raw.items.filter((i) => !LEGACY_DEFAULTS.includes(i)), hidden: [], checked: raw.checked || [] };
  }
  return { custom: [], hidden: [], checked: [] };
}
