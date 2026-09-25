// lib/pushNotifications.js
//
// Abonnement "push" (notification système, même app/onglet fermé) pour le récap
// hebdomadaire — repose sur la Web Push API standard (PushManager + clé VAPID),
// PAS sur l'API expérimentale Notification Triggers (`showTrigger`), qui n'est
// disponible sur aucun navigateur mobile grand public (Chrome Android compris) et
// n'aurait donc pas permis de couvrir un appareil comme un Samsung/Android.
// Le déclenchement "dimanche 19h" est donc fait CÔTÉ SERVEUR (Vercel Cron, voir
// pages/api/notifications/weekly-recap.js + vercel.json), qui envoie un vrai push
// au moment voulu ; ce fichier ne fait qu'obtenir/révoquer l'abonnement de CET
// appareil et le déclarer au serveur (table push_subscriptions).
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

export function isPushSupported() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** 'default' (jamais demandé) | 'granted' | 'denied' | 'unsupported'. */
export function getNotificationPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

// PushManager.subscribe() attend la clé VAPID publique en Uint8Array (pas la
// chaîne base64url telle quelle) — conversion standard, sans dépendance externe.
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

/**
 * Demande la permission de notification à l'OS/navigateur, crée l'abonnement
 * push de cet appareil, puis le déclare côté serveur.
 * @returns {Promise<{ success: boolean, error?: 'unsupported'|'not-configured'|'not-signed-in'|'denied'|'server-error'|'subscribe-failed' }>}
 */
export async function enableWeeklyRecapNotifications(accessToken) {
  if (!isPushSupported()) return { success: false, error: 'unsupported' };
  if (!VAPID_PUBLIC_KEY) return { success: false, error: 'not-configured' };
  if (!accessToken) return { success: false, error: 'not-signed-in' };

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { success: false, error: 'denied' };

  try {
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }

    const res = await fetch('/api/notifications/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken, subscription: subscription.toJSON() }),
    });
    if (!res.ok) return { success: false, error: 'server-error' };
    return { success: true };
  } catch (error) {
    console.error('[pushNotifications] enable error', error);
    return { success: false, error: 'subscribe-failed' };
  }
}

/** Résilie l'abonnement de cet appareil, navigateur ET serveur. */
export async function disableWeeklyRecapNotifications(accessToken) {
  if (!isPushSupported()) return { success: true };
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (subscription) {
      await fetch('/api/notifications/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken, endpoint: subscription.endpoint }),
      });
      await subscription.unsubscribe();
    }
    return { success: true };
  } catch (error) {
    console.error('[pushNotifications] disable error', error);
    return { success: false, error: 'unsubscribe-failed' };
  }
}

/** true si CET appareil a déjà un abonnement push actif — indépendant de
 * `Notification.permission`, qui peut valoir 'granted' sans qu'un abonnement
 * ait été créé (ex: permission donnée puis subscribe jamais appelé). */
export async function hasActiveSubscription() {
  if (!isPushSupported()) return false;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return false;
    const subscription = await registration.pushManager.getSubscription();
    return Boolean(subscription);
  } catch {
    return false;
  }
}
