// pages/api/wearables/disconnect.js
//
// Coupe le lien Whoop/Oura : supprime la ligne wearable_tokens. Les valeurs déjà
// synchronisées dans healthHistory (vfc/sommeil) sont volontairement CONSERVÉES —
// même raisonnement que pages/api/strava/disconnect.js pour les activités.
import { createClient } from '@supabase/supabase-js';

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

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { error: deleteError } = await admin.from('wearable_tokens').delete().eq('user_id', userData.user.id);
    if (deleteError) {
      console.error('[api/wearables/disconnect] delete error:', deleteError);
      return res.status(500).json({ error: 'La déconnexion a échoué. Réessaie.' });
    }

    return res.status(200).json({ success: true });
  } catch (e) {
    console.error('[api/wearables/disconnect] error:', e?.message || e);
    return res.status(500).json({ error: 'Erreur inattendue.' });
  }
}
