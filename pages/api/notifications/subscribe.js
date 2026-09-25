// pages/api/notifications/subscribe.js
//
// Enregistre l'abonnement Web Push de CET appareil pour l'utilisateur courant
// (table push_subscriptions). Même principe d'authentification que
// pages/api/delete-account.js : le client envoie son propre accessToken de
// session, jamais un user_id fourni tel quel — on ne fait confiance qu'à ce que
// Supabase Auth confirme à partir de ce jeton.
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const { accessToken, subscription } = req.body || {};
  if (!accessToken) return res.status(400).json({ error: 'accessToken requis' });
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return res.status(400).json({ error: 'subscription invalide' });
  }
  if (!supabaseUrl || !anonKey) return res.status(503).json({ error: 'Supabase non configuré.' });
  if (!serviceRoleKey) {
    return res.status(503).json({
      error: "Notifications indisponibles : SUPABASE_SERVICE_ROLE_KEY n'est pas configurée côté serveur.",
    });
  }

  try {
    const authClient = createClient(supabaseUrl, anonKey);
    const { data: userData, error: userError } = await authClient.auth.getUser(accessToken);
    if (userError || !userData?.user?.id) {
      return res.status(401).json({ error: 'Session invalide, reconnecte-toi puis réessaie.' });
    }
    const userId = userData.user.id;

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { error } = await admin
      .from('push_subscriptions')
      .upsert(
        {
          user_id: userId,
          endpoint: subscription.endpoint,
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth,
        },
        { onConflict: 'endpoint' }
      );
    if (error) {
      console.error('[api/notifications/subscribe] erreur upsert:', error);
      return res.status(500).json({ error: "Échec de l'enregistrement de l'abonnement." });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('[api/notifications/subscribe] error:', error);
    return res.status(500).json({ error: 'Erreur inattendue.' });
  }
}
