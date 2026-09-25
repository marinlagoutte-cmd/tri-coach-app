// lib/wearablesServer.js
//
// Wrapper léger autour des API Whoop / Oura (OAuth2 + récupération/sommeil quotidiens),
// utilisé UNIQUEMENT côté serveur (pages/api/wearables/*.js) — même séparation stricte
// que lib/strava.js : les client_secret et tokens ne doivent jamais atteindre le navigateur.
//
// Variables d'environnement requises (voir WEARABLES_SETUP.md) :
//   NEXT_PUBLIC_WHOOP_CLIENT_ID / WHOOP_CLIENT_SECRET
//   NEXT_PUBLIC_OURA_CLIENT_ID  / OURA_CLIENT_SECRET
//
// ⚠️ Garmin n'est volontairement PAS implémenté ici : le "Garmin Health API" utilise OAuth
// 1.0a (jeton non expirable + signature par requête, mécanique différente de Whoop/Oura qui
// sont en OAuth2 standard) et nécessite un accord partenaire Garmin pour être activé. Plutôt
// que de livrer une intégration non vérifiable en conditions réelles, l'architecture ci-dessous
// est volontairement générique (un adaptateur par fournisseur, voir PROVIDER_ADAPTERS) pour
// qu'ajouter Garmin plus tard (une fois l'accès partenaire obtenu) se limite à écrire son
// adaptateur, sans toucher aux routes API ni à l'UI.
//
// ⚠️ Les noms de champs exacts des réponses Whoop/Oura ci-dessous reflètent la structure
// publique de leurs API au moment de l'écriture de ce fichier ; les deux fournisseurs font
// évoluer leurs API développeur de temps en temps — si `npm run dev` puis un test réel de
// connexion renvoie un champ manquant/renommé, ajuste uniquement les fonctions `normalize*`
// ci-dessous (le reste de l'app ne connaît que la forme normalisée `{ date, vfcMs,
// restingHr, sleepHours, sleepScore }`, jamais le format brut du fournisseur).

async function providerFetch(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* réponse non-JSON */ }
  if (!res.ok) {
    const err = new Error(data?.error_description || data?.message || `Wearable API error ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function isoDate(d) {
  return new Date(d).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------------------
// WHOOP
// ---------------------------------------------------------------------------------------
const WHOOP_TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';
const WHOOP_API_BASE = 'https://api.prod.whoop.com/developer/v1';

async function whoopExchangeCode(code, redirectUri) {
  const body = new URLSearchParams({
    client_id: process.env.NEXT_PUBLIC_WHOOP_CLIENT_ID,
    client_secret: process.env.WHOOP_CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });
  return providerFetch(WHOOP_TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
}

async function whoopRefreshToken(refreshToken) {
  const body = new URLSearchParams({
    client_id: process.env.NEXT_PUBLIC_WHOOP_CLIENT_ID,
    client_secret: process.env.WHOOP_CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: 'offline read:recovery read:sleep read:profile',
  });
  return providerFetch(WHOOP_TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
}

/** Récupère + normalise les N derniers jours de récupération (HRV, FC repos) et de sommeil
 * Whoop, fusionnés par date calendaire. `sinceISO` : date de début (ex: J-14). */
async function whoopFetchDaily(accessToken, sinceISO) {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const params = new URLSearchParams({ start: sinceISO, limit: '25' });

  const [recoveryRes, sleepRes] = await Promise.all([
    providerFetch(`${WHOOP_API_BASE}/recovery?${params.toString()}`, { headers }),
    providerFetch(`${WHOOP_API_BASE}/activity/sleep?${params.toString()}`, { headers }),
  ]);

  const byDate = {};
  (recoveryRes?.records || []).forEach((r) => {
    if (r.score_state !== 'SCORED' || !r.score) return;
    const date = isoDate(r.created_at);
    byDate[date] = {
      date,
      vfcMs: r.score.hrv_rmssd_milli ?? null,
      restingHr: r.score.resting_heart_rate ?? null,
      sleepHours: byDate[date]?.sleepHours ?? null,
      sleepScore: byDate[date]?.sleepScore ?? null,
    };
  });
  (sleepRes?.records || []).forEach((s) => {
    if (s.score_state !== 'SCORED' || !s.score) return;
    const date = isoDate(s.end || s.start);
    const stages = s.score.stage_summary || {};
    const totalMs = ['total_light_sleep_time_milli', 'total_slow_wave_sleep_time_milli', 'total_rem_sleep_time_milli']
      .reduce((sum, k) => sum + (stages[k] || 0), 0);
    byDate[date] = {
      date,
      vfcMs: byDate[date]?.vfcMs ?? null,
      restingHr: byDate[date]?.restingHr ?? null,
      sleepHours: totalMs ? Math.round((totalMs / 3600000) * 10) / 10 : null,
      sleepScore: s.score.sleep_performance_percentage ?? null,
    };
  });
  return Object.values(byDate);
}

// ---------------------------------------------------------------------------------------
// OURA
// ---------------------------------------------------------------------------------------
const OURA_TOKEN_URL = 'https://api.ouraring.com/oauth/token';
const OURA_API_BASE = 'https://api.ouraring.com/v2/usercollection';

async function ouraExchangeCode(code, redirectUri) {
  const body = new URLSearchParams({
    client_id: process.env.NEXT_PUBLIC_OURA_CLIENT_ID,
    client_secret: process.env.OURA_CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });
  return providerFetch(OURA_TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
}

async function ouraRefreshToken(refreshToken) {
  const body = new URLSearchParams({
    client_id: process.env.NEXT_PUBLIC_OURA_CLIENT_ID,
    client_secret: process.env.OURA_CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  return providerFetch(OURA_TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
}

async function ouraFetchDaily(accessToken, sinceISO) {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const params = new URLSearchParams({ start_date: sinceISO, end_date: isoDate(new Date()) });

  const [sleepRes, dailySleepRes] = await Promise.all([
    providerFetch(`${OURA_API_BASE}/sleep?${params.toString()}`, { headers }),
    providerFetch(`${OURA_API_BASE}/daily_sleep?${params.toString()}`, { headers }),
  ]);

  const byDate = {};
  (sleepRes?.data || []).forEach((s) => {
    const date = s.day;
    if (!date) return;
    byDate[date] = {
      date,
      vfcMs: s.average_hrv ?? null,
      restingHr: s.average_heart_rate ?? null,
      sleepHours: s.total_sleep_duration ? Math.round((s.total_sleep_duration / 3600) * 10) / 10 : null,
      sleepScore: byDate[date]?.sleepScore ?? null,
    };
  });
  (dailySleepRes?.data || []).forEach((d) => {
    const date = d.day;
    if (!date) return;
    byDate[date] = { ...(byDate[date] || { date, vfcMs: null, restingHr: null, sleepHours: null }), sleepScore: d.score ?? null };
  });
  return Object.values(byDate);
}

// ---------------------------------------------------------------------------------------
// Adaptateur commun (utilisé par les routes pages/api/wearables/*.js)
// ---------------------------------------------------------------------------------------
export const PROVIDER_ADAPTERS = {
  whoop: { exchangeCode: whoopExchangeCode, refreshToken: whoopRefreshToken, fetchDaily: whoopFetchDaily },
  oura: { exchangeCode: ouraExchangeCode, refreshToken: ouraRefreshToken, fetchDaily: ouraFetchDaily },
};

export function isWearableProviderConfigured(provider) {
  if (provider === 'whoop') return Boolean(process.env.NEXT_PUBLIC_WHOOP_CLIENT_ID && process.env.WHOOP_CLIENT_SECRET);
  if (provider === 'oura') return Boolean(process.env.NEXT_PUBLIC_OURA_CLIENT_ID && process.env.OURA_CLIENT_SECRET);
  return false;
}

/** Renvoie un access_token valide, en rafraîchissant d'abord si besoin (même logique que
 * lib/strava.js:ensureValidStravaToken). Si le fournisseur ne renvoie pas d'`expires_at`
 * (jeton longue durée), on ne tente jamais de refresh. */
export async function ensureValidWearableToken(provider, { accessToken, refreshToken, expiresAt }) {
  const adapter = PROVIDER_ADAPTERS[provider];
  if (!adapter) throw new Error(`Fournisseur inconnu: ${provider}`);
  const nowSec = Math.floor(Date.now() / 1000);
  if (!expiresAt || expiresAt - nowSec > 300) {
    return { accessToken, refreshToken, expiresAt, refreshed: false };
  }
  if (!refreshToken) return { accessToken, refreshToken, expiresAt, refreshed: false };
  const data = await adapter.refreshToken(refreshToken);
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresAt: data.expires_in ? nowSec + data.expires_in : null,
    refreshed: true,
  };
}
