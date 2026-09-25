import React, { useEffect, useRef, useState } from 'react';
import { useI18n } from '../lib/i18n';

export default function AccountMenu({ session, cloudSyncing, onSignOut, onOpenSettings }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  // Ferme le menu au clic à l'extérieur — comportement standard attendu pour un
  // menu de compte (ex: Gmail, Google Drive...).
  useEffect(() => {
    if (!open) return;
    const handleClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const avatarUrl = session?.user?.user_metadata?.avatar_url;
  const email = session?.user?.email || '';
  const initial = (email || '?')[0].toUpperCase();

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={t('header.account', { email })}
        className="w-8 h-8 rounded-xl bg-ink-950 border border-ink-800 flex items-center justify-center text-[11px] font-bold text-volt-400 overflow-hidden shrink-0"
      >
        {cloudSyncing ? (
          <span className="animate-pulse">☁️</span>
        ) : avatarUrl ? (
          <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          initial
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-56 bg-ink-900 border border-ink-800 rounded-2xl shadow-2xl z-40 overflow-hidden animate-fadeIn">
          <div className="px-3.5 py-3 border-b border-ink-800">
            <p className="text-[9px] uppercase text-ink-500 font-mono">{t('settings.signedInAs')}</p>
            <p className="text-xs font-bold text-ink-50 truncate">{email}</p>
          </div>
          <button
            type="button"
            onClick={() => { setOpen(false); onOpenSettings(); }}
            className="w-full text-left px-3.5 py-2.5 text-xs font-bold text-ink-200 hover:bg-ink-950 flex items-center gap-2"
          >
            ⚙️ {t('settings.title')}
          </button>
          <button
            type="button"
            onClick={() => { setOpen(false); onSignOut(); }}
            className="w-full text-left px-3.5 py-2.5 text-xs font-bold text-ink-200 hover:bg-ink-950 flex items-center gap-2 border-t border-ink-800"
          >
            🚪 {t('settings.signOut')}
          </button>
        </div>
      )}
    </div>
  );
}
