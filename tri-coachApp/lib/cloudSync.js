// lib/cloudSync.js
//
// Stratégie volontairement simple et robuste : au lieu de synchroniser chaque
// morceau d'état React individuellement (profil, plan, séances, nutrition — cette
// dernière gérée en interne par NutritionPlanner.js, hors de pages/index.js), on
// synchronise un SNAPSHOT COMPLET du localStorage (toutes les clés de STORAGE_KEYS)
// dans une seule ligne JSON par utilisateur, côté Supabase. Avantages :
//  - une seule table, un seul schéma, qui n'a jamais besoin d'évoluer si une nouvelle
//    clé de stockage local apparaît plus tard dans l'app ;
//  - la fusion au login réutilise le mécanisme d'hydratation déjà existant (chaque
//    composant relit le localStorage à son montage) au lieu de dupliquer la logique
//    de merge état par état.
import { supabase, isSupabaseConfigured } from './supabase';
import { STORAGE_KEYS } from './storage';

const TABLE = 'tri_coach_data';
const PUSH_DEBOUNCE_MS = 1500;

let currentUserId = null;
let pushTimer = null;

export function setCloudUser(userId) {
  currentUserId = userId || null;
}

export function getCloudUser() {
  return currentUserId;
}

function snapshotLocalStorage() {
  const snapshot = {};
  if (typeof window === 'undefined') return snapshot;
  Object.values(STORAGE_KEYS).forEach((key) => {
    const raw = localStorage.getItem(key);
    // On garde le JSON déjà stringifié tel quel (pas de parse/re-stringify) : la
    // colonne `snapshot` est un jsonb, mais chaque valeur y est stockée comme
    // string brute identique à ce que contient localStorage, pour une fusion
    // triviale et sans perte au retour (voir applySnapshotToLocalStorage).
    if (raw !== null) snapshot[key] = raw;
  });
  return snapshot;
}

function applySnapshotToLocalStorage(snapshot) {
  if (!snapshot || typeof window === 'undefined') return;
  Object.entries(snapshot).forEach(([key, rawValue]) => {
    if (typeof rawValue === 'string') localStorage.setItem(key, rawValue);
  });
}

/**
 * Va chercher les données cloud de l'utilisateur et les fusionne dans le navigateur
 * (écrase le localStorage local avec la version cloud, clé par clé — voir doc en tête
 * de fichier). Ne fait RIEN si Supabase n'est pas configuré.
 * @returns {Promise<{ merged: boolean, error?: any }>} merged=true si des données
 *   cloud existaient et ont été appliquées ; merged=false si le compte est "vierge"
 *   côté cloud (premier login sur ce compte) — dans ce cas c'est à l'appelant de
 *   pousser l'état local actuel vers le cloud pour l'amorcer.
 */
export async function fetchAndMergeCloudData(userId) {
  if (!isSupabaseConfigured || !userId) return { merged: false };
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select('snapshot, updated_at')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) {
      console.error('[cloudSync] fetch error', error);
      return { merged: false, error };
    }
    if (data?.snapshot && Object.keys(data.snapshot).length > 0) {
      applySnapshotToLocalStorage(data.snapshot);
      return { merged: true };
    }
    return { merged: false };
  } catch (error) {
    console.error('[cloudSync] fetch exception', error);
    return { merged: false, error };
  }
}

/** Pousse IMMÉDIATEMENT l'état local courant vers le cloud (pas de debounce). */
export async function pushCloudDataNow() {
  if (!isSupabaseConfigured || !currentUserId) return;
  try {
    const snapshot = snapshotLocalStorage();
    const { error } = await supabase
      .from(TABLE)
      .upsert({ user_id: currentUserId, snapshot, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error) console.error('[cloudSync] push error', error);
  } catch (error) {
    console.error('[cloudSync] push exception', error);
  }
}

/**
 * Pousse l'état local vers le cloud, avec un debounce court : appelée à chaque
 * sauvegarde locale (via le hook enregistré dans lib/storage.js), donc potentiellement
 * très souvent pendant une frappe/un chat — on ne veut pas spammer Supabase.
 *
 * Le snapshot restant un push COMPLET (voir doc en tête de fichier), la clé `tri_chat`
 * (STORAGE_KEYS.chat) est volontairement exclue de ce debounce : l'historique de chat
 * grossit avec le temps, et repousser tout le snapshot à CHAQUE message (debounce 1.5s)
 * rendrait l'upsert de plus en plus lourd sans raison. Le chat est donc synchronisé
 * uniquement quand l'app passe en arrière-plan/se ferme (voir flushCloudPushOnHide),
 * ce qui suffit largement : perdre au pire les tout derniers messages non encore
 * poussés en cas de crash n'a pas d'impact fonctionnel.
 */
export function queueCloudPush(changedKey) {
  if (!isSupabaseConfigured || !currentUserId) return;
  if (changedKey === STORAGE_KEYS.chat) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushCloudDataNow();
  }, PUSH_DEBOUNCE_MS);
}

/**
 * À appeler sur perte de focus (blur/visibilitychange caché/pagehide) : pousse
 * immédiatement le snapshot complet, pour rattraper notamment le chat qui n'est
 * jamais poussé par le debounce ci-dessus.
 */
export function flushCloudPushOnHide() {
  if (!isSupabaseConfigured || !currentUserId) return;
  clearTimeout(pushTimer);
  pushCloudDataNow();
}
