// pages/api/strava/webhook.js
//
// Reçoit les notifications "push" de Strava dès qu'une activité est créée/
// modifiée/supprimée par un athlète lié (voir STRAVA_SETUP.md pour la création
// de l'abonnement webhook, une opération à faire UNE FOIS via un appel API
// séparé — ce endpoint ne fait que réagir aux notifications déjà configurées).
//
// GET  : validation de l'abonnement (Strava échange un "challenge" au moment
//        de la création de l'abonnement, voir STRAVA_SETUP.md).
// POST : événement d'activité. Toujours répondu 200 rapidement (Strava
//        réessaie sinon) ; le traitement (fetch activité + IA) est idempotent
//        (upsert par id d'activité) pour tolérer d'éventuels doublons de retry.
import { createClient } from '@supabase/supabase-js';
import { waitUntil } from '@vercel/functions';
import { ensureValidStravaToken, fetchStravaActivity } from '../../../lib/strava';
import { findAutoMatch } from '../../../lib/stravaMatch';
import { analyzeStravaActivity } from '../../../lib/gemini';
import { STORAGE_KEYS } from '../../../lib/storage';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VERIFY_TOKEN = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN;

function getAdminClient() {
  return createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

/** Relit le profil/plan/langue de l'athlète depuis le snapshot cloud (voir lib/cloudSync.js) —
 * seule source disponible côté serveur, puisque ces données vivent en localStorage côté client. */
async function loadAthleteContext(admin, userId) {
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
  };
}

function toActivityRow(raw, userId) {
  return {
    id: raw.id,
    user_id: userId,
    sport_type: raw.sport_type || raw.type || null,
    name: raw.name || null,
    start_date: raw.start_date,
    start_date_local: raw.start_date_local,
    timezone: raw.timezone || null,
    distance_m: raw.distance ?? null,
    moving_time_s: raw.moving_time ?? null,
    elapsed_time_s: raw.elapsed_time ?? null,
    total_elevation_m: raw.total_elevation_gain ?? null,
    average_speed_ms: raw.average_speed ?? null,
    max_speed_ms: raw.max_speed ?? null,
    average_heartrate: raw.average_heartrate ?? null,
    max_heartrate: raw.max_heartrate ?? null,
    average_watts: raw.average_watts ?? null,
    max_watts: raw.max_watts ?? null,
    summary_polyline: raw.map?.summary_polyline || null,
  };
}

async function handleActivityUpsert({ admin, athleteId, activityId, isUpdate }) {
  const { data: tokenRow } = await admin
    .from('strava_tokens')
    .select('user_id, access_token, refresh_token, expires_at')
    .eq('athlete_id', athleteId)
    .maybeSingle();
  if (!tokenRow) return; // athlète non lié (ou plus lié) à un compte Tri Coach : rien à faire

  // Idempotence : sur un simple retry Strava d'un événement déjà traité, on ne
  // relance PAS l'analyse IA (coûteuse en quota) — sauf si l'événement est une
  // vraie mise à jour Strava (aspect_type 'update'), traitée plus bas.
  if (!isUpdate) {
    const { data: existing } = await admin.from('strava_activities').select('id').eq('id', activityId).maybeSingle();
    if (existing) return;
  }

  const { accessToken, refreshToken, expiresAt, refreshed } = await ensureValidStravaToken({
    accessToken: tokenRow.access_token,
    refreshToken: tokenRow.refresh_token,
    expiresAt: tokenRow.expires_at,
  });
  if (refreshed) {
    await admin.from('strava_tokens').update({
      access_token: accessToken, refresh_token: refreshToken, expires_at: expiresAt, updated_at: new Date().toISOString(),
    }).eq('user_id', tokenRow.user_id);
  }

  const raw = await fetchStravaActivity(accessToken, activityId);
  const row = toActivityRow(raw, tokenRow.user_id);

  const { profile, workouts, language } = await loadAthleteContext(admin, tokenRow.user_id);
  const { weekKey, workoutId } = findAutoMatch(row, workouts);
  const plannedWorkout = weekKey ? (workouts[weekKey] || []).find((w) => w.id === workoutId) || null : null;

  const { analysis, status } = await analyzeStravaActivity({ activity: row, plannedWorkout, profile, language });

  await admin.from('strava_activities').upsert(
    {
      ...row,
      matched_week_key: weekKey,
      matched_workout_id: workoutId,
      match_source: weekKey ? 'auto' : 'none',
      ai_analysis: analysis,
      ai_analysis_status: status,
    },
    { onConflict: 'id' }
  );
}

async function handleActivityDelete({ admin, activityId, athleteId }) {
  const { data: tokenRow } = await admin.from('strava_tokens').select('user_id').eq('athlete_id', athleteId).maybeSingle();
  if (!tokenRow) return;
  await admin.from('strava_activities').delete().eq('id', activityId).eq('user_id', tokenRow.user_id);
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token && VERIFY_TOKEN && token === VERIFY_TOKEN) {
      return res.status(200).json({ 'hub.challenge': challenge });
    }
    return res.status(403).json({ error: 'Verification failed' });
  }

  if (req.method !== 'POST') return res.status(405).end();

  // Toujours 200 très vite : Strava considère un timeout/4xx/5xx comme un échec
  // et réessaie plus tard, ce qu'on préfère éviter une fois l'événement reçu.
  //
  // IMPORTANT (bug corrigé le 20/08) : sur Vercel, une fonction serverless
  // Node.js peut être gelée dès que la réponse HTTP est envoyée, MÊME si ce
  // handler (async) n'a pas fini de s'exécuter. Continuer du travail "en
  // arrière-plan" après res.json() sans le signaler à la plateforme = ce
  // travail peut ne jamais s'exécuter (c'était le cas ici : la requête
  // strava_tokens partait, puis tout s'arrêtait avant l'appel à l'API
  // Strava). `waitUntil` dit explicitement à Vercel de garder la fonction
  // vivante le temps que la promesse se termine, même après la réponse.
  res.status(200).json({ received: true });

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[api/strava/webhook] Supabase non configuré côté serveur.');
    return;
  }

  const { object_type: objectType, aspect_type: aspectType, object_id: objectId, owner_id: ownerId } = req.body || {};
  if (objectType !== 'activity') return;

  const admin = getAdminClient();
  const work = (async () => {
    try {
      if (aspectType === 'delete') {
        await handleActivityDelete({ admin, activityId: objectId, athleteId: ownerId });
      } else if (aspectType === 'create' || aspectType === 'update') {
        await handleActivityUpsert({ admin, athleteId: ownerId, activityId: objectId, isUpdate: aspectType === 'update' });
      }
    } catch (e) {
      // La réponse 200 est déjà partie : on ne peut que logger côté serveur
      // (visible dans Vercel → Deployments → Functions → Logs) pour diagnostic.
      console.error('[api/strava/webhook] processing error:', { objectId, aspectType, message: e?.message || e });
    }
  })();

  waitUntil(work);
}
