// lib/planSchema.js
//
// SCHÉMAS DE SORTIE imposés aux modèles (voir lib/aiClient.js : responseJsonSchema côté
// Gemini, json_schema strict côté Groq). Écrits d'emblée au format "strict" (toutes les
// propriétés requises, aucune propriété supplémentaire) pour être acceptés tels quels par
// les deux fournisseurs.
//
// Choix délibérés :
//   - `day` et `type` sont des énumérations : l'IA ne peut plus renvoyer "Course à pied",
//     "C.A.P/RUN", "Lun." ou "Mardi 12/05" — classifyDiscipline/normalizeDayName restent en
//     filet de sécurité pour les données déjà stockées.
//   - Tous les champs texte sont des chaînes : fini les objets/tableaux qui faisaient
//     planter le rendu React de WorkoutDetail ("Objects are not valid as a React child").
//   - Les semaines s'appellent `weekN` / `weekN1` dans le JSON (clés sans caractère
//     spécial), converties en `N` / `N+1` par le code.

import { DAYS_OF_WEEK } from './defaults';

export const WORKOUT_TYPES = ['NATATION', 'CYCLISME', 'C.A.P', 'ENCHAÎNEMENT', 'REPOS'];

const str = (description) => ({ type: 'string', description });

export const WORKOUT_PROPERTIES = {
  id: str('Identifiant unique de la séance (ex "n3"). Réutilise l\'id existant quand tu corriges une séance.'),
  day: { type: 'string', enum: DAYS_OF_WEEK, description: 'Jour de la semaine' },
  type: { type: 'string', enum: WORKOUT_TYPES, description: 'Discipline' },
  title: str('Titre court et précis (ex "Seuil 3x12\' vélo")'),
  duration: str('Durée totale, format "1h30" ou "45 min" ; "0 min" pour REPOS'),
  intensity: str('Cible du corps de séance : "m:ss /km" (C.A.P), "NNNW" (CYCLISME), "m:ss /100m" (NATATION), "RPE x/10" si la métrique manque, "Repos" pour REPOS'),
  effortZone: str('Zone(s) principale(s), ex "Z2" ou "Z4"'),
  cardio: str('Zone FC + bpm moyen estimé si FC connue, ex "Z2 (138 bpm)"'),
  avgBpm: str('BPM moyen estimé, ex "142 bpm", ou "-"'),
  rpe: str('Effort perçu, ex "RPE 6/10"'),
  cadence: str('Cadence cible, ex "90 rpm", "180 spm", "36 mvt/min", ou "-"'),
  restTime: str('Récupération entre répétitions, ou "-" pour une séance continue'),
  structure: str('UNE phrase courte résumant la séance (vignette du calendrier)'),
  desc: str('Feuille de séance : "Échauffement :" / "Corps de séance :" / retour au calme ; natation : dernière ligne "Total : XXXXm"'),
};

const WORKOUT_REQUIRED = Object.keys(WORKOUT_PROPERTIES);

export const WORKOUT_SCHEMA = {
  type: 'object',
  properties: WORKOUT_PROPERTIES,
  required: WORKOUT_REQUIRED,
  additionalProperties: false,
};

const weekArray = (description) => ({ type: 'array', description, items: WORKOUT_SCHEMA });

export const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    weekSummary: str('2-3 phrases pour l\'athlète : logique des deux semaines (séances clés, pourquoi cet ordre, ce qui progresse de N à N+1)'),
    trainingPlan: {
      type: 'object',
      properties: {
        title: str('Titre de l\'objectif'),
        targetTime: str('Temps visé global'),
        splits: {
          type: 'object',
          properties: { nat: str('Temps natation visé'), bike: str('Temps vélo visé'), run: str('Temps course visé') },
          required: ['nat', 'bike', 'run'],
          additionalProperties: false,
        },
        terrain: str('Profil de l\'épreuve'),
        drafting: { type: 'boolean', description: 'Aspiration-abri autorisée' },
      },
      required: ['title', 'targetTime', 'splits', 'terrain', 'drafting'],
      additionalProperties: false,
    },
    weekN: weekArray('Semaine N : toutes les entrées (séances + REPOS), chaque jour présent au moins une fois'),
    weekN1: weekArray('Semaine N+1 : idem, progression ou variation réelle par rapport à N'),
  },
  required: ['weekSummary', 'trainingPlan', 'weekN', 'weekN1'],
  additionalProperties: false,
};

export const WEEK_SCHEMA = {
  type: 'object',
  properties: {
    weekSummary: str('2-3 phrases pour l\'athlète : logique de la semaine régénérée'),
    week: weekArray('Toutes les entrées de la semaine (séances + REPOS), chaque jour présent au moins une fois'),
  },
  required: ['weekSummary', 'week'],
  additionalProperties: false,
};

const weekEnum = { type: 'string', enum: ['N', 'N+1'], description: 'Semaine concernée' };

export const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: { week: weekEnum, id: str('id de la séance concernée'), problem: str('Problème concret, une phrase') },
        required: ['week', 'id', 'problem'],
        additionalProperties: false,
      },
    },
    corrections: {
      type: 'array',
      description: 'Séances COMPLÈTES corrigées (même id pour remplacer ; nouvel id pour ajouter ; type REPOS pour transformer une séance en repos)',
      items: {
        type: 'object',
        properties: { week: weekEnum, ...WORKOUT_PROPERTIES },
        required: ['week', ...WORKOUT_REQUIRED],
        additionalProperties: false,
      },
    },
  },
  required: ['issues', 'corrections'],
  additionalProperties: false,
};

export const CHAT_SCHEMA = {
  type: 'object',
  properties: {
    reply: str('Réponse du coach à l\'athlète'),
    patches: {
      type: 'array',
      description: 'Modifications du plan (vide si aucune modification n\'est demandée ou si tu poses une question de clarification)',
      items: {
        type: 'object',
        properties: {
          week: weekEnum,
          patchMode: { type: 'string', enum: ['add', 'modify', 'remove'], description: 'add = nouvelle séance ; modify = remplace la séance targetId ; remove = supprime la séance targetId' },
          targetId: str('id de la séance existante visée (modify/remove) ; "" pour add'),
          ...WORKOUT_PROPERTIES,
        },
        required: ['week', 'patchMode', 'targetId', ...WORKOUT_REQUIRED],
        additionalProperties: false,
      },
    },
  },
  required: ['reply', 'patches'],
  additionalProperties: false,
};

export const ACTIVITY_ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['on_track', 'below_target', 'above_target', 'no_comparison'] },
    analysis: str('Analyse en texte simple, sans markdown'),
  },
  required: ['verdict', 'analysis'],
  additionalProperties: false,
};

export const ZONE_CHECK_SCHEMA = {
  type: 'object',
  properties: { plausible: { type: 'boolean' }, note: str('Une phrase courte') },
  required: ['plausible', 'note'],
  additionalProperties: false,
};

export const ROUTE_PICK_SCHEMA = {
  type: 'object',
  properties: { pickedIndex: { type: 'integer' }, strategyNote: str('1-2 phrases de stratégie') },
  required: ['pickedIndex', 'strategyNote'],
  additionalProperties: false,
};
