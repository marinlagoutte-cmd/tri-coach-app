// pages/api/wearables/status.js
//
// Indique si l'utilisateur courant a un objet connecté (Whoop/Oura) lié, SANS jamais
// renvoyer les jetons au navigateur — même mécanique que pages/api/strava/status.js.
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });
  const { accessToken } = req.body || {};
  if (!accessToken) return res.status(400).json({ error: 'accessToken requis' });
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return res.status(200).json({ connected: false });

  try {
    const authClient = createClient(supabaseUrl, anonKey);
    const { data: userData, error: userError } = await authClient.auth.getUser(accessToken);
    if (userError || !userData?.user?.id) return res.status(200).json({ connected: false });

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data } = await admin.from('wearable_tokens').select('provider').eq('user_id', userData.user.id).maybeSingle();

    return res.status(200).json({ connected: Boolean(data), provider: data?.provider || null });
  } catch (e) {
    console.error('[api/wearables/status] error:', e?.message || e);
    return res.status(200).json({ connected: false });
  }
}
