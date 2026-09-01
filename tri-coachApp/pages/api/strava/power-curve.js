// pages/api/strava/power-curve.js
//
// Calcule la courbe de puissance vélo (meilleurs efforts 5s/1min/5min/20min, voir
// lib/powerCurve.js) + les records personnels course à pied / natation, à partir des
// activités RÉELLEMENT synchronisées (table strava_activities).
//
// La courbe de puissance a besoin des streams détaillés (watts seconde par seconde), pas
// seulement de la moyenne globale d'une sortie — or les streams ne sont aujourd'hui mis en
// cache QUE quand l'athlète ouvre le détail d'une activité (voir pages/api/strava/streams.js,
// pour ménager le quota Strava). Pour que la courbe soit utile sans que l'athlète ait à
// ouvrir manuellement chaque sortie, cet endpoint complète le cache de façon BORNÉE (au plus
// MAX_BACKFILL activités par appel, les plus prometteuses : les plus longues et/ou watts
// moyens les plus élevés) avant de calculer — jamais toutes les activités d'un coup, pour
// rester sous la limite Strava (100 requêtes / 15min, 1000/jour par défaut). Les activités
// déjà en cache ou déjà backfillées lors d'un appel précédent s'accumulent donc au fil des
// rafraîchissements successifs plutôt que d'être re-consommées à chaque fois.
import { createClient } from '@supabase/supabase-js';
import { ensureValidStravaToken, fetchStravaActivityStreams } from '../../../lib/strava';
import { computePowerCurve, computeRunPRs, computeSwimPRs, estimateFtpFromPowerCurve, POWER_CURVE_DURATIONS } from '../../../lib/powerCurve';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Nombre max de streams récupérés depuis Strava en un seul appel de cet endpoint — le
// reste du cache se complète progressivement à chaque nouvelle visite de l'onglet.
const MAX_BACKFILL = 12;
// Seule une activité vélo d'au moins 5min a une chance de contenir un "meilleur 5min" —
// inutile de consommer le quota Strava sur des sorties trop courtes pour la plus petite
// durée qui nous intéresse au-delà du 5s/1min (déjà couverts par des sorties courtes aussi).
const MIN_DURATION_FOR_BACKFILL_S = 60;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });
  const { accessToken } = req.body || {};
  if (!accessToken) return res.status(400).json({ error: 'accessToken requis' });
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return res.status(503).json({ error: 'Supabase non configuré.' });

  try {
    const authClient = createClient(supabaseUrl, anonKey);
    const { data: userData, error: userError } = await authClient.auth.getUser(accessToken);
    if (userError || !userData?.user?.id) return res.status(401).json({ error: 'Session invalide, reconnecte-toi puis réessaie.' });
    const userId = userData.user.id;

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

    // Toutes les activités (vélo + course + natation) sur une fenêtre large : les records
    // course/natation n'ont pas besoin de streams (juste distance/temps de la table déjà
    // synchronisée), seul le vélo a besoin du détail seconde par seconde.
    const { data: activities, error: actError } = await admin
      .from('strava_activities')
      .select('id, sport_type, name, start_date, start_date_local, distance_m, moving_time_s, average_watts, streams')
      .eq('user_id', userId)
      .order('start_date', { ascending: false })
      .limit(500);
    if (actError) return res.status(500).json({ error: 'Impossible de lire les activités.' });

    const rides = (activities || []).filter((a) => /ride|bike|cycl|virtualride|handcycle|velomobile/i.test(a.sport_type || ''));

    // Sorties déjà en cache (streams non nul) : utilisées telles quelles.
    const cached = rides.filter((a) => a.streams);
    // Candidates au backfill : pas encore en cache, assez longues pour être utiles, triées
    // par watts moyen puis durée décroissants (les plus susceptibles de contenir un record).
    const candidates = rides
      .filter((a) => !a.streams && a.moving_time_s >= MIN_DURATION_FOR_BACKFILL_S)
      .sort((a, b) => (b.average_watts || 0) - (a.average_watts || 0) || (b.moving_time_s || 0) - (a.moving_time_s || 0))
      .slice(0, MAX_BACKFILL);

    let backfilled = [];
    if (candidates.length > 0) {
      const { data: tokenRow } = await admin
        .from('strava_tokens')
        .select('access_token, refresh_token, expires_at')
        .eq('user_id', userId)
        .maybeSingle();

      if (tokenRow) {
        const { accessToken: freshToken, refreshToken, expiresAt, refreshed } = await ensureValidStravaToken({
          accessToken: tokenRow.access_token,
          refreshToken: tokenRow.refresh_token,
          expiresAt: tokenRow.expires_at,
        });
        if (refreshed) {
          await admin.from('strava_tokens').update({
            access_token: freshToken, refresh_token: refreshToken, expires_at: expiresAt, updated_at: new Date().toISOString(),
          }).eq('user_id', userId);
        }

        for (const act of candidates) {
          try {
            // eslint-disable-next-line no-await-in-loop
            const streams = await fetchStravaActivityStreams(freshToken, act.id);
            // eslint-disable-next-line no-await-in-loop
            await admin.from('strava_activities').update({ streams }).eq('id', act.id);
            backfilled.push({ ...act, streams });
          } catch (e) {
            // Une activité individuelle qui échoue (ex: pas de capteur watts sur celle-ci,
            // Strava renvoie alors un stream sans clé "watts") ne doit pas interrompre les
            // suivantes — lib/powerCurve.js ignore de toute façon un stream sans watts.
            console.error(`[power-curve] backfill activité ${act.id} échoué:`, e?.message || e);
          }
        }
      }
    }

    const allWithStreams = [...cached, ...backfilled];
    const powerBests = computePowerCurve(allWithStreams);
    const ftpEstimate = estimateFtpFromPowerCurve(powerBests);
    const runPRs = computeRunPRs(activities);
    const swimPRs = computeSwimPRs(activities);

    return res.status(200).json({
      powerBests,
      ftpEstimate,
      runPRs,
      swimPRs,
      coverage: {
        totalRides: rides.length,
        ridesWithStreams: allWithStreams.length,
        backfilledThisCall: backfilled.length,
        remainingToBackfill: Math.max(rides.filter((a) => !a.streams).length - backfilled.length, 0),
      },
      durations: POWER_CURVE_DURATIONS,
    });
  } catch (e) {
    console.error('[api/strava/power-curve] error:', e?.message || e);
    return res.status(500).json({ error: 'Impossible de calculer la courbe de puissance.' });
  }
}
