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
import { waitUntil } from '@vercel/functions';
import { ensureValidStravaToken, fetchStravaActivity, fetchStravaActivityStreams, toActivityRow, stravaSportToDiscipline } from '../../../lib/strava';
import { findAutoMatch } from '../../../lib/stravaMatch';
import { coAnalyzeStravaActivity } from '../../../lib/coGeneration';
import { getAdminClient, loadAthleteContext } from '../../../lib/athleteContext';
import { syncEquipmentFromStrava } from '../../../lib/equipment';
import { detectIntervals, detectRepeatedPattern, buildIntervalPromptBlock } from '../../../lib/intervals';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VERIFY_TOKEN = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN;

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

  const { profile, workouts, language, paceZones, powerZonesBike } = await loadAthleteContext(admin, tokenRow.user_id);
  const { weekKey, workoutId } = findAutoMatch(row, workouts);
  const plannedWorkout = weekKey ? (workouts[weekKey] || []).find((w) => w.id === workoutId) || null : null;

  // ANALYSE PAR INTERVALLES (demande explicite de l'athlète, voir lib/intervals.js) :
  // récupère les streams seconde-par-seconde de CETTE activité — un appel Strava
  // supplémentaire par activité (quota, voir en-tête de fichier), mais indispensable
  // pour voir les VRAIS blocs (allure/watts/FC/cadence par intervalle) plutôt que
  // juste la moyenne globale de toute la séance. Best-effort : un échec ici (capteur
  // absent, timeout, activité trop courte) ne doit JAMAIS empêcher l'analyse IA de se
  // faire — elle retombe alors sur les moyennes globales, comme avant cette fonctionnalité.
  let streams = null;
  let intervalBlock = '';
  try {
    streams = await fetchStravaActivityStreams(accessToken, activityId);
    const discipline = stravaSportToDiscipline(row.sport_type) === 'CYCLISME' ? 'bike' : 'run';
    const detected = detectIntervals({
      streams,
      discipline,
      zones: discipline === 'bike' ? powerZonesBike : paceZones,
      vma: profile?.vma,
      ftp: profile?.ftp,
    });
    if (detected) {
      const pattern = detectRepeatedPattern(detected.segments);
      intervalBlock = buildIntervalPromptBlock(detected, pattern);
    }
  } catch (e) {
    console.warn('[api/strava/webhook] streams/intervalles indisponibles pour cette activité :', e?.message || e);
  }

  const { analysis, seanceDetectee, respectePlan, status, doubleCheckNote } = await coAnalyzeStravaActivity({
    activity: row, plannedWorkout, profile, language, intervalBlock,
  });

  await admin.from('strava_activities').upsert(
    {
      ...row,
      // Mis en cache ici (si le fetch ci-dessus a réussi) pour que l'ouverture du
      // détail (voir pages/api/strava/streams.js) trouve directement le cache au
      // lieu de reconsommer une seconde fois le quota Strava pour la même activité.
      ...(streams ? { streams } : {}),
      matched_week_key: weekKey,
      matched_workout_id: workoutId,
      match_source: weekKey ? 'auto' : 'none',
      ai_analysis: status === 'ok' && doubleCheckNote ? `${analysis}\n\n${doubleCheckNote}` : analysis,
      ai_analysis_status: status,
      ai_seance_detectee: seanceDetectee,
      ai_respecte_plan: respectePlan,
    },
    { onConflict: 'id' }
  );

  // Rafraîchit le kilométrage matériel (vélos/chaussures) à chaque nouvelle activité — c'est
  // le total Strava par gear qui fait foi, pas une somme locale (voir lib/equipment.js).
  // Best-effort : ne doit jamais faire échouer le traitement de l'activité elle-même.
  await syncEquipmentFromStrava(admin, tokenRow.user_id, accessToken);
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
