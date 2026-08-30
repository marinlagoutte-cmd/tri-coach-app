// pages/api/notifications/unsubscribe.js
//
// Supprime l'abonnement Web Push de CET appareil (table push_subscriptions).
// Même principe d'authentification que subscribe.js/delete-account.js.
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const { accessToken, endpoint } = req.body || {};
  if (!accessToken) return res.status(400).json({ error: 'accessToken requis' });
  if (!endpoint) return res.status(400).json({ error: 'endpoint requis' });
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return res.status(503).json({ error: 'Supabase non configuré.' });
  }

  try {
    const authClient = createClient(supabaseUrl, anonKey);
    const { data: userData, error: userError } = await authClient.auth.getUser(accessToken);
    if (userError || !userData?.user?.id) {
      return res.status(401).json({ error: 'Session invalide, reconnecte-toi puis réessaie.' });
    }
    const userId = userData.user.id;

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
    // Filtre sur user_id ET endpoint : un utilisateur ne peut jamais supprimer
    // l'abonnement d'un AUTRE appareil/compte, même en devinant un endpoint.
    const { error } = await admin.from('push_subscriptions').delete().eq('user_id', userId).eq('endpoint', endpoint);
    if (error) {
      console.error('[api/notifications/unsubscribe] erreur delete:', error);
      return res.status(500).json({ error: 'Échec de la suppression.' });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('[api/notifications/unsubscribe] error:', error);
    return res.status(500).json({ error: 'Erreur inattendue.' });
  }
}
