// pages/api/strava/disconnect.js
//
// Coupe le lien Strava : révoque le jeton côté Strava (best-effort, ne bloque
// pas la suite si ça échoue — voir handleDeleteAccount dans SettingsModal.js
// pour le même raisonnement) puis supprime la ligne strava_tokens. Les
// activités déjà importées (strava_activities) sont volontairement CONSERVÉES
// (historique déjà réalisé), seul le lien de synchronisation est coupé.
import { createClient } from '@supabase/supabase-js';
import { revokeStravaToken } from '../../../lib/strava';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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
    const { data: tokenRow } = await admin.from('strava_tokens').select('access_token').eq('user_id', userId).maybeSingle();

    if (tokenRow?.access_token) {
      try {
        await revokeStravaToken(tokenRow.access_token);
      } catch (e) {
        console.warn('[api/strava/disconnect] revoke Strava a échoué (ignoré) :', e?.message || e);
      }
    }

    const { error: deleteError } = await admin.from('strava_tokens').delete().eq('user_id', userId);
    if (deleteError) {
      console.error('[api/strava/disconnect] delete error:', deleteError);
      return res.status(500).json({ error: 'La déconnexion a échoué. Réessaie.' });
    }

    return res.status(200).json({ success: true });
  } catch (e) {
    console.error('[api/strava/disconnect] error:', e?.message || e);
    return res.status(500).json({ error: 'Erreur inattendue.' });
  }
}
