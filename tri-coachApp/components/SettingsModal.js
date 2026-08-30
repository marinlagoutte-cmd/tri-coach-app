import React, { useEffect, useState } from 'react';
import { useI18n, SUPPORTED_LANGS } from '../lib/i18n';
import { useTheme } from '../lib/theme';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { STORAGE_KEYS } from '../lib/storage';
import { useZonesMode } from '../lib/zonesMode';
import { buildStravaAuthUrl, isStravaClientConfigured } from '../lib/stravaClient';
import { getCalendarWeekStartEpochSec } from '../lib/stravaMatch';
import AiDiagnosticsModal from './AiDiagnosticsModal';
// NOTE : le bloc Strava est masqué tant que NEXT_PUBLIC_STRAVA_CLIENT_ID n'est pas
// défini côté Vercel — voir STRAVA_SETUP.md.

export default function SettingsModal({ isOpen, onClose, session, onSignOut, onStravaSynced }) {
  const { t, lang, setLang } = useI18n();
  const { theme, setTheme } = useTheme();
  const { zonesMode, setZonesMode } = useZonesMode();
  const [confirming, setConfirming] = useState(false);
  // Panneau de diagnostic IA (Réglages → IA) — demande explicite de l'athlète : plus
  // aucun message technique du double-check Gemini+Groq affiché dans l'app, mais un
  // endroit dédié pour tester chaque modèle à la demande (voir AiDiagnosticsModal.js).
  const [aiDiagnosticsOpen, setAiDiagnosticsOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const [stravaStatus, setStravaStatus] = useState('loading'); // 'loading' | 'connected' | 'disconnected'
  const [stravaBusy, setStravaBusy] = useState(false);
  const [stravaError, setStravaError] = useState('');
  const [stravaSyncing, setStravaSyncing] = useState(false);
  const [stravaSyncMessage, setStravaSyncMessage] = useState('');

  useEffect(() => {
    if (!isOpen || !session?.access_token || !isStravaClientConfigured()) return;
    let cancelled = false;
    fetch('/api/strava/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken: session.access_token }),
    })
      .then((r) => r.json())
      .then((data) => { if (!cancelled) setStravaStatus(data?.connected ? 'connected' : 'disconnected'); })
      .catch(() => { if (!cancelled) setStravaStatus('disconnected'); });
    return () => { cancelled = true; };
  }, [isOpen, session?.access_token]);

  const handleStravaConnect = () => {
    if (!session?.access_token) return;
    const redirectUri = `${window.location.origin}/api/strava/callback`;
    window.location.href = buildStravaAuthUrl({ redirectUri, state: session.access_token });
  };

  const handleStravaDisconnect = async () => {
    if (!session?.access_token) return;
    setStravaBusy(true);
    setStravaError('');
    try {
      const res = await fetch('/api/strava/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: session.access_token }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'disconnect failed');
      setStravaStatus('disconnected');
    } catch (e) {
      setStravaError(t('settings.stravaDisconnectError'));
    } finally {
      setStravaBusy(false);
    }
  };

  const handleStravaSync = async () => {
    if (!session?.access_token) return;
    setStravaSyncing(true);
    setStravaError('');
    setStravaSyncMessage('');
    try {
      const res = await fetch('/api/strava/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // weekStartEpochSec (lundi 00:00:00 de la semaine en cours, DANS LE FUSEAU RÉEL de
        // l'athlète) borne l'import côté serveur à la semaine en cours + la précédente — voir
        // pages/api/strava/sync.js. Calculé ici plutôt que côté serveur (Vercel tourne en UTC).
        body: JSON.stringify({ accessToken: session.access_token, weekStartEpochSec: getCalendarWeekStartEpochSec(0) }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'sync failed');
      setStravaSyncMessage(t('settings.stravaSyncSuccess', { imported: data.imported || 0, skipped: data.skipped || 0, limited: data.limitedToCurrentWeek || false }));
      if (data.imported > 0 && onStravaSynced) onStravaSynced();
    } catch (e) {
      setStravaError(e.message || t('settings.stravaSyncError'));
    } finally {
      setStravaSyncing(false);
    }
  };

  if (!isOpen) return null;

  const confirmWord = t('settings.deleteConfirmWord');

  const handleDeleteAccount = async () => {
    if (!session?.access_token) return;
    setDeleting(true);
    setDeleteError('');
    try {
      const res = await fetch('/api/delete-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: session.access_token }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'delete failed');

      // À partir d'ici le compte ET les données cloud sont DÉJÀ supprimés côté serveur
      // (réponse 200 de /api/delete-account) : tout ce qui suit est un nettoyage local
      // "best effort" qui ne doit plus jamais faire échouer la suppression ni empêcher
      // le rechargement. BUG CORRIGÉ : ci-dessous, `supabase.auth.signOut()` peut rejeter
      // (le compte/la session viennent d'être supprimés côté serveur par la clé service_role,
      // donc le serveur d'auth peut répondre "session/utilisateur introuvable") — quand ça
      // arrivait, l'ancien code sautait direct au catch et ne rechargeait JAMAIS la page :
      // l'app restait affichée avec l'ancien state React (profil/plan/séances) toujours en
      // mémoire, et les effets d'auto-sauvegarde de pages/index.js réécrivaient alors ce
      // state périmé dans le localStorage qu'on venait juste de vider — d'où le compte qui
      // semblait "toujours connecté" et le plan qui "revenait" après une déconnexion forcée.
      try {
        await supabase.auth.signOut();
      } catch (signOutError) {
        // Ignoré volontairement : le compte est de toute façon déjà supprimé côté serveur.
      }

      // Efface tout ce qui est local (profil, plan, séances, chat, préférences...) ET la
      // session Supabase elle-même persistée sous sa propre clé (ex: "sb-<ref>-auth-token",
      // non couverte par STORAGE_KEYS) — au cas où signOut() aurait échoué à la nettoyer.
      try {
        Object.values(STORAGE_KEYS).forEach((key) => {
          try { localStorage.removeItem(key); } catch (e) { /* noop */ }
        });
        Object.keys(localStorage).forEach((key) => {
          if (key.startsWith('sb-')) {
            try { localStorage.removeItem(key); } catch (e) { /* noop */ }
          }
        });
      } catch (e) { /* noop */ }

      // Rechargement FORCÉ inconditionnel (jamais dans le try du fetch/signOut ci-dessus) :
      // c'est la seule garantie que le state React périmé ne survive pas et ne se
      // réécrive pas dans le localStorage qu'on vient de vider.
      window.location.href = '/';
    } catch (e) {
      setDeleteError(t('settings.deleteError'));
      setDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-end sm:items-center justify-center animate-sheetBackdrop"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-ink-900 border border-ink-800 w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] space-y-5 shadow-2xl text-ink-100 max-h-[92vh] overflow-y-auto animate-slideUp sm:animate-none"
      >
        <div className="sm:hidden -mt-1.5 mb-1 flex justify-center">
          <span className="w-9 h-1 rounded-full bg-ink-700" />
        </div>

        <div className="flex justify-between items-center border-b border-ink-800 pb-3">
          <h2 className="text-sm font-black text-ink-50 font-display">⚙️ {t('settings.title')}</h2>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-50 font-bold p-1 min-h-tap min-w-[44px]">✕</button>
        </div>

        {/* --- Compte --- */}
        {isSupabaseConfigured && session ? (
          <div className="space-y-2">
            <span className="text-[10px] font-mono text-volt-400 uppercase tracking-widest block">{t('settings.account')}</span>
            <div className="bg-ink-950 border border-ink-800 rounded-xl p-3 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[9px] text-ink-500 uppercase">{t('settings.signedInAs')}</p>
                <p className="text-xs font-bold text-ink-50 truncate">{session.user?.email}</p>
              </div>
              <button
                onClick={() => { onClose(); onSignOut(); }}
                className="shrink-0 text-[10px] font-bold text-ink-400 border border-ink-800 bg-ink-900 hover:bg-ink-800 px-2.5 py-1.5 rounded-xl"
              >
                {t('settings.signOut')}
              </button>
            </div>
          </div>
        ) : isSupabaseConfigured ? (
          <p className="text-[10px] text-ink-500 leading-relaxed">{t('settings.noAccountHint')}</p>
        ) : null}

        {/* --- Strava --- */}
        {isSupabaseConfigured && session && isStravaClientConfigured() && (
          <div className="space-y-2">
            <span className="text-[10px] font-mono uppercase tracking-widest block" style={{ color: '#FC4C02' }}>Strava</span>
            <div className="bg-ink-950 border border-ink-800 rounded-xl p-3 space-y-2">
              {stravaStatus === 'loading' ? (
                <p className="text-[10px] text-ink-500">{t('common.loading')}</p>
              ) : stravaStatus === 'connected' ? (
                <>
                  <p className="text-xs font-bold text-ink-50">✅ {t('settings.stravaConnected')}</p>
                  <p className="text-[10px] text-ink-500 leading-relaxed">{t('settings.stravaConnectedHint')}</p>
                  <p className="text-[10px] text-ink-500 leading-relaxed">{t('settings.stravaSyncHint')}</p>
                  <button
                    onClick={handleStravaSync}
                    disabled={stravaSyncing}
                    className="w-full text-xs font-bold text-white px-3 py-2 rounded-xl disabled:opacity-50"
                    style={{ backgroundColor: '#FC4C02' }}
                  >
                    {stravaSyncing ? t('settings.stravaSyncing') : t('settings.stravaSync')}
                  </button>
                  {stravaSyncMessage && <p className="text-[10px] text-emerald-400">{stravaSyncMessage}</p>}
                  <button
                    onClick={handleStravaDisconnect}
                    disabled={stravaBusy}
                    className="w-full text-[10px] font-bold text-ink-400 border border-ink-800 bg-ink-900 hover:bg-ink-800 disabled:opacity-50 px-2.5 py-1.5 rounded-xl"
                  >
                    {stravaBusy ? t('settings.deleting') : t('settings.stravaDisconnect')}
                  </button>
                </>
              ) : (
                <>
                  <p className="text-[10px] text-ink-500 leading-relaxed">{t('settings.stravaHint')}</p>
                  <button
                    onClick={handleStravaConnect}
                    className="w-full text-xs font-bold text-white px-3 py-2 rounded-xl"
                    style={{ backgroundColor: '#FC4C02' }}
                  >
                    {t('settings.stravaConnect')}
                  </button>
                </>
              )}
              {stravaError && <p className="text-[10px] text-rose-400">{stravaError}</p>}
            </div>
          </div>
        )}

        {/* --- Langue --- */}
        <div className="space-y-2">
          <span className="text-[10px] font-mono text-volt-400 uppercase tracking-widest block">{t('settings.language')}</span>
          <div className="grid grid-cols-3 gap-2">
            {SUPPORTED_LANGS.map((l) => (
              <button
                key={l.code}
                onClick={() => setLang(l.code)}
                className={`p-2.5 rounded-xl border text-center transition-all ${
                  lang === l.code ? 'border-volt-500/60 bg-volt-500/10 text-volt-300' : 'border-ink-800 bg-ink-950 text-ink-300 hover:border-ink-700'
                }`}
              >
                <span className="block text-lg leading-none mb-1">{l.flag}</span>
                <span className="block text-[10px] font-bold">{l.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* --- Apparence / mode sombre --- */}
        <div className="space-y-2">
          <span className="text-[10px] font-mono text-volt-400 uppercase tracking-widest block">{t('settings.theme')}</span>
          <div className="flex bg-ink-950 border border-ink-800 rounded-xl p-1 gap-1">
            <button
              onClick={() => setTheme('light')}
              className={`flex-1 text-[11px] font-bold py-2 rounded-lg transition-colors flex items-center justify-center gap-1.5 ${
                theme === 'light' ? 'bg-ink-800 text-volt-400 border border-ink-700' : 'text-ink-400'
              }`}
            >
              ☀️ {t('settings.themeLight')}
            </button>
            <button
              onClick={() => setTheme('dark')}
              className={`flex-1 text-[11px] font-bold py-2 rounded-lg transition-colors flex items-center justify-center gap-1.5 ${
                theme === 'dark' ? 'bg-ink-800 text-volt-400 border border-ink-700' : 'text-ink-400'
              }`}
            >
              🌙 {t('settings.themeDark')}
            </button>
          </div>
          <p className="text-[9px] text-ink-600 leading-relaxed">{t('settings.themeHint')}</p>
        </div>

        {/* --- Zones d'entraînement : Automatique (Strava) / Manuel --- */}
        <div className="space-y-2">
          <span className="text-[10px] font-mono text-volt-400 uppercase tracking-widest block">{t('settings.zonesModeTitle')}</span>
          <div className="flex bg-ink-950 border border-ink-800 rounded-xl p-1 gap-1">
            <button
              onClick={() => setZonesMode('auto')}
              className={`flex-1 text-[11px] font-bold py-2 rounded-lg transition-colors flex items-center justify-center gap-1.5 ${
                zonesMode === 'auto' ? 'bg-ink-800 text-volt-400 border border-ink-700' : 'text-ink-400'
              }`}
            >
              🤖 {t('settings.zonesModeAuto')}
            </button>
            <button
              onClick={() => setZonesMode('manual')}
              className={`flex-1 text-[11px] font-bold py-2 rounded-lg transition-colors flex items-center justify-center gap-1.5 ${
                zonesMode === 'manual' ? 'bg-ink-800 text-volt-400 border border-ink-700' : 'text-ink-400'
              }`}
            >
              ✍️ {t('settings.zonesModeManual')}
            </button>
          </div>
          <p className="text-[9px] text-ink-600 leading-relaxed">{t('settings.zonesModeHint')}</p>
        </div>

        {/* --- Diagnostic IA : teste chaque modèle Gemini/Groq à la demande --- */}
        <div className="space-y-2">
          <span className="text-[10px] font-mono text-volt-400 uppercase tracking-widest block">{t('settings.aiDiagnosticsButton')}</span>
          <button
            onClick={() => setAiDiagnosticsOpen(true)}
            className="w-full flex items-center justify-between gap-2 bg-ink-950 border border-ink-800 hover:border-ink-700 rounded-xl p-3 text-left"
          >
            <span className="text-xs font-bold text-ink-50">🤖 {t('settings.aiDiagnosticsTitle')}</span>
            <span className="text-ink-500">›</span>
          </button>
        </div>

        {/* --- Zone de danger : suppression de compte --- */}
        {isSupabaseConfigured && session && (
          <div className="space-y-2 pt-2 border-t border-ink-800">
            <span className="text-[10px] font-mono text-rose-400 uppercase tracking-widest block">{t('settings.dangerZone')}</span>

            {!confirming ? (
              <button
                onClick={() => setConfirming(true)}
                className="w-full text-left bg-rose-950/30 border border-rose-800/60 hover:border-rose-700 text-rose-300 font-bold text-xs px-3 py-2.5 rounded-xl"
              >
                🗑 {t('settings.deleteAccount')}
              </button>
            ) : (
              <div className="bg-rose-950/40 border border-rose-800/70 rounded-xl p-3 space-y-2.5">
                <p className="text-xs font-bold text-rose-300">{t('settings.deleteConfirmTitle')}</p>
                <p className="text-[10px] text-rose-300/80 leading-relaxed">{t('settings.deleteConfirmBody')}</p>
                <div>
                  <label className="text-[10px] text-rose-300/80 block mb-1">
                    {t('settings.deleteConfirmType')} (<span className="font-mono font-bold">{confirmWord}</span>)
                  </label>
                  <input
                    type="text"
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder={t('settings.deleteConfirmPlaceholder')}
                    className="w-full bg-ink-950 border border-rose-800/60 rounded-xl p-2 text-xs text-ink-50 placeholder-ink-600"
                  />
                </div>
                {deleteError && <p className="text-[10px] text-rose-400">{deleteError}</p>}
                <div className="flex gap-2">
                  <button
                    onClick={() => { setConfirming(false); setConfirmText(''); setDeleteError(''); }}
                    disabled={deleting}
                    className="flex-1 bg-ink-800 hover:bg-ink-700 text-ink-50 font-bold px-3 py-2 rounded-xl text-[11px]"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    onClick={handleDeleteAccount}
                    disabled={deleting || confirmText.trim().toUpperCase() !== confirmWord}
                    className="flex-1 bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white font-bold px-3 py-2 rounded-xl text-[11px]"
                  >
                    {deleting ? t('settings.deleting') : t('common.delete')}
                  </button>
                </div>
              </div>
            )}
            <p className="text-[9px] text-ink-600 leading-relaxed">{t('settings.deleteAccountHint')}</p>
          </div>
        )}

        <div className="flex justify-end pt-2 border-t border-ink-800">
          <button
            onClick={onClose}
            className="bg-ink-800 hover:bg-ink-700 text-ink-50 font-bold px-4 py-2 rounded-xl text-xs uppercase min-h-tap"
          >
            {t('common.close')}
          </button>
        </div>
      </div>

      {/* stopPropagation : évite qu'un clic sur le fond de CETTE modale (pour la
          fermer) ne remonte jusqu'au fond de la modale Réglages en dessous et
          ne la ferme elle aussi par la même occasion. */}
      <div onClick={(e) => e.stopPropagation()}>
        <AiDiagnosticsModal isOpen={aiDiagnosticsOpen} onClose={() => setAiDiagnosticsOpen(false)} />
      </div>
    </div>
  );
}
