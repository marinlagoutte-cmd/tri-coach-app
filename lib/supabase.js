// lib/supabase.js
//
// Client Supabase, utilisé pour l'auth Google ET le stockage cloud (un seul service,
// voir CHANGELOG / SUPABASE_SETUP.md pour la mise en place complète côté Vercel).
//
// PRINCIPE IMPORTANT : tant que les variables d'environnement NEXT_PUBLIC_SUPABASE_URL
// et NEXT_PUBLIC_SUPABASE_ANON_KEY ne sont pas définies, `supabase` vaut `null` et
// `isSupabaseConfigured` vaut `false` — l'app entière (auth gate, sync cloud) se
// désactive alors proprement et l'app continue de fonctionner exactement comme avant
// (localStorage uniquement), sans aucun écran de connexion ni erreur.
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;
