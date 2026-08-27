// lib/athleteContext.js
//
// Petits helpers serveur partagés entre les routes Strava qui ont besoin de lire les données
// d'un athlète EN ARRIÈRE-PLAN (webhook, import manuel) — sans session utilisateur active dans
// la requête. Extrait de pages/api/strava/webhook.js pour être réutilisé tel quel par
// pages/api/strava/sync.js, plutôt que dupliqué.
import { createClient } from '@supabase/supabase-js';
import { STORAGE_KEYS } from './storage';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function getAdminClient() {
  return createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

/** Relit le profil/plan/langue de l'athlète depuis le snapshot cloud (voir lib/cloudSync.js) —
 * seule source disponible côté serveur, puisque ces données vivent en localStorage côté client. */
export async function loadAthleteContext(admin, userId) {
  const { data } = await admin.from('tri_coach_data').select('snapshot').eq('user_id', userId).maybeSingle();
  const snapshot = data?.snapshot || {};
  const parse = (key, fallback) => {
    try {
      return snapshot[key] ? JSON.parse(snapshot[key]) : fallback;
    } catch {
      return fallback;
    }
  };
  return {
    profile: parse(STORAGE_KEYS.profile, null),
    workouts: parse(STORAGE_KEYS.workouts, { N: [], 'N+1': [] }),
    language: parse(STORAGE_KEYS.language, 'fr'),
    // Zones d'allure (course) et de puissance (vélo) calibrées manuellement par
    // l'athlète — ajouté pour l'analyse par intervalles (voir lib/intervals.js et
    // pages/api/strava/webhook.js) : classer chaque échantillon d'une activité dans
    // la BONNE zone nécessite les zones RÉELLES de l'athlète si elles existent,
    // jamais uniquement le repli théorique VMA/FTP (même priorité que partout
    // ailleurs dans l'app — voir lib/zones.js:resolveSeedZones).
    paceZones: parse(STORAGE_KEYS.paceZones, null),
    powerZonesBike: parse(STORAGE_KEYS.powerZonesBike, null),
  };
}
