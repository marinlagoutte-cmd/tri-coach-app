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
import { ensureValidStravaToken } from '../../../lib/strava';
import { getAdminClient } from '../../../lib/athleteContext';
import { importStravaActivities } from '../../../lib/stravaSync';
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

    // Import proprement dit (pagination, dédoublonnage, correspondance calendrier, insertion
    // par lots, kilométrage matériel) — logique PARTAGÉE avec le cron horaire, voir
    // lib/stravaSync.js. `windowStart` = fenêtre 12 semaines calculée plus haut.
    const first = await importStravaActivities({
      admin, userId, stravaAccessToken, afterEpochSec: windowStart, perPage: PER_PAGE, maxPages: MAX_PAGES,
    });

    // GARDE-FOU VOLUME (voir commentaire d'en-tête) : si même sur 12 semaines le volume est
    // anormalement élevé (`reachedMaxPages`, ou déjà au-delà du seuil sur les pages lues), on
    // se recentre sur les 7 derniers jours plutôt que de tout importer d'un coup — un nouvel
    // appel à `importStravaActivities` sur la fenêtre courte écrase les résultats du premier.
    let result = first;
    let limitedToRecentWindow = false;
    if (first.totalFetched > MAX_ACTIVITIES_ONE_WINDOW || first.reachedMaxPages) {
      limitedToRecentWindow = true;
      result = await importStravaActivities({
        admin, userId, stravaAccessToken, afterEpochSec: fallbackWindowStart, perPage: PER_PAGE, maxPages: MAX_PAGES,
      });
    }

    return res.status(200).json({
      imported: result.imported,
      skipped: result.skipped,
      totalFetched: result.totalFetched,
      limitedToRecentWindow,
      equipmentSynced: result.equipmentSynced,
    });
  } catch (e) {
    console.error('[api/strava/sync] error:', e?.message || e);
    return res.status(500).json({ error: "L'import Strava a échoué. Réessaie dans un instant." });
  }
}
