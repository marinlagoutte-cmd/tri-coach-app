// public/sw.js
// Service worker "maison" (pas de dépendance externe type next-pwa) :
// - permet l'installation de l'app (icône + lancement plein écran, sans barre de navigateur)
// - met en cache la coquille de l'app pour un démarrage instantané et un minimum d'usage hors-ligne
// - NE MET JAMAIS EN CACHE les appels /api/* : ce sont des appels IA dynamiques (chat, génération de
//   plan, nutrition) qui doivent toujours atteindre le serveur, jamais renvoyer une réponse périmée.

// Ce jeton est remplacé automatiquement à chaque build (scripts/generate-sw.js)
// par l'identifiant unique du déploiement (SHA du commit sur Vercel, sinon un
// timestamp en local). Ça garantit un NOUVEAU nom de cache à chaque déploiement,
// donc plus aucun mélange possible entre les fichiers JS/CSS hashés d'un ancien
// build (qui n'existent plus côté serveur après un nouveau déploiement) et ceux
// du build actuel — c'est ce mélange qui causait le bug d'affichage (CSS introuvable).
const CACHE_VERSION = 'local-1788123673243';
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

// Notification push "récap de la semaine" (voir pages/api/notifications/weekly-recap.js,
// qui envoie un payload JSON { title, body, url }). `icon` = logo affiché dans la
// notification elle-même ; `badge` = petit pictogramme monochrome affiché dans la
// barre de statut Android — on réutilise l'icône de l'app faute d'un badge dédié.
self.addEventListener('push', (event) => {
  let payload = { title: 'Tri Coach', body: 'Récap disponible.', url: '/' };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch (err) {
    console.warn('[sw] payload push illisible (non bloquant) :', err);
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: payload.url || '/' },
      tag: 'tricoach-weekly-recap',
    })
  );
});

// Clic sur la notification : ramène au premier onglet Tri Coach déjà ouvert s'il y
// en a un (évite d'empiler des onglets identiques), sinon en ouvre un nouveau.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsList) => {
      const existing = clientsList.find((client) => new URL(client.url).origin === self.location.origin);
      if (existing) return existing.focus();
      return self.clients.openWindow(targetUrl);
    })
  );
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
