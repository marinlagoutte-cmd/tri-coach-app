export const STORAGE_KEYS = {
  profile: 'tri_profile',
  plan: 'tri_plan',
  workouts: 'tri_workouts',
  chat: 'tri_chat',
  healthHistory: 'tri_health_history',
  sportType: 'tri_sport_type',
  feedbackHistory: 'tri_feedback_history',
  onboarded: 'tri_onboarded',
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

export function saveToStorage(key, value) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // quota exceeded — silently ignore, not critical
  }
}
