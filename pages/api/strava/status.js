// pages/api/strava/status.js
//
// Indique si l'utilisateur courant a un compte Strava lié, SANS jamais renvoyer
// les jetons eux-mêmes au navigateur (lecture faite avec la clé service_role,
// qui contourne RLS, précisément pour ne pas avoir à l'exposer côté client).
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
    const { data } = await admin.from('strava_tokens').select('athlete_id, scope').eq('user_id', userData.user.id).maybeSingle();

    // profile:read_all est le scope qui permet à /athlete de renvoyer athlete.bikes/athlete.shoes
    // (donc le kilométrage matériel, voir lib/equipment.js) — Strava ne l'accorde JAMAIS
    // rétroactivement à un token déjà autorisé avant l'ajout de ce scope dans lib/stravaClient.js :
    // seule une déconnexion/reconnexion Strava (nouveau flux OAuth) l'obtient. On expose donc
    // explicitement son absence ici pour que l'UI (SettingsModal.js) puisse le signaler, plutôt
    // que de laisser l'athlète constater silencieusement un kilométrage matériel bloqué à 0.
    const scope = data?.scope || '';
    const missingProfileScope = Boolean(data) && !scope.split(',').map((s) => s.trim()).includes('profile:read_all');

    return res.status(200).json({ connected: Boolean(data), athleteId: data?.athlete_id || null, missingProfileScope });
  } catch (e) {
    console.error('[api/strava/status] error:', e?.message || e);
    return res.status(200).json({ connected: false });
  }
}
