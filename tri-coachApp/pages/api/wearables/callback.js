// pages/api/wearables/callback.js
//
// Point de retour de l'autorisation Whoop/Oura (redirect_uri déclaré dans la config de
// l'appli développeur du fournisseur, voir WEARABLES_SETUP.md). Reçoit le `code` OAuth et
// le `state` (= `${access_token Supabase}::${provider}`, transmis via buildWearableAuthUrl
// côté client dans SettingsModal.js), échange le code contre des jetons, puis les stocke
// liés à cet utilisateur — même mécanique que pages/api/strava/callback.js.
//
// Toujours une redirection en fin de route (jamais un JSON brut) : ouvert directement dans
// le navigateur par la redirection du fournisseur, pas appelé en fetch().
import { createClient } from '@supabase/supabase-js';
import { PROVIDER_ADAPTERS, isWearableProviderConfigured } from '../../../lib/wearablesServer';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function redirectWithStatus(res, status) {
  // Lu par pages/index.js (même paramètre `wearable=...` que `strava=...`) pour afficher
  // un toast de confirmation/erreur.
  res.writeHead(302, { Location: `/?wearable=${status}` });
  res.end();
}

export default async function handler(req, res) {
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return redirectWithStatus(res, 'not_configured');

  const { code, state, error } = req.query;
  if (error) return redirectWithStatus(res, 'denied');
  if (!code || !state) return redirectWithStatus(res, 'error');

  const [supabaseToken, provider] = String(state).split('::');
  const adapter = PROVIDER_ADAPTERS[provider];
  if (!adapter || !isWearableProviderConfigured(provider)) return redirectWithStatus(res, 'not_configured');

  try {
    const authClient = createClient(supabaseUrl, anonKey);
    const { data: userData, error: userError } = await authClient.auth.getUser(supabaseToken);
    if (userError || !userData?.user?.id) return redirectWithStatus(res, 'session_expired');
    const userId = userData.user.id;

    const redirectUri = `${process.env.NEXT_PUBLIC_SITE_URL || `https://${req.headers.host}`}/api/wearables/callback`;
    const tokenData = await adapter.exchangeCode(String(code), redirectUri);
    if (!tokenData?.access_token) return redirectWithStatus(res, 'error');

    const nowSec = Math.floor(Date.now() / 1000);
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { error: upsertError } = await admin.from('wearable_tokens').upsert(
      {
        user_id: userId,
        provider,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || null,
        expires_at: tokenData.expires_in ? nowSec + tokenData.expires_in : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );
    if (upsertError) {
      console.error('[api/wearables/callback] upsert error:', upsertError);
      return redirectWithStatus(res, 'error');
    }

    return redirectWithStatus(res, 'connected');
  } catch (e) {
    console.error('[api/wearables/callback] error:', e?.message || e);
    return redirectWithStatus(res, 'error');
  }
}
