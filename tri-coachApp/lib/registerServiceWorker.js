// lib/registerServiceWorker.js
// Enregistrement du service worker — uniquement côté client, uniquement en
// production (en dev, le SW mettrait en cache des assets qui changent à chaque
// rechargement et créerait des faux "bugs" de cache pendant le développement).
export function registerServiceWorker() {
  if (typeof window === 'undefined') return;
  if (process.env.NODE_ENV !== 'production') return;
  if (!('serviceWorker' in navigator)) return;

  // Quand un NOUVEAU Service Worker (donc un nouveau déploiement, voir
  // scripts/generate-sw.js) prend le contrôle de la page, les requêtes de la
  // page déjà ouverte passent par lui — mais cette page a été chargée avec
  // les noms de fichiers JS/CSS hashés de l'ANCIEN build. Sans ce rechargement,
  // l'utilisateur peut se retrouver avec un mélange ancien HTML / nouveau
  // cache, ce qui peut à nouveau casser l'affichage (CSS introuvable).
  // Un seul rechargement automatique (garde anti-boucle via sessionStorage)
  // suffit à repartir sur une page 100% cohérente avec le nouveau build.
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    if (sessionStorage.getItem('tri_sw_reloaded')) return;
    refreshing = true;
    sessionStorage.setItem('tri_sw_reloaded', '1');
    window.location.reload();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('[sw] Échec de l\'enregistrement (non bloquant) :', err);
    });
  });
}
