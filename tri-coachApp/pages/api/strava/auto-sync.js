// pages/api/strava/auto-sync.js
//
// Cible du cron Vercel horaire défini dans vercel.json — PAS un endpoint appelé par l'app.
// Tient à jour l'historique Strava de CHAQUE athlète lié, en arrière-plan, sans action de sa
// part. Répond à deux limites du système précédent (bouton manuel "Importer mes activités
// récentes" + webhook) :
//   1) Le bouton manuel n'importe que les 12 DERNIÈRES SEMAINES (voir sync.js) — un record
//      personnel plus ancien que ça (ex: meilleur temps 10km jamais réouvert depuis) n'était
//      donc JAMAIS visible dans l'onglet Records (components/PerformanceRecords.js), tant que
//      l'athlète ne cliquait pas lui-même sur cette fenêtre glissante à répétition.
//   2) Sans clic manuel régulier, une activité enregistrée pendant que le webhook aurait raté
//      un événement (panne ponctuelle Strava, etc.) restait invisible indéfiniment.
//
// STRATÉGIE PAR ATHLÈTE (voir migration supabase-migration-strava-autosync-2026-09.sql pour
// les colonnes `full_history_synced_at` / `last_synced_at`) :
//   - Tant que `full_history_synced_at` est vide : import de TOUT l'historique (aucune borne
//     `after`), par lots de pages bornés par le budget de requêtes ci-dessous — reprend là où
//     ça s'était arrêté à l'heure précédente (chaque page déjà connue est juste ignorée à
//     l'insertion, voir lib/stravaSync.js), jusqu'à atteindre la vraie fin de l'historique.
//   - Une fois complet : simple synchro incrémentale depuis `last_synced_at` à chaque passage.
//
// BUDGET DE REQUÊTES STRAVA (ne jamais consommer tout le quota app-wide — partagé entre TOUS
// les athlètes de l'app — 100 req/15min et 1000/jour par défaut, voir STRAVA_SETUP.md) :
// REQUEST_BUDGET_PER_RUN volontairement conservateur pour laisser de la marge à l'usage
// interactif (webhook temps réel, boutons "Actualiser" manuels, backfill des streams pour la
// courbe de puissance) qui tourne en parallèle. Chaque page listée = 1 requête Strava ; le
// rafraîchissement d'un token expiré en coûte 1 de plus par athlète concerné.
//
// FRÉQUENCE RÉELLE : vercel.json déclare "0 * * * *" (chaque heure). Sur le plan Vercel
// Hobby, les Cron Jobs sont limités à 1 exécution/JOUR maximum par entrée — si le déploiement
// d'un cron horaire est refusé pour cette raison, soit passer au plan Pro (crons illimités en
// fréquence), soit assouplir l'horaire ci-dessous (ex: "0 */6 * * *" = toutes les 6h) en
// attendant. Rien d'autre à changer côté code dans ce cas.
import { ensureValidStravaToken } from '../../../lib/strava';
import { getAdminClient } from '../../../lib/athleteContext';
import { importStravaActivities } from '../../../lib/stravaSync';

const REQUEST_BUDGET_PER_RUN = 30;
// Fenêtre d'historique complet : large (années d'activités), bornée par le budget de toute
// façon — voir boucle ci-dessous, qui s'arrête dès que le budget restant est trop faible pour
// une page de plus, indépendamment de cette valeur.
const FULL_HISTORY_MAX_PAGES = 15;
// Synchro incrémentale (athlète déjà en historique complet) : fenêtre courte, l'essentiel des
// activités depuis la dernière synchro tient sur 1-2 pages même pour un athlète très actif.
const INCREMENTAL_MAX_PAGES = 2;
const PER_PAGE = 200;
// Repli si `last_synced_at` est vide (ne devrait pas arriver une fois l'historique complet
// marqué, mais garde-fou) : 2 jours, largement suffisant pour ne rien perdre entre deux passages.
const INCREMENTAL_FALLBACK_DAYS = 2;

export default async function handler(req, res) {
  // Même garde-fou que pages/api/notifications/weekly-recap.js : Vercel signe automatiquement
  // ses propres invocations cron avec ce header dès que CRON_SECRET est configuré.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Non autorisé' });
  }

  const admin = getAdminClient();

  const { data: tokenRows, error: tokensError } = await admin
    .from('strava_tokens')
    .select('user_id, access_token, refresh_token, expires_at, full_history_synced_at, last_synced_at')
    // Priorité aux athlètes jamais entièrement synchronisés (NULL en premier), puis, à
    // égalité, aux moins récemment synchronisés — ça fait naturellement tourner l'attention
    // du cron entre plusieurs athlètes encore en historique complet d'une heure à l'autre
    // (voir mise à jour de `last_synced_at` en fin de boucle, même si l'historique n'est pas
    // fini) plutôt que de rester bloqué sur le premier de la liste à chaque passage.
    .order('full_history_synced_at', { ascending: true, nullsFirst: true })
    .order('last_synced_at', { ascending: true, nullsFirst: true });

  if (tokensError) {
    console.error('[api/strava/auto-sync] lecture strava_tokens échouée:', tokensError);
    return res.status(500).json({ error: 'Lecture des comptes Strava liés impossible.' });
  }
  if (!tokenRows || tokenRows.length === 0) {
    return res.status(200).json({ processed: 0, note: 'Aucun compte Strava lié.' });
  }

  let requestBudget = REQUEST_BUDGET_PER_RUN;
  const results = [];

  for (const tokenRow of tokenRows) {
    if (requestBudget <= 1) break; // garde au moins 1 requête de marge, sinon on s'arrête ici pour cette heure

    try {
      // eslint-disable-next-line no-await-in-loop
      const { accessToken, refreshToken, expiresAt, refreshed } = await ensureValidStravaToken({
        accessToken: tokenRow.access_token,
        refreshToken: tokenRow.refresh_token,
        expiresAt: tokenRow.expires_at,
      });
      if (refreshed) {
        requestBudget -= 1;
        // eslint-disable-next-line no-await-in-loop
        await admin.from('strava_tokens').update({
          access_token: accessToken, refresh_token: refreshToken, expires_at: expiresAt, updated_at: new Date().toISOString(),
        }).eq('user_id', tokenRow.user_id);
      }
      if (requestBudget <= 1) break;

      const isFullHistoryDone = Boolean(tokenRow.full_history_synced_at);
      const now = new Date();
      const nowIso = now.toISOString();

      let result;
      if (!isFullHistoryDone) {
        const maxPages = Math.max(1, Math.min(FULL_HISTORY_MAX_PAGES, requestBudget - 1));
        // eslint-disable-next-line no-await-in-loop
        result = await importStravaActivities({
          admin, userId: tokenRow.user_id, stravaAccessToken: accessToken,
          afterEpochSec: undefined, perPage: PER_PAGE, maxPages,
        });
        requestBudget -= result.pagesFetched;

        const update = { last_synced_at: nowIso };
        // `reachedMaxPages` false = Strava a renvoyé une page incomplète : on a bien atteint
        // la VRAIE fin de l'historique (pas juste la fin du budget de ce passage-ci).
        if (!result.reachedMaxPages) update.full_history_synced_at = nowIso;
        // eslint-disable-next-line no-await-in-loop
        await admin.from('strava_tokens').update(update).eq('user_id', tokenRow.user_id);

        results.push({ userId: tokenRow.user_id, mode: 'full-history', completed: !result.reachedMaxPages, ...result });
      } else {
        const lastSyncedEpoch = tokenRow.last_synced_at
          ? Math.floor(new Date(tokenRow.last_synced_at).getTime() / 1000)
          : Math.floor(now.getTime() / 1000) - INCREMENTAL_FALLBACK_DAYS * 24 * 60 * 60;
        const maxPages = Math.max(1, Math.min(INCREMENTAL_MAX_PAGES, requestBudget - 1));
        // eslint-disable-next-line no-await-in-loop
        result = await importStravaActivities({
          admin, userId: tokenRow.user_id, stravaAccessToken: accessToken,
          afterEpochSec: lastSyncedEpoch, perPage: PER_PAGE, maxPages,
        });
        requestBudget -= result.pagesFetched;

        // eslint-disable-next-line no-await-in-loop
        await admin.from('strava_tokens').update({ last_synced_at: nowIso }).eq('user_id', tokenRow.user_id);

        results.push({ userId: tokenRow.user_id, mode: 'incremental', ...result });
      }
    } catch (e) {
      // Un athlète qui échoue (token révoqué côté Strava, etc.) ne doit jamais bloquer les
      // suivants — on log et on continue avec le budget restant.
      console.error(`[api/strava/auto-sync] athlète ${tokenRow.user_id} échoué:`, e?.message || e);
      results.push({ userId: tokenRow.user_id, error: e?.message || String(e) });
    }
  }

  return res.status(200).json({
    processed: results.length,
    totalLinkedAthletes: tokenRows.length,
    requestBudgetUsed: REQUEST_BUDGET_PER_RUN - requestBudget,
    results,
  });
}
