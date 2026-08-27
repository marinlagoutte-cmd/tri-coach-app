// lib/registerServiceWorker.js
// Enregistrement du service worker — uniquement côté client, uniquement en
// production (en dev, le SW mettrait en cache des assets qui changent à chaque
// rechargement et créerait des faux "bugs" de cache pendant le développement).
export function registerServiceWorker() {
  if (typeof window === 'undefined') return;
  if (process.env.NODE_ENV !== 'production') return;
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('[sw] Échec de l\'enregistrement (non bloquant) :', err);
    });
  });
}
