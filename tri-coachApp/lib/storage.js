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
  // Bornes des zones FC / Puissance — SÉPARÉES par discipline (Course à pied / Vélo,
  // voir components/ZoneCharts.js) car un même chiffre n'a pas le même sens dans les
  // deux : la puissance de seuil (FTP) vélo n'est pas sur la même échelle que la
  // puissance course (capteur type Stryd), et la FC max/zones ressenties diffèrent
  // aussi souvent d'une discipline à l'autre pour un même athlète. `tri_hr_zones` /
  // `tri_power_zones` (noms historiques, conservés tels quels pour ne pas perdre les
  // réglages déjà faits par les athlètes existants) portent désormais spécifiquement
  // sur la COURSE ; les clés "_bike" sont nouvelles et démarrent vierges (valeurs par
  // défaut recalculées depuis le profil) puisqu'aucune donnée vélo distincte n'existait
  // avant cette séparation.
  hrZones: 'tri_hr_zones',
  powerZones: 'tri_power_zones',
  hrZonesBike: 'tri_hr_zones_bike',
  powerZonesBike: 'tri_power_zones_bike',
  // Zones d'allure course à pied (CAP), éditables manuellement dans ZoneCharts.js —
  // initialisées depuis la VMA du profil puis indépendantes, exactement comme hrZones/
  // powerZones ci-dessus. Envoyées au coach IA (voir pages/index.js) où elles PRIMENT sur
  // le calcul théorique % VMA dès que l'athlète les a éditées (voir lib/gemini.js:computeRunZones).
  paceZones: 'tri_pace_zones',
  // Derniers réglages saisis dans l'outil "Pression pneus" (onglet Outils) — purement
  // local (pas de valeur physiologique en jeu), pour retrouver ses réglages d'un vélo
  // donné sans tout ressaisir à chaque ouverture.
  tirePressureInputs: 'tri_tire_pressure_inputs',
  // Mode de calcul des zones FC/Puissance/Allure (Réglages > Zones d'entraînement) :
  // 'manual' (défaut, comportement historique — bornes saisies/éditées à la main dans
  // ZoneCharts.js) ou 'auto' (bornes recalculées en continu depuis les séances Strava
  // réellement synchronisées, voir lib/zones.js:estimateZonesFromActivities). Voir
  // lib/zonesMode.js pour le contexte React qui expose ce réglage à SettingsModal.js
  // (où il se règle) ET ZoneCharts.js (où il change le comportement de l'onglet).
  zonesMode: 'tri_zones_mode',
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
