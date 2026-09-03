// pages/api/strava/equipment-sync.js
//
// Rafraîchissement matériel à la demande (bouton "Actualiser" dans Outils > Matériel) —
// séparé de pages/api/strava/sync.js (import d'activités) pour ne pas consommer son quota
// (2 essais/5min) ni re-déclencher un import d'activités juste pour relire un kilométrage.
// Le webhook et l'import manuel appellent déjà syncEquipmentFromStrava en tâche de fond
// (voir lib/equipment.js) — ce endpoint sert au cas où l'athlète veut un total à jour tout
// de suite (ex: vient de changer une pièce) sans attendre la prochaine activité/le prochain
// import.
import { ensureValidStravaToken } from '../../../lib/strava';
import { syncEquipmentFromStrava } from '../../../lib/equipment';
import { getAdminClient } from '../../../lib/athleteContext';
import { checkRateLimit, RATE_LIMIT_MESSAGES } from '../../../lib/rateLimit';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });
  const { accessToken } = req.body || {};
  if (!accessToken) return res.status(400).json({ error: 'accessToken requis' });
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return res.status(503).json({ error: 'Supabase non configuré.' });
  }

  const { allowed, retryAfterSec } = checkRateLimit(req, { id: 'equipment-sync', limit: 4, windowMs: 5 * 60_000 });
  if (!allowed) {
    return res.status(429).json({ error: RATE_LIMIT_MESSAGES.fr(retryAfterSec) });
  }

  try {
    const authClient = createClient(supabaseUrl, anonKey);
    const { data: userData, error: userError } = await authClient.auth.getUser(accessToken);
    if (userError || !userData?.user?.id) {
      return res.status(401).json({ error: 'Session invalide, reconnecte-toi puis réessaie.' });
    }
    const userId = userData.user.id;
    const admin = getAdminClient();

    const { data: tokenRow } = await admin
      .from('strava_tokens')
      .select('access_token, refresh_token, expires_at')
      .eq('user_id', userId)
      .maybeSingle();
    if (!tokenRow) {
      return res.status(400).json({ error: 'Aucun compte Strava lié pour le moment.' });
    }

    const { accessToken: stravaAccessToken, refreshToken, expiresAt, refreshed } = await ensureValidStravaToken({
      accessToken: tokenRow.access_token,
      refreshToken: tokenRow.refresh_token,
      expiresAt: tokenRow.expires_at,
    });
    if (refreshed) {
      await admin.from('strava_tokens').update({
        access_token: stravaAccessToken, refresh_token: refreshToken, expires_at: expiresAt, updated_at: new Date().toISOString(),
      }).eq('user_id', userId);
    }

    const { synced, error } = await syncEquipmentFromStrava(admin, userId, stravaAccessToken);
    if (error) return res.status(502).json({ error: "La synchronisation Strava a échoué. Réessaie dans un instant." });
    return res.status(200).json({ synced });
  } catch (e) {
    console.error('[api/strava/equipment-sync] error:', e?.message || e);
    return res.status(500).json({ error: "La synchronisation a échoué. Réessaie dans un instant." });
  }
}
