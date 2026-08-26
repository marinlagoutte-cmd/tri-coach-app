// pages/api/strava/streams.js
//
// Charge les courbes détaillées (tracé GPS, allure, FC, puissance...) d'UNE
// activité, uniquement À LA DEMANDE quand l'athlète ouvre son détail (voir
// ActivityDetail.js) — pas au moment de la réception webhook, pour ménager le
// quota Strava (100 req/15min, 1000/jour par défaut). Le résultat est mis en
// cache dans strava_activities.streams pour ne pas re-consommer le quota à
// chaque réouverture du même détail.
import { createClient } from '@supabase/supabase-js';
import { ensureValidStravaToken, fetchStravaActivityStreams } from '../../../lib/strava';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });
  const { accessToken, activityId } = req.body || {};
  if (!accessToken || !activityId) return res.status(400).json({ error: 'accessToken et activityId requis' });
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return res.status(503).json({ error: 'Supabase non configuré.' });

  try {
    const authClient = createClient(supabaseUrl, anonKey);
    const { data: userData, error: userError } = await authClient.auth.getUser(accessToken);
    if (userError || !userData?.user?.id) return res.status(401).json({ error: 'Session invalide, reconnecte-toi puis réessaie.' });
    const userId = userData.user.id;

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

    // Sécurité : vérifie que cette activité appartient bien à l'utilisateur qui demande,
    // et retourne le cache s'il existe déjà (évite un appel Strava inutile).
    const { data: activityRow } = await admin
      .from('strava_activities')
      .select('user_id, streams')
      .eq('id', activityId)
      .maybeSingle();
    if (!activityRow || activityRow.user_id !== userId) {
      return res.status(404).json({ error: 'Activité introuvable.' });
    }
    if (activityRow.streams) {
      return res.status(200).json({ streams: activityRow.streams, cached: true });
    }

    const { data: tokenRow } = await admin
      .from('strava_tokens')
      .select('access_token, refresh_token, expires_at')
      .eq('user_id', userId)
      .maybeSingle();
    if (!tokenRow) return res.status(409).json({ error: 'Aucun compte Strava lié.' });

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

    const streams = await fetchStravaActivityStreams(freshToken, activityId);
    await admin.from('strava_activities').update({ streams }).eq('id', activityId);

    return res.status(200).json({ streams, cached: false });
  } catch (e) {
    console.error('[api/strava/streams] error:', e?.message || e);
    const status = e?.status === 404 ? 404 : 500;
    return res.status(status).json({ error: 'Impossible de charger le détail de cette activité.' });
  }
}
