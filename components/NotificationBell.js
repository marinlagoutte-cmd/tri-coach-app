import React, { useEffect, useRef, useState } from 'react';
import { useI18n } from '../lib/i18n';
import {
  isPushSupported,
  getNotificationPermission,
  hasActiveSubscription,
  enableWeeklyRecapNotifications,
  disableWeeklyRecapNotifications,
} from '../lib/pushNotifications';

// Cloche de notification placée dans le header (haut à droite) : un point orange
// signale tant que le récap hebdomadaire n'est pas encore activé sur cet appareil,
// pour attirer l'œil vers la fonctionnalité — il disparaît une fois l'abonnement
// actif. Clic → petit panneau expliquant la fonctionnalité + bouton d'activation
// (qui déclenche la demande d'autorisation système, voir lib/pushNotifications.js).
export default function NotificationBell({ accessToken }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [permission, setPermission] = useState('default');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const panelRef = useRef(null);

  const refreshStatus = async () => {
    setPermission(getNotificationPermission());
    setSubscribed(await hasActiveSubscription());
  };

  useEffect(() => {
    refreshStatus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const handleToggle = async () => {
    setError(null);
    if (!accessToken) {
      setError('requiresAccount');
      return;
    }
    setBusy(true);
    try {
      if (subscribed) {
        await disableWeeklyRecapNotifications(accessToken);
      } else {
        const result = await enableWeeklyRecapNotifications(accessToken);
        if (!result.success) {
          setError(
            {
              unsupported: 'errorUnsupported',
              denied: 'errorDenied',
              'not-configured': 'errorNotConfigured',
              'not-signed-in': 'requiresAccount',
            }[result.error] || 'errorGeneric'
          );
        }
      }
    } finally {
      await refreshStatus();
      setBusy(false);
    }
  };

  if (!isPushSupported()) return null;

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={t('notifications.bellTitle')}
        className="relative w-8 h-8 rounded-xl bg-ink-950 border border-ink-800 flex items-center justify-center text-sm shrink-0"
      >
        🔔
        {!subscribed && (
          <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-flare-500 border-2 border-ink-950" />
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-72 bg-ink-900 border border-ink-800 rounded-2xl shadow-2xl z-40 overflow-hidden animate-fadeIn p-3.5">
          <p className="text-xs font-black text-ink-50 mb-1.5">{t('notifications.panelTitle')}</p>
          <p className="text-[11px] text-ink-400 leading-relaxed mb-3">{t('notifications.description')}</p>

          {permission === 'denied' && (
            <p className="text-[10px] text-flare-400 font-bold mb-2.5">{t('notifications.errorDenied')}</p>
          )}
          {error && permission !== 'denied' && (
            <p className="text-[10px] text-flare-400 font-bold mb-2.5">{t(`notifications.${error}`)}</p>
          )}

          <button
            type="button"
            onClick={handleToggle}
            disabled={busy || permission === 'denied'}
            className={`w-full text-xs font-bold px-3 py-2 rounded-xl transition-all active:scale-95 disabled:opacity-50 ${
              subscribed
                ? 'text-ink-400 border border-ink-800 bg-ink-950 hover:bg-ink-800'
                : 'bg-gradient-to-r from-volt-500 to-flare-500 text-white shadow-glow-sm'
            }`}
          >
            {busy ? t('notifications.enabling') : subscribed ? t('notifications.disable') : t('notifications.enable')}
          </button>

          <p className="text-[10px] text-ink-500 font-mono mt-2.5">
            {subscribed ? t('notifications.statusOn') : t('notifications.statusOff')}
          </p>
        </div>
      )}
    </div>
  );
}
