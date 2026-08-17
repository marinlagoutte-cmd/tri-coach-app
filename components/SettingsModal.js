import React, { useState } from 'react';
import { useI18n, SUPPORTED_LANGS } from '../lib/i18n';
import { useTheme } from '../lib/theme';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { STORAGE_KEYS } from '../lib/storage';

export default function SettingsModal({ isOpen, onClose, session, onSignOut }) {
  const { t, lang, setLang } = useI18n();
  const { theme, setTheme } = useTheme();
  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

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

      // Efface tout ce qui est local (profil, plan, séances, chat, préférences...)
      // avant la déconnexion, pour qu'aucune trace ne subsiste sur cet appareil.
      Object.values(STORAGE_KEYS).forEach((key) => {
        try { localStorage.removeItem(key); } catch (e) { /* noop */ }
      });
      await supabase.auth.signOut();
      window.location.reload();
    } catch (e) {
      setDeleteError(t('settings.deleteError'));
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className="bg-ink-900 border border-ink-800 w-full max-w-sm rounded-3xl p-5 space-y-5 shadow-2xl text-ink-100 max-h-[90vh] overflow-y-auto">
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
    </div>
  );
}
