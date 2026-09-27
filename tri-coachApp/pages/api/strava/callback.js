// pages/api/strava/callback.js
//
// Point de retour de l'autorisation Strava (redirect_uri déclaré dans la
// config de ton appli Strava, voir STRAVA_SETUP.md). Reçoit le `code` OAuth
// et le `state` (= access_token Supabase de l'athlète, transmis via
// buildStravaAuthUrl côté client dans SettingsModal.js), échange le code
// contre des jetons Strava, puis les stocke liés à cet utilisateur.
//
// Toujours une redirection en fin de route (jamais un JSON brut) : ce endpoint
// est ouvert directement dans le navigateur par la redirection Strava, pas
// appelé en fetch().
import { createClient } from '@supabase/supabase-js';
import { exchangeStravaCode, isStravaConfigured } from '../../../lib/strava';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function redirectWithStatus(res, status) {
  // Redirige vers l'accueil avec un paramètre lu par pages/index.js pour
  // afficher un toast de confirmation/erreur (voir handleStravaCallbackParam).
  res.writeHead(302, { Location: `/?strava=${status}` });
  res.end();
}

export default async function handler(req, res) {
  if (!isStravaConfigured()) return redirectWithStatus(res, 'not_configured');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return redirectWithStatus(res, 'not_configured');

  const { code, state, error } = req.query;
  if (error) return redirectWithStatus(res, 'denied');
  if (!code || !state) return redirectWithStatus(res, 'error');

  try {
    // 1) Identifie l'utilisateur Tri Coach à partir de son propre jeton Supabase
    //    (jamais un user_id fourni tel quel), exactement comme delete-account.js.
    const authClient = createClient(supabaseUrl, anonKey);
    const { data: userData, error: userError } = await authClient.auth.getUser(String(state));
    if (userError || !userData?.user?.id) return redirectWithStatus(res, 'session_expired');
    const userId = userData.user.id;

    // 2) Échange le code contre les jetons Strava + athlete_id.
    const tokenData = await exchangeStravaCode(String(code));
    const athleteId = tokenData?.athlete?.id;
    if (!athleteId || !tokenData?.access_token) return redirectWithStatus(res, 'error');

    // 3) Stocke les jetons (clé service_role : ni le navigateur, ni RLS, n'y touchent).
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { error: upsertError } = await admin.from('strava_tokens').upsert(
      {
        user_id: userId,
        athlete_id: athleteId,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: tokenData.expires_at,
        // Le scope RÉELLEMENT accordé par Strava (tokenData.scope) — jamais une valeur codée
        // en dur : Strava peut accorder moins que demandé si l'athlète décoche des cases, et
        // ce champ sert de repère de diagnostic (aucune logique de l'app ne le relit pour
        // décider quoi que ce soit, l'application réelle des droits se fait par Strava
        // lui-même au niveau du token).
        scope: tokenData.scope || 'read,activity:read_all,profile:read_all',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );
    if (upsertError) {
      console.error('[api/strava/callback] upsert error:', upsertError);
      return redirectWithStatus(res, 'error');
    }

    return redirectWithStatus(res, 'connected');
  } catch (e) {
    console.error('[api/strava/callback] error:', e?.message || e);
    return redirectWithStatus(res, 'error');
  }
}
