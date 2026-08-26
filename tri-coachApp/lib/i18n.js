// lib/i18n.js
//
// Système de traduction de l'interface (fr / en / es). Principe important :
// SEUL L'AFFICHAGE est traduit — les valeurs internes (jour 'Lundi' stocké dans une
// séance, type 'NATATION', clés de stockage...) ne changent JAMAIS, pour ne jamais
// casser la logique (comparaison de jours, filtres, sauvegarde). On traduit donc
// uniquement au moment du rendu, via t() ou les petits helpers ci-dessous
// (translateDayName, translateFieldLabel, translateWorkoutType).
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { STORAGE_KEYS, loadFromStorage, saveToStorage } from './storage';

export const SUPPORTED_LANGS = [
  { code: 'fr', label: 'Français', flag: '🇫🇷' },
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
];

export const AI_LANGUAGE_NAME = { fr: 'French', en: 'English', es: 'Spanish' };

const DICT = {
  common: {
    fr: { cancel: 'Annuler', close: 'Fermer', save: 'Enregistrer', send: 'Envoyer', add: 'Ajouter', back: 'Retour', next: 'Suivant', loading: 'Chargement…', delete: 'Supprimer', confirm: 'Confirmer', notSet: 'Non renseigné' },
    en: { cancel: 'Cancel', close: 'Close', save: 'Save', send: 'Send', add: 'Add', back: 'Back', next: 'Next', loading: 'Loading…', delete: 'Delete', confirm: 'Confirm', notSet: 'Not set' },
    es: { cancel: 'Cancelar', close: 'Cerrar', save: 'Guardar', send: 'Enviar', add: 'Añadir', back: 'Atrás', next: 'Siguiente', loading: 'Cargando…', delete: 'Eliminar', confirm: 'Confirmar', notSet: 'No indicado' },
  },
  header: {
    fr: { newPlan: 'Nouveau', newPlanFull: 'Nouveau Plan', deletePlanTitle: 'Supprimer le plan actuel', confirmNewPlan: "Créer un nouveau plan remplacera et effacera ton plan actuel. Continuer ?", confirmDeletePlan: "Supprimer ton plan actuel ? Tu pourras toujours utiliser le reste de l'app (profil, nutrition, météo…), mais aucun nouveau plan ne sera généré automatiquement.", login: 'Se connecter', account: 'Connecté : {{email}} — toucher pour ouvrir le menu du compte' },
    en: { newPlan: 'New', newPlanFull: 'New Plan', deletePlanTitle: 'Delete current plan', confirmNewPlan: 'Creating a new plan will replace and erase your current plan. Continue?', confirmDeletePlan: 'Delete your current plan? You can still use the rest of the app (profile, nutrition, weather…), but no new plan will be generated automatically.', login: 'Log in', account: 'Signed in as {{email}} — tap to open account menu' },
    es: { newPlan: 'Nuevo', newPlanFull: 'Nuevo plan', deletePlanTitle: 'Eliminar el plan actual', confirmNewPlan: 'Crear un nuevo plan reemplazará y borrará tu plan actual. ¿Continuar?', confirmDeletePlan: '¿Eliminar tu plan actual? Podrás seguir usando el resto de la app (perfil, nutrición, clima…), pero no se generará ningún plan nuevo automáticamente.', login: 'Iniciar sesión', account: 'Conectado como {{email}} — toca para abrir el menú de la cuenta' },
  },
  tabs: {
    fr: { tools: 'Outils', nutrition: 'Nutrition', calendar: 'Calendrier', objective: 'Objectif', weather: 'Météo', profile: 'Profil', chat: 'Coach Chat' },
    en: { tools: 'Tools', nutrition: 'Nutrition', calendar: 'Calendar', objective: 'Goal', weather: 'Weather', profile: 'Profile', chat: 'Coach Chat' },
    es: { tools: 'Herramientas', nutrition: 'Nutrición', calendar: 'Calendario', objective: 'Objetivo', weather: 'Clima', profile: 'Perfil', chat: 'Chat Coach' },
  },
  // Sous-onglet de l'onglet Outils sans équivalent dans `tabs` ci-dessus : Pression pneus.
  tools: {
    fr: { tirePressureSubTab: '🚴 Pression pneus', equipmentSubTab: '🔧 Matériel' },
    en: { tirePressureSubTab: '🚴 Tire pressure', equipmentSubTab: '🔧 Gear' },
    es: { tirePressureSubTab: '🚴 Presión de neumáticos', equipmentSubTab: '🔧 Material' },
  },
  auth: {
    fr: { title: 'Tri Coach', subtitle: "Connecte-toi pour retrouver ton plan, ton calendrier et ton profil sur tous tes appareils — tes données sont sauvegardées automatiquement dans le cloud.", google: 'Se connecter avec Google', connecting: 'Connexion…', error: 'Connexion Google indisponible pour le moment. Réessaie, ou continue sans compte.', skip: 'Continuer sans compte (données stockées uniquement sur cet appareil)' },
    en: { title: 'Tri Coach', subtitle: 'Sign in to find your plan, calendar and profile on all your devices — your data is saved automatically to the cloud.', google: 'Sign in with Google', connecting: 'Signing in…', error: 'Google sign-in is unavailable right now. Try again, or continue without an account.', skip: 'Continue without an account (data stored on this device only)' },
    es: { title: 'Tri Coach', subtitle: 'Inicia sesión para encontrar tu plan, calendario y perfil en todos tus dispositivos — tus datos se guardan automáticamente en la nube.', google: 'Iniciar sesión con Google', connecting: 'Conectando…', error: 'El inicio de sesión con Google no está disponible ahora mismo. Inténtalo de nuevo o continúa sin cuenta.', skip: 'Continuar sin cuenta (datos guardados solo en este dispositivo)' },
  },
  settings: {
    fr: {
      title: 'Réglages', account: 'Compte', signedInAs: 'Connecté en tant que', signOut: 'Se déconnecter',
      language: 'Langue de l\'application', theme: 'Apparence', themeLight: 'Clair', themeDark: 'Sombre',
      themeHint: "Le mode sombre s'applique à toute l'app et garde un contraste texte/fond suffisant pour rester lisible.",
      dangerZone: 'Zone de danger', deleteAccount: 'Supprimer mon compte Tri Coach',
      deleteAccountHint: "Supprime définitivement ton compte et toutes tes données du cloud (plan, profil, historique, chat). Cette action est irréversible.",
      deleteConfirmTitle: 'Supprimer définitivement ton compte ?',
      deleteConfirmBody: "Ton profil, ton plan d'entraînement, ton historique et tes conversations seront effacés du cloud et de cet appareil, sans retour possible.",
      deleteConfirmType: 'Tape SUPPRIMER pour confirmer',
      deleteConfirmPlaceholder: 'SUPPRIMER',
      deleteConfirmWord: 'SUPPRIMER',
      deleting: 'Suppression en cours…',
      deleteError: "La suppression a échoué. Réessaie, ou contacte le support si le problème persiste.",
      noAccountHint: 'Connecte-toi avec Google pour accéder à la suppression de compte et à la synchronisation cloud.',
      stravaConnect: 'Connecter Strava', stravaDisconnect: 'Déconnecter Strava',
      stravaConnected: 'Compte Strava lié', stravaConnectedHint: 'Tes activités Strava apparaissent automatiquement dans ton calendrier, avec une analyse IA de chaque séance.',
      stravaHint: 'Lie ton compte Strava pour voir automatiquement tes activités réalisées (carte, allure, FC, puissance) et une analyse IA prévu vs réalisé.',
      stravaDisconnectError: 'La déconnexion a échoué. Réessaie.',
      stravaSync: 'Importer mes activités récentes', stravaSyncing: 'Import en cours…',
      stravaSyncHint: "Récupère tes activités Strava de la semaine en cours et de la semaine précédente pour compléter le calendrier. Le webhook s'occupe déjà des nouvelles activités automatiquement — ce bouton sert seulement à rattraper les tout derniers jours.",
      stravaSyncSuccess: ({ imported = 0, skipped = 0, limited = false } = {}) => (imported > 0
        ? `${imported} activité${imported > 1 ? 's' : ''} importée${imported > 1 ? 's' : ''}${skipped > 0 ? ` (${skipped} déjà connue${skipped > 1 ? 's' : ''})` : ''}.`
        : 'Tout est déjà à jour, aucune nouvelle activité à importer.'
      ) + (limited ? ' Beaucoup d\'activités récentes : import limité à la semaine en cours.' : ''),
      stravaSyncError: "L'import a échoué. Réessaie dans un instant.",
    },
    en: {
      title: 'Settings', account: 'Account', signedInAs: 'Signed in as', signOut: 'Sign out',
      language: 'App language', theme: 'Appearance', themeLight: 'Light', themeDark: 'Dark',
      themeHint: 'Dark mode applies to the whole app and keeps enough text/background contrast to stay readable.',
      dangerZone: 'Danger zone', deleteAccount: 'Delete my Tri Coach account',
      deleteAccountHint: 'Permanently deletes your account and all your cloud data (plan, profile, history, chat). This cannot be undone.',
      deleteConfirmTitle: 'Permanently delete your account?',
      deleteConfirmBody: 'Your profile, training plan, history and conversations will be erased from the cloud and this device, with no way back.',
      deleteConfirmType: 'Type DELETE to confirm',
      deleteConfirmPlaceholder: 'DELETE',
      deleteConfirmWord: 'DELETE',
      deleting: 'Deleting…',
      deleteError: 'Deletion failed. Try again, or contact support if the issue persists.',
      noAccountHint: 'Sign in with Google to access account deletion and cloud sync.',
      stravaConnect: 'Connect Strava', stravaDisconnect: 'Disconnect Strava',
      stravaConnected: 'Strava account linked', stravaConnectedHint: 'Your Strava activities appear automatically in your calendar, with an AI analysis of each session.',
      stravaHint: 'Link your Strava account to automatically see your completed activities (map, pace, heart rate, power) and an AI planned-vs-actual analysis.',
      stravaDisconnectError: 'Disconnection failed. Try again.',
      stravaSync: 'Import my recent activities', stravaSyncing: 'Importing…',
      stravaSyncHint: "Fetches your Strava activities from this week and last week to fill in your calendar. New activities are already picked up automatically by the webhook — this button is only to catch up on the last few days.",
      stravaSyncSuccess: ({ imported = 0, skipped = 0, limited = false } = {}) => (imported > 0
        ? `${imported} activit${imported > 1 ? 'ies' : 'y'} imported${skipped > 0 ? ` (${skipped} already known)` : ''}.`
        : 'Already up to date, nothing new to import.'
      ) + (limited ? ' Lots of recent activity: import limited to the current week.' : ''),
      stravaSyncError: 'Import failed. Try again in a moment.',
    },
    es: {
      title: 'Ajustes', account: 'Cuenta', signedInAs: 'Conectado como', signOut: 'Cerrar sesión',
      language: 'Idioma de la aplicación', theme: 'Apariencia', themeLight: 'Claro', themeDark: 'Oscuro',
      themeHint: 'El modo oscuro se aplica a toda la app y mantiene suficiente contraste texto/fondo para seguir siendo legible.',
      dangerZone: 'Zona de peligro', deleteAccount: 'Eliminar mi cuenta de Tri Coach',
      deleteAccountHint: 'Elimina permanentemente tu cuenta y todos tus datos en la nube (plan, perfil, historial, chat). Esta acción es irreversible.',
      deleteConfirmTitle: '¿Eliminar tu cuenta definitivamente?',
      deleteConfirmBody: 'Tu perfil, plan de entrenamiento, historial y conversaciones se borrarán de la nube y de este dispositivo, sin posibilidad de recuperarlos.',
      deleteConfirmType: 'Escribe ELIMINAR para confirmar',
      deleteConfirmPlaceholder: 'ELIMINAR',
      deleteConfirmWord: 'ELIMINAR',
      deleting: 'Eliminando…',
      deleteError: 'No se pudo eliminar. Inténtalo de nuevo o contacta con soporte si el problema continúa.',
      noAccountHint: 'Inicia sesión con Google para acceder a la eliminación de cuenta y la sincronización en la nube.',
      stravaConnect: 'Conectar Strava', stravaDisconnect: 'Desconectar Strava',
      stravaConnected: 'Cuenta de Strava vinculada', stravaConnectedHint: 'Tus actividades de Strava aparecen automáticamente en tu calendario, con un análisis IA de cada sesión.',
      stravaHint: 'Vincula tu cuenta de Strava para ver automáticamente tus actividades realizadas (mapa, ritmo, FC, potencia) y un análisis IA de lo previsto frente a lo realizado.',
      stravaDisconnectError: 'La desconexión falló. Inténtalo de nuevo.',
      stravaSync: 'Importar mis actividades recientes', stravaSyncing: 'Importando…',
      stravaSyncHint: 'Recupera tus actividades de Strava de esta semana y de la semana pasada para completar el calendario. El webhook ya se encarga de las nuevas actividades automáticamente — este botón solo sirve para recuperar los últimos días.',
      stravaSyncSuccess: ({ imported = 0, skipped = 0, limited = false } = {}) => (imported > 0
        ? `${imported} actividad${imported > 1 ? 'es' : ''} importada${imported > 1 ? 's' : ''}${skipped > 0 ? ` (${skipped} ya conocida${skipped > 1 ? 's' : ''})` : ''}.`
        : 'Todo está al día, no hay nada nuevo que importar.'
      ) + (limited ? ' Muchas actividades recientes: importación limitada a la semana en curso.' : ''),
      stravaSyncError: 'La importación falló. Inténtalo de nuevo en un momento.',
    },
  },
  wizard: {
    fr: {
      step1: '1. Ton profil', step2: '2. Ton objectif', step3: '2. Ton objectif', step4: '4. Physiologie', step5: '5. Date & disponibilités',
      firstName: 'Prénom', eventName: "Nom de l'épreuve (optionnel)", gender: 'Sexe', male: 'Homme', female: 'Femme',
      weight: 'Poids (kg)', fitnessLevel: 'Niveau ressenti', sportType: 'Discipline', running: 'Course à pied', triathlon: 'Triathlon',
      targetDate: "Date de l'objectif", pickDate: 'Choisir une date', hoursPerWeek: 'Volume horaire hebdo disponible', sessionsPerWeek: 'Nombre de séances par semaine', sessions: 'séances', restDay: 'Jour(s) de repos obligatoire',
      generate: 'Générer mon plan', generating: 'Génération en cours…',
      close: 'Annuler', back: 'Retour', next: 'Suivant',
    },
    en: {
      step1: '1. Your profile', step2: '2. Your goal', step3: '2. Your goal', step4: '4. Physiology', step5: '5. Date & availability',
      firstName: 'First name', eventName: 'Event name (optional)', gender: 'Gender', male: 'Male', female: 'Female',
      weight: 'Weight (kg)', fitnessLevel: 'Perceived fitness level', sportType: 'Discipline', running: 'Running', triathlon: 'Triathlon',
      targetDate: 'Target date', pickDate: 'Pick a date', hoursPerWeek: 'Weekly hours available', sessionsPerWeek: 'Sessions per week', sessions: 'sessions', restDay: 'Mandatory rest day',
      generate: 'Generate my plan', generating: 'Generating…',
      close: 'Cancel', back: 'Back', next: 'Next',
    },
    es: {
      step1: '1. Tu perfil', step2: '2. Tu objetivo', step3: '2. Tu objetivo', step4: '4. Fisiología', step5: '5. Fecha y disponibilidad',
      firstName: 'Nombre', eventName: 'Nombre de la prueba (opcional)', gender: 'Sexo', male: 'Hombre', female: 'Mujer',
      weight: 'Peso (kg)', fitnessLevel: 'Nivel percibido', sportType: 'Disciplina', running: 'Running', triathlon: 'Triatlón',
      targetDate: 'Fecha del objetivo', pickDate: 'Elegir una fecha', hoursPerWeek: 'Horas semanales disponibles', sessionsPerWeek: 'Sesiones por semana', sessions: 'sesiones', restDay: 'Día(s) de descanso obligatorio',
      generate: 'Generar mi plan', generating: 'Generando…',
      close: 'Cancelar', back: 'Atrás', next: 'Siguiente',
    },
  },
  calendar: {
    fr: { weekCurrent: 'En cours (N)', weekNext: 'Suivante (N+1)', week: 'Semaine', sessions: 'séances', rest: 'Repos', otherSession: 'Autre séance', scrollHint: '← Glisse latéralement pour voir toute la semaine →' },
    en: { weekCurrent: 'Current (N)', weekNext: 'Next (N+1)', week: 'Week', sessions: 'sessions', rest: 'Rest', otherSession: 'Other session', scrollHint: '← Swipe sideways to see the whole week →' },
    es: { weekCurrent: 'Actual (N)', weekNext: 'Siguiente (N+1)', week: 'Semana', sessions: 'sesiones', rest: 'Descanso', otherSession: 'Otra sesión', scrollHint: '← Desliza para ver toda la semana →' },
  },
  workout: {
    fr: { addedViaChat: 'AJOUTÉE VIA CHAT', modifiedViaChat: 'MODIFIÉE VIA CHAT', before: 'AVANT', after: 'APRÈS', structure: 'Structure de la séance', validate: 'Valider la séance', validated: 'Séance validée', difficulty: 'Dureté', shape: 'Forme', difficultyFelt: 'Dureté ressentie', shapeFelt: 'Forme physique', difficultyHint: '1 = très facile, 10 = extrêmement dur', shapeHint: '1 = mauvaise forme, 10 = en pleine forme', submitFeeling: 'Envoyer mon ressenti', ligthenQuestion: 'Faut-il alléger la suite de la semaine ?', lightenWeek: 'Alléger la semaine', keepAsIs: 'Garder comme ça', close: 'Fermer', restTime: 'TEMPS DE REPOS', watts: 'WATTS', effort: 'EFFORT (RPE)', cardio: 'CARDIO', effortZone: "ZONE D'EFFORT", pace: 'ALLURE', avgBpm: 'BPM MOYEN' },
    en: { addedViaChat: 'ADDED VIA CHAT', modifiedViaChat: 'MODIFIED VIA CHAT', before: 'BEFORE', after: 'AFTER', structure: 'Session structure', validate: 'Validate session', validated: 'Session validated', difficulty: 'Difficulty', shape: 'Shape', difficultyFelt: 'Felt difficulty', shapeFelt: 'Physical shape', difficultyHint: '1 = very easy, 10 = extremely hard', shapeHint: '1 = poor shape, 10 = great shape', submitFeeling: 'Send my feedback', ligthenQuestion: 'Should the rest of the week be eased?', lightenWeek: 'Ease the week', keepAsIs: 'Keep as is', close: 'Close', restTime: 'REST TIME', watts: 'WATTS', effort: 'EFFORT (RPE)', cardio: 'CARDIO', effortZone: 'EFFORT ZONE', pace: 'PACE', avgBpm: 'AVG BPM' },
    es: { addedViaChat: 'AÑADIDA POR CHAT', modifiedViaChat: 'MODIFICADA POR CHAT', before: 'ANTES', after: 'DESPUÉS', structure: 'Estructura de la sesión', validate: 'Validar la sesión', validated: 'Sesión validada', difficulty: 'Dureza', shape: 'Forma', difficultyFelt: 'Dureza percibida', shapeFelt: 'Forma física', difficultyHint: '1 = muy fácil, 10 = extremadamente duro', shapeHint: '1 = mala forma, 10 = plena forma', submitFeeling: 'Enviar mi sensación', ligthenQuestion: '¿Aligeramos el resto de la semana?', lightenWeek: 'Aligerar la semana', keepAsIs: 'Dejarlo así', close: 'Cerrar', restTime: 'TIEMPO DE DESCANSO', watts: 'VATIOS', effort: 'ESFUERZO (RPE)', cardio: 'CARDIO', effortZone: 'ZONA DE ESFUERZO', pace: 'RITMO', avgBpm: 'FC MEDIA' },
  },
  chat: {
    fr: { addIntent: "➕ Ajout d'une séance supplémentaire", modifyIntent: '✏️ Modification de séance', placeholder: 'Ex: Décale ma séance de vélo à jeudi...', thinking: 'Coach analyse et recalcule tes cibles...', welcome: (n) => `👋 Salut${n ? ' ' + n : ''} ! Ton plan d'entraînement est opérationnel. Quelle séance souhaites-tu passer en revue ?`, feedbackBtn: '📝 Feedback séance', feedbackPickTitle: 'Sur quelle séance donner ton ressenti ?', feedbackNone: 'Aucune séance en attente de ressenti pour le moment.', feedbackClose: 'Annuler' },
    en: { addIntent: '➕ Add an extra session', modifyIntent: '✏️ Modify a session', placeholder: 'E.g. Move my bike session to Thursday...', thinking: 'Coach is analyzing and recalculating your targets...', welcome: (n) => `👋 Hi${n ? ' ' + n : ''}! Your training plan is ready. Which session would you like to review?`, feedbackBtn: '📝 Session feedback', feedbackPickTitle: 'Which session do you want to give feedback on?', feedbackNone: 'No session awaiting feedback right now.', feedbackClose: 'Cancel' },
    es: { addIntent: '➕ Añadir una sesión extra', modifyIntent: '✏️ Modificar una sesión', placeholder: 'Ej: Cambia mi sesión de bici al jueves...', thinking: 'El coach está analizando y recalculando tus objetivos...', welcome: (n) => `👋 Hola${n ? ' ' + n : ''}! Tu plan de entrenamiento está listo. ¿Qué sesión quieres revisar?`, feedbackBtn: '📝 Feedback de sesión', feedbackPickTitle: '¿Sobre qué sesión quieres dar tu opinión?', feedbackNone: 'Ninguna sesión pendiente de feedback por ahora.', feedbackClose: 'Cancelar' },
  },
  outlook: {
    fr: { title: 'Aperçu semaine {{label}}', hint: 'Projection déterministe (phase/volume estimé) — le détail séance par séance sera généré plus près de cette semaine.', hours: '~{{h}}h prévues', sessions: '{{n}} séances visées', noTarget: "Renseigne un objectif (date) pour voir cet aperçu." },
    en: { title: 'Preview week {{label}}', hint: 'Deterministic projection (phase/estimated volume) — day-by-day detail will be generated closer to that week.', hours: '~{{h}}h planned', sessions: '{{n}} sessions targeted', noTarget: 'Set a goal (date) to see this preview.' },
    es: { title: 'Vista previa semana {{label}}', hint: 'Proyección determinista (fase/volumen estimado) — el detalle día a día se generará más cerca de esa semana.', hours: '~{{h}}h previstas', sessions: '{{n}} sesiones previstas', noTarget: 'Define un objetivo (fecha) para ver esta vista previa.' },
  },
  profile: {
    fr: { title: 'Profil & données santé', hint: '1 clic = 1 courbe · 2 clics = superposition', missingData: 'donnée(s) non renseignée(s)', missingHint: "Pense à les remplir au fur et à mesure (ci-dessous, ou lors de la génération d'un nouveau plan) : tant qu'elles sont vides, le coach IA reste volontairement prudent et évite de calculer des allures/puissances précises pour ces disciplines.", swimCss: 'CSS natation', addEnough: 'Ajoute au moins 2 mesures pour voir l\'évolution de', date: 'Date', add: 'Ajouter', weight: 'Poids', restHr: 'FC repos', hrv: 'VFC (HRV)', maxHr: 'FC max', vma: 'VMA', ftp: 'FTP' },
    en: { title: 'Profile & health data', hint: '1 tap = 1 curve · 2 taps = overlay', missingData: 'field(s) not filled in', missingHint: "Remember to fill them in as you go (below, or when generating a new plan): while they're empty, the AI coach stays deliberately cautious and avoids computing precise paces/power for these disciplines.", swimCss: 'Swim CSS pace', addEnough: 'Add at least 2 measurements to see the trend for', date: 'Date', add: 'Add', weight: 'Weight', restHr: 'Resting HR', hrv: 'HRV', maxHr: 'Max HR', vma: 'VO2max speed', ftp: 'FTP' },
    es: { title: 'Perfil y datos de salud', hint: '1 toque = 1 curva · 2 toques = superposición', missingData: 'dato(s) sin indicar', missingHint: 'Recuerda completarlos poco a poco (abajo, o al generar un nuevo plan): mientras estén vacíos, el coach IA se mantiene prudente y evita calcular ritmos/potencias precisos para esas disciplinas.', swimCss: 'CSS natación', addEnough: 'Añade al menos 2 medidas para ver la evolución de', date: 'Fecha', add: 'Añadir', weight: 'Peso', restHr: 'FC reposo', hrv: 'VFC (HRV)', maxHr: 'FC máx', vma: 'VAM', ftp: 'FTP' },
  },
  performance: {
    fr: { analyses: 'Analyses', title: 'Performance & progression', loadShape: 'Charge & forme ressenties', loadShapeHint: "D'après tes validations de séances (pas de capteur externe connecté)", loadShapeEmpty: 'Valide au moins 2 séances (ressenti dureté/forme) pour voir apparaître ta courbe de charge & forme.', plannedVolume: 'Volume prévu', plannedVolumeHint: 'Heures par discipline — semaine en cours et suivante', plannedVolumeEmpty: 'Aucun plan généré pour l\'instant.', zoneDistribution: 'Distribution des zones', zoneDistributionHint: "Minutes par zone d'intensité — semaine en cours", zoneDistributionEmpty: 'Pas assez d\'info de zone dans le plan actuel.', keyMetrics: 'Métriques clés', keyMetricsEmpty: 'Renseigne ton profil (VMA, FTP, poids…) pour voir tes métriques clés.' },
    en: { analyses: 'Analytics', title: 'Performance & progress', loadShape: 'Perceived load & shape', loadShapeHint: 'Based on your validated sessions (no external sensor connected)', loadShapeEmpty: 'Validate at least 2 sessions (difficulty/shape feedback) to see your load & shape curve.', plannedVolume: 'Planned volume', plannedVolumeHint: 'Hours per discipline — current and next week', plannedVolumeEmpty: 'No plan generated yet.', zoneDistribution: 'Zone distribution', zoneDistributionHint: 'Minutes per intensity zone — current week', zoneDistributionEmpty: 'Not enough zone data in the current plan.', keyMetrics: 'Key metrics', keyMetricsEmpty: 'Fill in your profile (VO2max speed, FTP, weight…) to see your key metrics.' },
    es: { analyses: 'Análisis', title: 'Rendimiento y progresión', loadShape: 'Carga y forma percibidas', loadShapeHint: 'Según tus sesiones validadas (sin sensor externo conectado)', loadShapeEmpty: 'Valida al menos 2 sesiones (dureza/forma) para ver tu curva de carga y forma.', plannedVolume: 'Volumen previsto', plannedVolumeHint: 'Horas por disciplina — semana actual y siguiente', plannedVolumeEmpty: 'Aún no se ha generado ningún plan.', zoneDistribution: 'Distribución de zonas', zoneDistributionHint: 'Minutos por zona de intensidad — semana actual', zoneDistributionEmpty: 'No hay suficiente información de zonas en el plan actual.', keyMetrics: 'Métricas clave', keyMetricsEmpty: 'Completa tu perfil (VAM, FTP, peso…) para ver tus métricas clave.' },
  },
  nutrition: {
    fr: { title: '🥗 Nutrition & hydratation', regenerate: '↻ Régénérer', training: "À l'entraînement", race: 'Le jour de la course', question: 'Une question spécifique ?', questionExample: 'Ex : "Je n\'arrive pas à manger de gels pendant les efforts intenses, que faire ?"', questionPlaceholder: 'Pose ta question nutrition...', disclaimer: 'Conseils basés sur les référentiels ACSM/ISSN — ne remplacent pas un avis médical ou diététique individualisé.', verified: 'Vérifié' },
    en: { title: '🥗 Nutrition & hydration', regenerate: '↻ Regenerate', training: 'During training', race: 'Race day', question: 'A specific question?', questionExample: 'E.g.: "I can\'t manage to eat gels during intense efforts, what should I do?"', questionPlaceholder: 'Ask your nutrition question...', disclaimer: 'Advice based on ACSM/ISSN guidelines — not a substitute for individualized medical or dietetic advice.', verified: 'Verified' },
    es: { title: '🥗 Nutrición e hidratación', regenerate: '↻ Regenerar', training: 'Durante el entrenamiento', race: 'El día de la carrera', question: '¿Una pregunta específica?', questionExample: 'Ej: "No consigo tomar geles durante esfuerzos intensos, ¿qué hago?"', questionPlaceholder: 'Haz tu pregunta de nutrición...', disclaimer: 'Consejos basados en las guías ACSM/ISSN — no sustituyen un consejo médico o dietético individualizado.', verified: 'Verificado' },
  },
  weather: {
    fr: { title: '🌦️ Météo d\'entraînement', refresh: '↻ Actualiser', summary: '📋 Résumé', radar: '🗺️ Carte radar & vent', loadingMap: 'Chargement de la carte radar…', locating: 'Localisation et récupération de la météo...', wind: 'Vent', geoUnavailable: 'Géolocalisation non disponible sur cet appareil.', fetchError: 'Impossible de récupérer la météo pour le moment.', geoDenied: "Autorise la géolocalisation pour voir la météo de ta semaine d'entraînement.", posError: 'Impossible de récupérer ta position.', yourPosition: 'Ta position', source: 'Données Open-Meteo, position de l\'appareil, actualisées à chaque ouverture de l\'onglet.' },
    en: { title: '🌦️ Training weather', refresh: '↻ Refresh', summary: '📋 Summary', radar: '🗺️ Radar & wind map', loadingMap: 'Loading radar map…', locating: 'Locating and fetching the weather...', wind: 'Wind', geoUnavailable: 'Geolocation is not available on this device.', fetchError: 'Could not fetch the weather right now.', geoDenied: 'Allow geolocation to see the weather for your training week.', posError: 'Could not fetch your position.', yourPosition: 'Your position', source: 'Open-Meteo data, device position, refreshed each time this tab is opened.' },
    es: { title: '🌦️ Clima de entrenamiento', refresh: '↻ Actualizar', summary: '📋 Resumen', radar: '🗺️ Mapa radar y viento', loadingMap: 'Cargando mapa radar…', locating: 'Localizando y obteniendo el clima...', wind: 'Viento', geoUnavailable: 'La geolocalización no está disponible en este dispositivo.', fetchError: 'No se pudo obtener el clima en este momento.', geoDenied: 'Permite la geolocalización para ver el clima de tu semana de entrenamiento.', posError: 'No se pudo obtener tu posición.', yourPosition: 'Tu posición', source: 'Datos Open-Meteo, posición del dispositivo, actualizados cada vez que abres esta pestaña.' },
  },
  tirePressure: {
    fr: {
      title: 'Pression pneus vélo', methodTag: 'Méthode "tire drop" 15%',
      systemWeight: 'Poids vélo chargé + pilote', systemWeightHint: "Pèse-toi habillé/équipé, ajoute le poids du vélo et de tout ce qu'il transporte (bidons, sacoches...). C'est le poids système total qui compte, pas seulement le tien.",
      tireWidth: 'Largeur du pneu mesurée', tireWidthHint: "Mesure au pied à coulisse une fois le pneu monté et gonflé — pas la largeur nominale indiquée sur le flanc, qui peut être fausse de plusieurs mm selon la jante.",
      surface: 'Surface', surface_smooth: 'Route lisse', surface_rough: 'Route dégradée', surface_gravel: 'Chemins blancs', surface_offroad: 'Tout-terrain',
      tireType: 'Type de pneu', tireType_clincher: 'Chambre à air', tireType_tubeless: 'Tubeless', tireType_tubular: 'Tubulaire',
      weather: 'Météo', weather_dry: 'Sec', weather_wet: 'Mouillé',
      advanced: 'Options avancées', advancedHint: 'Jante, carcasse, chargement',
      rimWidth: 'Largeur interne de jante',
      rimMismatch: "Cette combinaison largeur pneu / jante est inhabituelle — vérifie que la largeur de pneu saisie ci-dessus est bien la largeur RÉELLE mesurée, pas la largeur nominale.",
      carcass: 'Carcasse', carcass_standard: 'Standard', carcass_supple: 'Souple (haut TPI)', carcass_reinforced: 'Renforcée',
      priority: 'Priorité', priority_comfort: 'Confort', priority_balanced: 'Équilibré', priority_performance: 'Performance',
      loadDistribution: 'Répartition de charge', loadDistribution_neutral: 'Neutre', loadDistribution_frontLoaded: 'Avant chargé', loadDistribution_rearLoaded: 'Arrière chargé',
      knownMax: 'Limite max connue', optional: 'Optionnel',
      hookless: 'Jante sans crochet (hookless)', hooklessHint: 'Plafonne automatiquement à 5.0 bar / 72.5 psi (norme ETRTO)',
      front: 'Avant', rear: 'Arrière', rangeHint: 'Fourchette confort ↔ performance affichée sous chaque valeur',
      warnHookless: 'Pression plafonnée à {{max}} bar : au-delà, une jante hookless risque le désertage du pneu.',
      warnKnownMax: 'Pression plafonnée à la limite max que tu as renseignée.',
      warnFloor: "Le calcul tombe sous le plancher de sécurité (1.4 bar) : ce pneu/cette charge n'est probablement pas adapté à cette configuration — envisage un pneu plus large.",
      warnCeiling: 'Le calcul dépasse 10 bar : vérifie la largeur de pneu saisie, ce niveau de pression est rarement pertinent.',
      disclaimer: "Point de départ basé sur la méthode du tire drop (charge du système, largeur mesurée, terrain) — pas une reproduction de l'algorithme propriétaire SILCA. Affine ensuite de ±0.2-0.3 bar selon ton ressenti (grip, confort, absence de rebond), et ne dépasse jamais la pression max indiquée sur le flanc du pneu ou de la jante.",
    },
    en: {
      title: 'Bike tire pressure', methodTag: '15% "tire drop" method',
      systemWeight: 'Loaded bike + rider weight', systemWeightHint: 'Weigh yourself geared up, add the bike\'s weight and anything it carries (bottles, bags...). Total system weight is what matters, not just your own.',
      tireWidth: 'Measured tire width', tireWidthHint: "Measure with calipers once the tire is mounted and inflated — not the nominal width printed on the sidewall, which can be off by several mm depending on the rim.",
      surface: 'Surface', surface_smooth: 'Smooth road', surface_rough: 'Rough road', surface_gravel: 'Gravel', surface_offroad: 'Off-road',
      tireType: 'Tire type', tireType_clincher: 'Clincher (tube)', tireType_tubeless: 'Tubeless', tireType_tubular: 'Tubular',
      weather: 'Weather', weather_dry: 'Dry', weather_wet: 'Wet',
      advanced: 'Advanced options', advancedHint: 'Rim, casing, load',
      rimWidth: 'Internal rim width',
      rimMismatch: 'This tire/rim width combination is unusual — check that the tire width entered above is the actual MEASURED width, not the nominal one.',
      carcass: 'Casing', carcass_standard: 'Standard', carcass_supple: 'Supple (high TPI)', carcass_reinforced: 'Reinforced',
      priority: 'Priority', priority_comfort: 'Comfort', priority_balanced: 'Balanced', priority_performance: 'Performance',
      loadDistribution: 'Load distribution', loadDistribution_neutral: 'Neutral', loadDistribution_frontLoaded: 'Front loaded', loadDistribution_rearLoaded: 'Rear loaded',
      knownMax: 'Known max limit', optional: 'Optional',
      hookless: 'Hookless rim', hooklessHint: 'Automatically capped at 5.0 bar / 72.5 psi (ETRTO standard)',
      front: 'Front', rear: 'Rear', rangeHint: 'Comfort ↔ performance range shown under each value',
      warnHookless: 'Pressure capped at {{max}} bar: beyond that, a hookless rim risks the tire unseating.',
      warnKnownMax: 'Pressure capped at the max limit you entered.',
      warnFloor: "The result falls below the safety floor (1.4 bar): this tire/load combo likely doesn't suit this setup — consider a wider tire.",
      warnCeiling: 'The result exceeds 10 bar: double-check the tire width entered, this pressure level is rarely relevant.',
      disclaimer: "Starting point based on the tire drop method (system weight, measured width, terrain) — not a reproduction of SILCA's proprietary algorithm. Fine-tune by ±0.2-0.3 bar based on feel (grip, comfort, no bounce), and never exceed the max pressure printed on the tire or rim sidewall.",
    },
    es: {
      title: 'Presión de neumáticos', methodTag: 'Método "tire drop" 15%',
      systemWeight: 'Peso bici cargada + ciclista', systemWeightHint: 'Pésate equipado, añade el peso de la bici y todo lo que transporta (bidones, alforjas...). Cuenta el peso total del sistema, no solo el tuyo.',
      tireWidth: 'Anchura de neumático medida', tireWidthHint: 'Mide con calibre una vez montado e inflado el neumático — no la anchura nominal impresa en el lateral, que puede diferir varios mm según la llanta.',
      surface: 'Superficie', surface_smooth: 'Carretera lisa', surface_rough: 'Carretera irregular', surface_gravel: 'Caminos de grava', surface_offroad: 'Todoterreno',
      tireType: 'Tipo de neumático', tireType_clincher: 'Cámara de aire', tireType_tubeless: 'Tubeless', tireType_tubular: 'Tubular',
      weather: 'Clima', weather_dry: 'Seco', weather_wet: 'Mojado',
      advanced: 'Opciones avanzadas', advancedHint: 'Llanta, carcasa, carga',
      rimWidth: 'Anchura interna de llanta',
      rimMismatch: 'Esta combinación de anchura de neumático/llanta es inusual — comprueba que la anchura introducida arriba es la MEDIDA real, no la nominal.',
      carcass: 'Carcasa', carcass_standard: 'Estándar', carcass_supple: 'Flexible (TPI alto)', carcass_reinforced: 'Reforzada',
      priority: 'Prioridad', priority_comfort: 'Confort', priority_balanced: 'Equilibrado', priority_performance: 'Rendimiento',
      loadDistribution: 'Distribución de carga', loadDistribution_neutral: 'Neutra', loadDistribution_frontLoaded: 'Carga delantera', loadDistribution_rearLoaded: 'Carga trasera',
      knownMax: 'Límite máx. conocido', optional: 'Opcional',
      hookless: 'Llanta sin gancho (hookless)', hooklessHint: 'Se limita automáticamente a 5.0 bar / 72.5 psi (norma ETRTO)',
      front: 'Delantera', rear: 'Trasera', rangeHint: 'Rango confort ↔ rendimiento bajo cada valor',
      warnHookless: 'Presión limitada a {{max}} bar: por encima, una llanta hookless corre riesgo de que el neumático se desasiente.',
      warnKnownMax: 'Presión limitada al máximo que indicaste.',
      warnFloor: 'El cálculo cae por debajo del límite de seguridad (1.4 bar): esta combinación neumático/carga probablemente no encaja — considera un neumático más ancho.',
      warnCeiling: 'El cálculo supera los 10 bar: revisa la anchura introducida, este nivel de presión rara vez es relevante.',
      disclaimer: 'Punto de partida basado en el método tire drop (peso del sistema, anchura medida, terreno) — no es una reproducción del algoritmo propietario de SILCA. Ajusta después ±0.2-0.3 bar según tu sensación (agarre, confort, sin rebote), y nunca superes la presión máxima indicada en el lateral del neumático o la llanta.',
    },
  },
};

// Traduction des jours (affichage uniquement — la valeur stockée reste en français,
// ex: workout.day === 'Lundi', comparée telle quelle dans lib/workouts.js).
const DAY_NAMES = {
  fr: { Lundi: 'Lundi', Mardi: 'Mardi', Mercredi: 'Mercredi', Jeudi: 'Jeudi', Vendredi: 'Vendredi', Samedi: 'Samedi', Dimanche: 'Dimanche' },
  en: { Lundi: 'Monday', Mardi: 'Tuesday', Mercredi: 'Wednesday', Jeudi: 'Thursday', Vendredi: 'Friday', Samedi: 'Saturday', Dimanche: 'Sunday' },
  es: { Lundi: 'Lunes', Mardi: 'Martes', Mercredi: 'Miércoles', Jeudi: 'Jueves', Vendredi: 'Viernes', Samedi: 'Sábado', Dimanche: 'Domingo' },
};

export function translateDayName(day, lang) {
  if (!day) return day;
  return (DAY_NAMES[lang] && DAY_NAMES[lang][day]) || day;
}

const INTL_LOCALE = { fr: 'fr-FR', en: 'en-US', es: 'es-ES' };
export function intlLocale(lang) {
  return INTL_LOCALE[lang] || 'fr-FR';
}

function interpolate(str, vars) {
  if (!vars) return str;
  return Object.keys(vars).reduce((acc, k) => acc.replace(new RegExp(`{{${k}}}`, 'g'), vars[k]), str);
}

const LanguageContext = createContext({ lang: 'fr', setLang: () => {}, t: (ns, key) => key });

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState('fr');

  useEffect(() => {
    const stored = loadFromStorage(STORAGE_KEYS.language, 'fr');
    setLangState(SUPPORTED_LANGS.some((l) => l.code === stored) ? stored : 'fr');
  }, []);

  useEffect(() => {
    if (typeof document !== 'undefined') document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next) => {
    if (!SUPPORTED_LANGS.some((l) => l.code === next)) return;
    setLangState(next);
    saveToStorage(STORAGE_KEYS.language, next);
  }, []);

  // t('namespace.key', { vars }) — retombe sur le français puis sur la clé brute
  // si une traduction manque, pour ne jamais afficher un texte vide.
  const t = useCallback((path, vars) => {
    const [ns, key] = path.split('.');
    const entry = DICT[ns]?.[lang]?.[key] ?? DICT[ns]?.fr?.[key] ?? path;
    const resolved = typeof entry === 'function' ? entry(vars) : entry;
    return typeof resolved === 'string' ? interpolate(resolved, vars) : resolved;
  }, [lang]);

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);

  return React.createElement(LanguageContext.Provider, { value }, children);
}

export function useI18n() {
  return useContext(LanguageContext);
}
