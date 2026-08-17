export const STORAGE_KEYS = {
  profile: 'tri_profile',
  plan: 'tri_plan',
  workouts: 'tri_workouts',
  chat: 'tri_chat',
  healthHistory: 'tri_health_history',
  sportType: 'tri_sport_type',
  feedbackHistory: 'tri_feedback_history',
  onboarded: 'tri_onboarded',
  // Contraintes déclarées au wizard (séances/sem, heures/sem, jour de repos fixe,
  // discipline) — indispensables pour que le chat IA puisse les faire respecter
  // lors d'un ajustement, ce qu'il ne pouvait pas faire tant qu'elles n'étaient
  // connues qu'au moment de la génération initiale du plan.
  constraints: 'tri_constraints',
  // Stratégie de nutrition course construite dans l'onglet Nutrition (ravitos +
  // consommation par segment) — indépendante du plan d'entraînement, conservée
  // tant que l'athlète ne la réinitialise pas explicitement.
  nutritionPlan: 'tri_nutrition_plan',
  // Préférences d'affichage — synchronisées comme le reste via le snapshot cloud
  // (lib/cloudSync.js), donc la langue et le thème choisis suivent l'athlète
  // d'un appareil à l'autre une fois connecté.
  language: 'tri_language',
  theme: 'tri_theme',
};

export function loadFromStorage(key, fallback) {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

// Hook optionnel appelé après chaque écriture locale réussie — utilisé par
// lib/cloudSync.js pour déclencher une synchronisation cloud débounced, SANS que
// storage.js ait besoin d'importer cloudSync.js (ce qui créerait un import circulaire,
// puisque cloudSync.js a besoin de STORAGE_KEYS défini juste au-dessus). L'app
// fonctionne identiquement si ce hook n'est jamais enregistré (cloud non configuré).
let onSaveHook = null;
export function setStorageSaveHook(fn) {
  onSaveHook = typeof fn === 'function' ? fn : null;
}

export function saveToStorage(key, value) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
    if (onSaveHook) onSaveHook(key, value);
  } catch {
    // quota exceeded — silently ignore, not critical
  }
}
