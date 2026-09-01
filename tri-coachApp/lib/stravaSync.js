// lib/stravaSync.js
//
// Logique d'import d'activités Strava PARTAGÉE entre :
// - pages/api/strava/sync.js (bouton manuel "Importer mes activités récentes", fenêtre 12
//   semaines glissante, déclenché par l'athlète)
// - pages/api/strava/auto-sync.js (cron horaire, voir ce fichier pour le détail : première
//   passe = historique complet une fois par athlète, puis fenêtre courte à chaque heure)
//
// Auparavant cette logique (pagination /athlete/activities, dédoublonnage, correspondance
// calendrier, insertion par lots) vivait uniquement dans sync.js — extraite ici pour ne pas
// la dupliquer (et donc la faire diverger) entre le bouton manuel et le cron.
import { fetchStravaActivities, toActivityRow } from './strava';
import { findAutoMatch } from './stravaMatch';
import { loadAthleteContext } from './athleteContext';
import { syncEquipmentFromStrava } from './equipment';

const DB_CHUNK_SIZE = 200; // taille des lots d'insertion Supabase, pour éviter une requête géante

/**
 * Récupère (pagination incluse) les activités Strava de l'athlète depuis `afterEpochSec`,
 * les importe dans `strava_activities` (jamais de ré-écriture d'une activité déjà connue —
 * voir commentaire d'en-tête de sync.js), et rafraîchit le kilométrage matériel.
 *
 * @param {object} opts
 * @param {import('@supabase/supabase-js').SupabaseClient} opts.admin - client service_role
 * @param {string} opts.userId
 * @param {string} opts.stravaAccessToken - access_token Strava déjà validé/rafraîchi par l'appelant
 * @param {number} [opts.afterEpochSec] - borne basse (epoch secondes), omise = tout l'historique
 * @param {number} [opts.perPage=200]
 * @param {number} [opts.maxPages=5] - garde-fou pagination (nombre de requêtes Strava max pour CET appel)
 * @param {boolean} [opts.syncEquipment=true]
 * @returns {Promise<{ imported: number, skipped: number, totalFetched: number, equipmentSynced: number, reachedMaxPages: boolean, pagesFetched: number }>}
 */
export async function importStravaActivities({
  admin,
  userId,
  stravaAccessToken,
  afterEpochSec,
  perPage = 200,
  maxPages = 5,
  syncEquipment = true,
}) {
  let allActivities = [];
  let reachedMaxPages = false;
  let pagesFetched = 0;
  for (let page = 1; page <= maxPages; page += 1) {
    // eslint-disable-next-line no-await-in-loop
    const pageData = await fetchStravaActivities(stravaAccessToken, { page, perPage, afterEpochSec });
    pagesFetched += 1;
    if (!Array.isArray(pageData) || pageData.length === 0) break;
    allActivities.push(...pageData);
    if (pageData.length < perPage) break; // dernière page atteinte : fin réelle de l'historique/fenêtre
    if (page === maxPages) reachedMaxPages = true; // il restait peut-être une page de plus (budget épuisé)
  }

  if (allActivities.length === 0) {
    return { imported: 0, skipped: 0, totalFetched: 0, equipmentSynced: 0, reachedMaxPages, pagesFetched };
  }

  const fetchedIds = allActivities.map((a) => a.id);
  const existingIds = new Set();
  for (let i = 0; i < fetchedIds.length; i += DB_CHUNK_SIZE) {
    const idsChunk = fetchedIds.slice(i, i + DB_CHUNK_SIZE);
    // eslint-disable-next-line no-await-in-loop
    const { data: existingRows } = await admin.from('strava_activities').select('id').in('id', idsChunk);
    (existingRows || []).forEach((r) => existingIds.add(r.id));
  }
  const missingActivities = allActivities.filter((a) => !existingIds.has(a.id));

  if (missingActivities.length === 0) {
    return { imported: 0, skipped: allActivities.length, totalFetched: allActivities.length, equipmentSynced: 0, reachedMaxPages, pagesFetched };
  }

  const { workouts } = await loadAthleteContext(admin, userId);
  const rows = missingActivities.map((raw) => {
    const row = toActivityRow(raw, userId);
    const { weekKey, workoutId } = findAutoMatch(row, workouts);
    return {
      ...row,
      matched_week_key: weekKey,
      matched_workout_id: workoutId,
      match_source: weekKey ? 'auto' : 'none',
      // 'skipped' explicitement (voir sync.js) : pas d'analyse IA sur un import en masse.
      ai_analysis_status: 'skipped',
    };
  });

  let imported = 0;
  for (let i = 0; i < rows.length; i += DB_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + DB_CHUNK_SIZE);
    // eslint-disable-next-line no-await-in-loop
    const { error: insertError, count } = await admin
      .from('strava_activities')
      .upsert(chunk, { onConflict: 'id', ignoreDuplicates: true, count: 'exact' });
    if (insertError) {
      console.error('[stravaSync] insert error:', insertError);
      continue;
    }
    imported += count ?? chunk.length;
  }

  let equipmentSynced = 0;
  if (syncEquipment) {
    try {
      const { synced } = await syncEquipmentFromStrava(admin, userId, stravaAccessToken);
      equipmentSynced = synced;
    } catch (e) {
      console.error('[stravaSync] equipment sync error:', e?.message || e);
    }
  }

  return {
    imported,
    skipped: allActivities.length - missingActivities.length,
    totalFetched: allActivities.length,
    equipmentSynced,
    reachedMaxPages,
    pagesFetched,
  };
}
