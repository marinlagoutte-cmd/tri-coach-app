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
import { fetchStravaActivities, fetchStravaActivityLaps, toActivityRow } from './strava';
import { findAutoMatch, isInCurrentCalendarWeek } from './stravaMatch';
import { loadAthleteContext } from './athleteContext';
import { syncEquipmentFromStrava } from './equipment';
import { coAnalyzeStravaActivity } from './coGeneration';

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
 * @param {boolean} [opts.analyzeCurrentWeekWithAI=false] - demande explicite de l'athlète :
 *   sur l'import MANUEL ("Importer mes activités récentes", voir pages/api/strava/sync.js),
 *   lance aussi l'analyse IA détaillée (double-check Gemini + Groq + laps, voir
 *   analyzeStravaActivity/lib/lapsAnalysis.js) pour les activités de la SEMAINE CALENDAIRE EN
 *   COURS uniquement (isInCurrentCalendarWeek) — pour permettre de vérifier le rendu sans
 *   attendre un vrai événement webhook. Reste `false` par défaut (et donc jamais activé pour
 *   le cron auto-sync.js, dont le budget de requêtes Strava/IA est volontairement serré, voir
 *   REQUEST_BUDGET_PER_RUN) : un import 12 semaines ne doit jamais déclencher des dizaines
 *   d'analyses IA d'un coup.
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
  analyzeCurrentWeekWithAI = false,
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

  const { profile, workouts, language } = await loadAthleteContext(admin, userId);
  const rows = missingActivities.map((raw) => {
    const row = toActivityRow(raw, userId);
    const { weekKey, workoutId } = findAutoMatch(row, workouts);
    return {
      ...row,
      matched_week_key: weekKey,
      matched_workout_id: workoutId,
      match_source: weekKey ? 'auto' : 'none',
      // Même règle que pages/api/strava/webhook.js (voir son commentaire pour le détail) :
      // une correspondance automatique coche directement la séance comme faite, sans clic de
      // confirmation — demande explicite de l'athlète.
      match_confirmed: Boolean(weekKey),
      // 'skipped' explicitement (voir sync.js) : pas d'analyse IA sur un import en masse —
      // sauf activités de la semaine en cours si analyzeCurrentWeekWithAI (voir ci-dessous),
      // qui écrase ce statut pour celles-là seulement.
      ai_analysis_status: 'skipped',
    };
  });

  // Analyse IA détaillée (laps + double-check Gemini/Groq) des activités de la semaine en
  // cours uniquement — voir doc du paramètre plus haut. Séquentiel (pas Promise.all) pour ne
  // jamais dépasser le rate limit Strava/IA d'un coup : le nombre d'activités concerné ici
  // reste petit (une semaine, pas 12), donc l'impact sur le temps total est négligeable.
  if (analyzeCurrentWeekWithAI) {
    for (const row of rows) {
      const dateStr = row.start_date_local || row.start_date;
      if (!isInCurrentCalendarWeek(dateStr)) continue;

      let laps = null;
      try {
        // eslint-disable-next-line no-await-in-loop
        laps = await fetchStravaActivityLaps(stravaAccessToken, row.id);
      } catch (e) {
        console.error('[stravaSync] fetchStravaActivityLaps error:', { activityId: row.id, message: e?.message });
      }
      row.laps = Array.isArray(laps) && laps.length ? laps : null;

      const plannedWorkout = row.matched_week_key
        ? (workouts[row.matched_week_key] || []).find((w) => w.id === row.matched_workout_id) || null
        : null;

      try {
        // eslint-disable-next-line no-await-in-loop
        const result = await coAnalyzeStravaActivity({ activity: row, plannedWorkout, profile, language, laps: row.laps });
        row.ai_analysis = result.analysis;
        row.ai_analysis_status = result.status || 'ok';
      } catch (e) {
        console.error('[stravaSync] coAnalyzeStravaActivity error:', { activityId: row.id, message: e?.message });
        row.ai_analysis_status = 'error';
      }
    }
  }

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
