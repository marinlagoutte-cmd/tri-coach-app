// pages/api/strava/sync.js
//
// Import manuel FORCÉ de l'historique Strava de l'athlète, déclenché depuis Réglages > Strava
// (bouton "Importer mon historique Strava"). Complète le webhook (pages/api/strava/webhook.js),
// qui ne reçoit que les NOUVELLES activités à partir du moment où le compte est lié — sans lui,
// tout ce qui a été enregistré sur Strava AVANT la liaison (ou pendant une période où le webhook
// aurait raté un événement) n'apparaît jamais dans l'app.
//
// Différences volontaires avec le traitement du webhook (voir handleActivityUpsert) :
// - Utilise l'endpoint LISTE (/athlete/activities, fetchStravaActivities) plutôt qu'un fetch
//   détaillé par activité : un "SummaryActivity" contient déjà tous les champs utilisés par
//   toActivityRow, donc importer 500 activités coûte quelques appels Strava (pagination), pas 500.
// - N'IMPORTE QUE les activités absentes de strava_activities (jamais de ré-écriture d'une
//   activité déjà connue) : ça préserve les corrections manuelles de correspondance déjà faites
//   (ActivityDetail.js) et n'interfère jamais avec ce que le webhook a déjà traité.
// - Ne lance PAS l'analyse IA (analyzeStravaActivity) sur chaque activité importée : sur un gros
//   historique, ça exploserait le quota Gemini et la durée de la requête pour un bénéfice limité
//   (l'analyse "prévu vs réalisé" n'a de sens que pour les séances de la semaine en cours, voir
//   findAutoMatch — le calendrier/les stats (charge, zones) n'ont besoin que des métriques brutes,
//   pas d'un texte d'analyse). ai_analysis reste donc null pour les activités importées ici.
import { fetchStravaActivities, ensureValidStravaToken, toActivityRow } from '../../../lib/strava';
import { findAutoMatch } from '../../../lib/stravaMatch';
import { getAdminClient, loadAthleteContext } from '../../../lib/athleteContext';
import { checkRateLimit, RATE_LIMIT_MESSAGES } from '../../../lib/rateLimit';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Garde-fous (voir commentaire d'en-tête) : per_page=200 est le maximum autorisé par Strava,
// MAX_PAGES=15 plafonne donc à 3000 activités importées en un coup — largement suffisant pour
// "tout l'historique" de la quasi-totalité des athlètes, tout en bornant la durée de la requête
// et le nombre d'appels à l'API Strava (partagée entre tous les utilisateurs de l'app).
const PER_PAGE = 200;
const MAX_PAGES = 15;
const DB_CHUNK_SIZE = 200; // taille des lots d'insertion Supabase, pour éviter une requête géante

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });
  const { accessToken } = req.body || {};
  if (!accessToken) return res.status(400).json({ error: 'accessToken requis' });
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return res.status(503).json({ error: 'Supabase non configuré.' });
  }

  // Rate limit léger : c'est une opération lourde (jusqu'à 15 appels Strava + un import DB),
  // déclenchée par un clic explicite — on autorise 2 essais/5min par IP (assez pour un retry
  // après un souci réseau, pas assez pour un abus/spam du bouton).
  const { allowed, retryAfterSec } = checkRateLimit(req, { id: 'strava-sync', limit: 2, windowMs: 5 * 60_000 });
  if (!allowed) {
    return res.status(429).json({ error: RATE_LIMIT_MESSAGES.fr(retryAfterSec) });
  }

  try {
    const authClient = createClient(supabaseUrl, anonKey);
    const { data: userData, error: userError } = await authClient.auth.getUser(accessToken);
    if (userError || !userData?.user?.id) {
      return res.status(401).json({ error: 'Session invalide, reconnecte-toi puis réessaie.' });
    }
    const userId = userData.user.id;

    const admin = getAdminClient();

    const { data: tokenRow } = await admin
      .from('strava_tokens')
      .select('access_token, refresh_token, expires_at')
      .eq('user_id', userId)
      .maybeSingle();
    if (!tokenRow) {
      return res.status(400).json({ error: 'Aucun compte Strava lié pour le moment.' });
    }

    const { accessToken: stravaAccessToken, refreshToken, expiresAt, refreshed } = await ensureValidStravaToken({
      accessToken: tokenRow.access_token,
      refreshToken: tokenRow.refresh_token,
      expiresAt: tokenRow.expires_at,
    });
    if (refreshed) {
      await admin.from('strava_tokens').update({
        access_token: stravaAccessToken, refresh_token: refreshToken, expires_at: expiresAt, updated_at: new Date().toISOString(),
      }).eq('user_id', userId);
    }

    // 1) Récupère TOUT l'historique (pagination jusqu'à MAX_PAGES ou jusqu'à ce que Strava
    // renvoie moins d'une page pleine, signe qu'on a atteint la fin de l'historique).
    const allActivities = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      // eslint-disable-next-line no-await-in-loop
      const pageData = await fetchStravaActivities(stravaAccessToken, { page, perPage: PER_PAGE });
      if (!Array.isArray(pageData) || pageData.length === 0) break;
      allActivities.push(...pageData);
      if (pageData.length < PER_PAGE) break; // dernière page atteinte
    }

    if (allActivities.length === 0) {
      return res.status(200).json({ imported: 0, skipped: 0, totalFetched: 0 });
    }

    // 2) Ne garde que les activités PAS DÉJÀ connues (voir commentaire d'en-tête : jamais de
    // ré-écriture d'une activité existante depuis cette route).
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
      return res.status(200).json({ imported: 0, skipped: allActivities.length, totalFetched: allActivities.length });
    }

    // 3) Construit les lignes à insérer, avec correspondance calendrier (findAutoMatch) pour
    // les activités qui tombent sur une séance de la semaine N — voir lib/stravaMatch.js pour
    // la limite connue de cette correspondance (elle ne porte que sur workouts.N).
    const { workouts } = await loadAthleteContext(admin, userId);
    const rows = missingActivities.map((raw) => {
      const row = toActivityRow(raw, userId);
      const { weekKey, workoutId } = findAutoMatch(row, workouts);
      return {
        ...row,
        matched_week_key: weekKey,
        matched_workout_id: workoutId,
        match_source: weekKey ? 'auto' : 'none',
        // 'skipped' explicitement (pas le défaut 'pending' de la colonne) : 'pending' est
        // interprété par ActivityDetail.js comme "analyse en cours de génération", ce qui
        // serait trompeur ici puisque rien ne va jamais relancer cette analyse pour un import
        // en masse (voir commentaire d'en-tête) — l'athlète verrait un message d'attente
        // qui ne se résout jamais.
        ai_analysis_status: 'skipped',
      };
    });

    // 4) Insertion par lots. `upsert` avec `ignoreDuplicates` plutôt qu'un `insert` simple : si
    // une activité a été créée entre l'étape 2 (lecture des ids existants) et maintenant (ex:
    // webhook déclenché en parallèle sur une activité toute récente), on ne veut pas planter sur
    // un conflit de clé primaire — on l'ignore simplement, elle est déjà là.
    let imported = 0;
    for (let i = 0; i < rows.length; i += DB_CHUNK_SIZE) {
      const chunk = rows.slice(i, i + DB_CHUNK_SIZE);
      // eslint-disable-next-line no-await-in-loop
      const { error: insertError, count } = await admin
        .from('strava_activities')
        .upsert(chunk, { onConflict: 'id', ignoreDuplicates: true, count: 'exact' });
      if (insertError) {
        console.error('[api/strava/sync] insert error:', insertError);
        // On continue avec les lots suivants plutôt que d'abandonner tout l'import sur un
        // seul lot en échec — l'athlète verra le compte réel importé, pas zéro.
        continue;
      }
      imported += count ?? chunk.length;
    }

    return res.status(200).json({
      imported,
      skipped: allActivities.length - missingActivities.length,
      totalFetched: allActivities.length,
    });
  } catch (e) {
    console.error('[api/strava/sync] error:', e?.message || e);
    return res.status(500).json({ error: "L'import Strava a échoué. Réessaie dans un instant." });
  }
}
