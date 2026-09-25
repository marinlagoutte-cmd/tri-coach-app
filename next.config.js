/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        // Le fichier du service worker ne doit JAMAIS être mis en cache par le
        // navigateur/CDN : sinon un appareil pourrait rester bloqué sur une
        // ancienne version du SW et ne jamais recevoir les mises à jour de l'app.
        source: '/sw.js',
        headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }],
      },
      {
        source: '/manifest.json',
        headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }],
      },
    ];
  },
};

module.exports = nextConfig;
