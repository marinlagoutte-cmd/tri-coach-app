// pages/api/wearables/sync.js
//
// Va chercher les N derniers jours de récupération (HRV, FC repos) et de sommeil auprès du
// fournisseur connecté (Whoop ou Oura, voir lib/wearablesServer.js), et renvoie un tableau
// normalisé au client. La PERSISTANCE se fait côté client dans STORAGE_KEYS.healthHistory
// (voir components/ProfileHealth.js:handleWearableSync) — ce endpoint ne fait QUE lire chez
// le fournisseur, il n'écrit rien d'autre que rafraîchir le jeton si besoin.
import { createClient } from '@supabase/supabase-js';
import { PROVIDER_ADAPTERS, ensureValidWearableToken } from '../../../lib/wearablesServer';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SYNC_WINDOW_DAYS = 14;

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
    const { data: tokenRow } = await admin.from('wearable_tokens').select('provider, access_token, refresh_token, expires_at').eq('user_id', userId).maybeSingle();
    if (!tokenRow) return res.status(404).json({ error: 'Aucun objet connecté (Whoop/Oura) lié à ce compte.' });

    const adapter = PROVIDER_ADAPTERS[tokenRow.provider];
    if (!adapter) return res.status(500).json({ error: 'Fournisseur non reconnu.' });

    const { accessToken: freshToken, refreshToken, expiresAt, refreshed } = await ensureValidWearableToken(tokenRow.provider, {
      accessToken: tokenRow.access_token,
      refreshToken: tokenRow.refresh_token,
      expiresAt: tokenRow.expires_at,
    });
    if (refreshed) {
      await admin.from('wearable_tokens').update({
        access_token: freshToken, refresh_token: refreshToken, expires_at: expiresAt, updated_at: new Date().toISOString(),
      }).eq('user_id', userId);
    }

    const since = new Date(Date.now() - SYNC_WINDOW_DAYS * 24 * 3600 * 1000).toISOString();
    const days = await adapter.fetchDaily(freshToken, since);

    return res.status(200).json({ provider: tokenRow.provider, days });
  } catch (e) {
    console.error('[api/wearables/sync] error:', e?.message || e);
    const status = e?.status === 401 ? 401 : 500;
    return res.status(status).json({ error: status === 401 ? "L'autorisation a expiré ou a été révoquée côté fournisseur — reconnecte-toi dans Réglages." : 'La synchronisation a échoué.' });
  }
}
