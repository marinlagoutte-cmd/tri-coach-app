// lib/aiFetch.js
//
// fetch() pour les routes IA : ajoute le jeton de session Supabase (en-tête
// Authorization: Bearer …) exigé par lib/aiGuard.js. Sans compte / sans Supabase,
// se comporte exactement comme fetch().
import { supabase, isSupabaseConfigured } from './supabase';

export async function aiFetch(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (isSupabaseConfigured && supabase) {
    try {
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;
      if (token) headers.Authorization = `Bearer ${token}`;
    } catch (_) { /* pas de session : l'appel part sans jeton */ }
  }
  return fetch(url, { ...options, headers });
}
