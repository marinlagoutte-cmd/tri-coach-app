// public/sw.js
// Service worker "maison" (pas de dépendance externe type next-pwa) :
// - permet l'installation de l'app (icône + lancement plein écran, sans barre de navigateur)
// - met en cache la coquille de l'app pour un démarrage instantané et un minimum d'usage hors-ligne
// - NE MET JAMAIS EN CACHE les appels /api/* : ce sont des appels IA dynamiques (chat, génération de
//   plan, nutrition) qui doivent toujours atteindre le serveur, jamais renvoyer une réponse périmée.

const CACHE_VERSION = 'v2';
const CACHE_NAME = `tricoach-${CACHE_VERSION}`;

// Un minimum de fichiers connus à l'avance (pas de hash de build) : le reste
// (JS/CSS générés par Next.js) se met en cache tout seul au fil de la navigation
// via la stratégie "stale-while-revalidate" ci-dessous.
const PRECACHE_URLS = [
  '/',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .catch((err) => console.warn('[sw] precache échouée (non bloquant) :', err))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name.startsWith('tricoach-') && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // On ne s'occupe QUE des requêtes GET same-origin. Tout le reste (POST, appels
  // externes à Open-Meteo/BigDataCloud, l'API Gemini côté serveur, etc.) part
  // directement au réseau, sans passer par le service worker.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Jamais de cache pour les routes API : toujours des données fraîches (ou une
  // vraie erreur réseau claire), jamais une réponse IA périmée.
  if (url.pathname.startsWith('/api/')) return;

  // Navigation (chargement d'une page) : réseau en priorité pour avoir le HTML à
  // jour, avec repli sur le cache (puis sur la coquille "/") si hors-ligne.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) => cached || caches.match('/'))
        )
    );
    return;
  }

  // Assets statiques (JS/CSS/polices/images Next.js) : stale-while-revalidate —
  // réponse immédiate depuis le cache si dispo (démarrage rapide), mise à jour
  // silencieuse en arrière-plan pour la prochaine fois.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
