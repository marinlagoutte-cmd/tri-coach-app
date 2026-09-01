// pages/api/strava/sync.js
//
// Import manuel de l'historique RÉCENT Strava de l'athlète, déclenché depuis Réglages >
// Strava (bouton "Importer mes activités récentes"). Complète le webhook
// (pages/api/strava/webhook.js), qui ne reçoit que les NOUVELLES activités à partir du
// moment où le compte est lié — sans ce bouton, une activité enregistrée AVANT la liaison
// (ou pendant une période où le webhook aurait raté un événement) n'apparaît jamais.
//
// FENÊTRE D'IMPORT (volontairement restreinte, pas "tout l'historique") : glissante sur
// les 12 DERNIÈRES SEMAINES (84 jours). Alignée sur le graphe "Progression" de l'onglet
// Objectif (components/WeeklyProgressChart.js, computeWeeklySportSeries { weeks: 12 }) :
// avant, la fenêtre d'import (30 jours) était plus courte que les 12 semaines affichées
// par ce graphe, qui restait donc incomplet (~4 semaines sur 12) pour un athlète venant
// de lier son compte, tant que le webhook n'avait pas eu le temps d'accumuler le reste via
// les nouvelles activités. `sinceEpochSec` (minuit il y a 84 jours) est calculé CÔTÉ CLIENT
// par SettingsModal.js (voir getLocalDayStartEpochSec dans lib/stravaMatch.js) — le serveur
// Vercel tourne en UTC et n'a aucune notion fiable du fuseau horaire réel de l'athlète, donc
// ce repère doit venir du navigateur.
// GARDE-FOU VOLUME : si malgré cette fenêtre de 12 semaines le nombre d'activités récupérées
// dépasse MAX_ACTIVITIES_ONE_WINDOW (cas d'un athlète multi-sports très actif, ou d'une
// anomalie), on se recentre automatiquement sur les 7 DERNIERS JOURS seulement
// (`limitedToRecentWindow: true` dans la réponse, affiché à l'athlète).
//
// Différences volontaires avec le traitement du webhook (voir handleActivityUpsert) :
// - Utilise l'endpoint LISTE (/athlete/activities, fetchStravaActivities, avec `after`)
//   plutôt qu'un fetch détaillé par activité : un "SummaryActivity" contient déjà tous
//   les champs utilisés par toActivityRow.
// - N'IMPORTE QUE les activités absentes de strava_activities (jamais de ré-écriture d'une
//   activité déjà connue) : ça préserve les corrections manuelles de correspondance déjà faites
//   (ActivityDetail.js) et n'interfère jamais avec ce que le webhook a déjà traité.
// - Ne lance PAS l'analyse IA (analyzeStravaActivity) sur chaque activité importée : le
//   calendrier/les stats (charge, zones) n'ont besoin que des métriques brutes, pas d'un
//   texte d'analyse. ai_analysis reste donc null pour les activités importées ici.
import { fetchStravaActivities, ensureValidStravaToken, toActivityRow } from '../../../lib/strava';
import { findAutoMatch } from '../../../lib/stravaMatch';
import { getAdminClient, loadAthleteContext } from '../../../lib/athleteContext';
import { syncEquipmentFromStrava } from '../../../lib/equipment';
import { checkRateLimit, RATE_LIMIT_MESSAGES } from '../../../lib/rateLimit';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SECONDS_PER_DAY = 24 * 60 * 60;
const IMPORT_WINDOW_DAYS = 84; // 12 semaines calendaires
const FALLBACK_WINDOW_DAYS = 7;

// La fenêtre (12 semaines) peut nécessiter plus d'une page pour un athlète très chargé
// (contrairement à l'ancienne fenêtre d'1 mois) — MAX_PAGES relevé en conséquence pour ne
// pas tronquer un import légitime avant le garde-fou volume ci-dessous.
const PER_PAGE = 200;
const MAX_PAGES = 5;
const DB_CHUNK_SIZE = 200; // taille des lots d'insertion Supabase, pour éviter une requête géante
// Seuil arbitraire mais généreux (bien plus que 12 semaines d'entraînement normal, même
// pour un triathlète en grosse charge — jusqu'à ~4-5 séances/jour tous sports confondus,
// soit ~350-420 sur 12 semaines) : au-delà, on suppose un cas hors norme et on se recentre
// sur les 7 derniers jours plutôt que de tout importer d'un coup.
const MAX_ACTIVITIES_ONE_WINDOW = 420;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });
  const { accessToken, sinceEpochSec, weekStartEpochSec } = req.body || {};
  if (!accessToken) return res.status(400).json({ error: 'accessToken requis' });
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return res.status(503).json({ error: 'Supabase non configuré.' });
  }

  // Repli si le client n'a pas transmis le repère (ancien build en cache, appel manuel...) :
  // on recalcule côté serveur en UTC — moins précis pour un athlète très décalé de l'UTC
  // (minuit pourrait être décalé de quelques heures), mais jamais bloquant.
  // `weekStartEpochSec` (ancien nom du paramètre, semaine calendaire) est encore accepté en
  // repli pour ne pas casser un client resté sur un build en cache le temps du déploiement.
  const windowStart = Number.isFinite(sinceEpochSec)
    ? sinceEpochSec
    : Number.isFinite(weekStartEpochSec)
    ? weekStartEpochSec
    : Math.floor(Date.now() / 1000) - IMPORT_WINDOW_DAYS * SECONDS_PER_DAY;
  const fallbackWindowStart = Math.floor(Date.now() / 1000) - FALLBACK_WINDOW_DAYS * SECONDS_PER_DAY;

  // Rate limit léger : opération déclenchée par un clic explicite — on autorise 2 essais/5min
  // par IP (assez pour un retry après un souci réseau, pas assez pour un abus/spam du bouton).
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

    // 1) Récupère les activités depuis le début de la semaine PRÉCÉDENTE (`after` filtre déjà
    // côté Strava, donc pagination = garde-fou de sécurité plus que dimensionnement réel — voir
    // commentaire d'en-tête). Pagination jusqu'à MAX_PAGES ou jusqu'à ce que Strava renvoie
    // moins d'une page pleine, signe qu'on a atteint la fin de la fenêtre demandée.
    let allActivities = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      // eslint-disable-next-line no-await-in-loop
      const pageData = await fetchStravaActivities(stravaAccessToken, { page, perPage: PER_PAGE, afterEpochSec: windowStart });
      if (!Array.isArray(pageData) || pageData.length === 0) break;
      allActivities.push(...pageData);
      if (pageData.length < PER_PAGE) break; // dernière page atteinte
    }

    // Diagnostic temporaire (26/08) : à retirer une fois le blocage résolu.
    console.log('[api/strava/sync] fenêtre :', {
      windowStart,
      windowStartISO: new Date(windowStart * 1000).toISOString(),
    });
    console.log('[api/strava/sync] activités reçues de Strava :', allActivities.length,
      allActivities.slice(0, 5).map((a) => ({ id: a.id, name: a.name, start_date: a.start_date })));

    // GARDE-FOU VOLUME (voir commentaire d'en-tête) : si même sur 12 semaines le volume est
    // anormalement élevé, on se recentre sur les 7 derniers jours plutôt que de tout
    // importer d'un coup — `raw.start_date` (horodatage UTC réel Strava) comparé à
    // `fallbackWindowStart` (calculé côté serveur, l'imprécision de fuseau horaire est ici
    // sans conséquence puisqu'il ne s'agit que d'un garde-fou de volume).
    let limitedToRecentWindow = false;
    if (allActivities.length > MAX_ACTIVITIES_ONE_WINDOW) {
      limitedToRecentWindow = true;
      allActivities = allActivities.filter((a) => {
        const t = Date.parse(a.start_date || a.start_date_local || '');
        return Number.isFinite(t) && Math.floor(t / 1000) >= fallbackWindowStart;
      });
    }

    if (allActivities.length === 0) {
      return res.status(200).json({ imported: 0, skipped: 0, totalFetched: 0, limitedToRecentWindow });
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
    console.log('[api/strava/sync] déjà connues :', existingIds.size, '/ nouvelles :', missingActivities.length);

    if (missingActivities.length === 0) {
      return res.status(200).json({ imported: 0, skipped: allActivities.length, totalFetched: allActivities.length, limitedToRecentWindow });
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

    // Rafraîchit le kilométrage matériel (vélos/chaussures) — best-effort, ne doit jamais faire
    // échouer la réponse de l'import lui-même (voir lib/equipment.js).
    let equipmentSynced = 0;
    try {
      const { synced } = await syncEquipmentFromStrava(admin, userId, stravaAccessToken);
      equipmentSynced = synced;
    } catch (e) {
      console.error('[api/strava/sync] equipment sync error:', e?.message || e);
    }

    return res.status(200).json({
      imported,
      skipped: allActivities.length - missingActivities.length,
      totalFetched: allActivities.length,
      limitedToRecentWindow,
      equipmentSynced,
    });
  } catch (e) {
    console.error('[api/strava/sync] error:', e?.message || e);
    return res.status(500).json({ error: "L'import Strava a échoué. Réessaie dans un instant." });
  }
}
