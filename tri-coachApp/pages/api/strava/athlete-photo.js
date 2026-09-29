// pages/api/strava/athlete-photo.js
//
// Photo de profil Strava de l'athlète (champ `profile` de GET /athlete, 124×124). Utilisée
// pour l'avatar de l'en-tête quand l'athlète n'a pas choisi sa propre photo. Même
// authentification que equipment-sync.js : jeton Supabase → jetons Strava stockés côté
// serveur (jamais exposés au navigateur).
import { createClient } from '@supabase/supabase-js';
import { ensureValidStravaToken } from '../../../lib/strava';
import { getAdminClient } from '../../../lib/athleteContext';
import { checkRateLimit, RATE_LIMIT_MESSAGES } from '../../../lib/rateLimit';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

/** URL exploitable, ou null (Strava renvoie un chemin relatif « avatar/athlete/large.png » sans photo). */
export function usableStravaPhoto(athlete) {
  const url = athlete?.profile || athlete?.profile_medium || '';
  if (!/^https:\/\//.test(url) || /avatar\/athlete/i.test(url)) return null;
  return url;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });
  const { accessToken } = req.body || {};
  if (!accessToken) return res.status(400).json({ error: 'accessToken requis' });
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return res.status(200).json({ photoUrl: null });

  const { allowed, retryAfterSec } = checkRateLimit(req, { id: 'strava-photo', limit: 6, windowMs: 5 * 60_000 });
  if (!allowed) return res.status(429).json({ error: RATE_LIMIT_MESSAGES.fr(retryAfterSec) });

  try {
    const authClient = createClient(supabaseUrl, anonKey);
    const { data: userData, error: userError } = await authClient.auth.getUser(accessToken);
    if (userError || !userData?.user?.id) return res.status(401).json({ error: 'Session invalide.' });
    const userId = userData.user.id;
    const admin = getAdminClient();
    const { data: tokenRow } = await admin.from('strava_tokens').select('access_token, refresh_token, expires_at').eq('user_id', userId).maybeSingle();
    if (!tokenRow) return res.status(200).json({ photoUrl: null, connected: false });

    const token = await ensureValidStravaToken({ accessToken: tokenRow.access_token, refreshToken: tokenRow.refresh_token, expiresAt: tokenRow.expires_at });
    if (token.refreshed) {
      await admin.from('strava_tokens').update({
        access_token: token.accessToken, refresh_token: token.refreshToken, expires_at: token.expiresAt, updated_at: new Date().toISOString(),
      }).eq('user_id', userId);
    }
    const r = await fetch('https://www.strava.com/api/v3/athlete', { headers: { Authorization: `Bearer ${token.accessToken}` } });
    if (!r.ok) return res.status(200).json({ photoUrl: null, connected: true });
    const athlete = await r.json();
    return res.status(200).json({ photoUrl: usableStravaPhoto(athlete), connected: true, firstName: athlete?.firstname || null });
  } catch (e) {
    console.error('[api/strava/athlete-photo] error:', e?.message || e);
    return res.status(200).json({ photoUrl: null });
  }
}
