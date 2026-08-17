// pages/api/delete-account.js
//
// Suppression DÉFINITIVE d'un compte Tri Coach : efface la ligne cloud
// (tri_coach_data) puis le compte d'authentification lui-même. Nécessite la clé
// SERVICE ROLE Supabase (jamais NEXT_PUBLIC_, jamais envoyée au navigateur) — sans
// cette variable d'env, la suppression d'utilisateur Supabase Auth est impossible
// depuis le client (la clé "anon" ne permet pas de supprimer un compte).
//
// Variable à ajouter dans Vercel → Settings → Environment Variables :
//   SUPABASE_SERVICE_ROLE_KEY  →  Supabase → Project Settings → API → "service_role" (secret)
// Puis redéployer. Voir SUPABASE_SETUP.md.
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const { accessToken } = req.body || {};
  if (!accessToken) return res.status(400).json({ error: 'accessToken requis' });
  if (!supabaseUrl || !anonKey) return res.status(503).json({ error: 'Supabase non configuré.' });
  if (!serviceRoleKey) {
    return res.status(503).json({
      error: "Suppression de compte indisponible : SUPABASE_SERVICE_ROLE_KEY n'est pas configurée côté serveur (Vercel → Settings → Environment Variables), puis redéploie.",
    });
  }

  try {
    // 1) Identifie l'utilisateur à partir de son propre jeton (jamais un id fourni
    //    tel quel par le client, pour ne jamais permettre de supprimer un AUTRE compte).
    const authClient = createClient(supabaseUrl, anonKey);
    const { data: userData, error: userError } = await authClient.auth.getUser(accessToken);
    if (userError || !userData?.user?.id) {
      return res.status(401).json({ error: 'Session invalide, reconnecte-toi puis réessaie.' });
    }
    const userId = userData.user.id;

    // 2) Client admin (clé service_role) : seul moyen d'effacer la ligne cloud de
    //    façon certaine et de supprimer le compte d'authentification lui-même.
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

    const { error: dataError } = await admin.from('tri_coach_data').delete().eq('user_id', userId);
    if (dataError) console.error('[api/delete-account] erreur suppression données:', dataError);

    const { error: authDeleteError } = await admin.auth.admin.deleteUser(userId);
    if (authDeleteError) {
      console.error('[api/delete-account] erreur suppression compte:', authDeleteError);
      return res.status(500).json({ error: 'La suppression du compte a échoué. Réessaie.' });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('[api/delete-account] error:', error);
    return res.status(500).json({ error: 'Erreur inattendue lors de la suppression.' });
  }
}
