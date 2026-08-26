import { useEffect } from 'react';
import Head from 'next/head';
import { Oswald, Inter, JetBrains_Mono } from 'next/font/google';
import '../styles/globals.css';
// CSS de Leaflet (carte radar météo/vent) : import global obligatoire côté Next.js
// (pages router), sinon les tuiles/contrôles de la carte s'affichent mal positionnés.
import 'leaflet/dist/leaflet.css';
import { registerServiceWorker } from '../lib/registerServiceWorker';
import { ThemeProvider } from '../lib/theme';
import { LanguageProvider } from '../lib/i18n';
import ErrorBoundary from '../components/ErrorBoundary';

// Appliqué AVANT l'hydratation React (donc avant tout rendu visible) pour éviter
// un flash clair->sombre au chargement : lit directement le localStorage, sans
// attendre que ThemeProvider (lib/theme.js) ne se monte.
const NO_FLASH_THEME_SCRIPT = `
(function(){
  try {
    var stored = localStorage.getItem('tri_theme');
    var isDark = stored ? stored === '"dark"' || stored === 'dark' : !window.matchMedia('(prefers-color-scheme: light)').matches;
    document.documentElement.classList.toggle('dark', isDark);
  } catch (e) {}
})();
`;

const oswald = Oswald({ subsets: ['latin'], weight: ['600', '700'], variable: '--font-display' });
const inter = Inter({ subsets: ['latin'], variable: '--font-body' });
// Police mono dédiée à toutes les données "instrument" de l'app (allures, watts, bpm,
// zones, comptes à rebours) — lisibilité chiffrée façon montre GPS/compteur vélo,
// distincte de la police mono système par défaut utilisée avant.
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '600', '700'], variable: '--font-mono' });

export default function App({ Component, pageProps }) {
  useEffect(() => {
    registerServiceWorker();
  }, []);

  return (
    <>
      <Head>
        {/* Installation en app (icône + lancement plein écran sans navigateur) */}
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#FC4C02" />
        {/* eslint-disable-next-line react/no-danger */}
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_THEME_SCRIPT }} />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />

        {/* iOS ne lit pas manifest.json pour l'icône/le mode plein écran : balises dédiées obligatoires */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="TriCoach" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />

        <link rel="icon" href="/favicon.ico" />
        <title>Tri Coach — Coach IA Triathlon &amp; Course à pied</title>
        <meta name="description" content="Ton coach personnel IA pour triathlon et course à pied : plan d'entraînement, calendrier, nutrition, météo et suivi de forme." />
      </Head>
      <div className={`${oswald.variable} ${inter.variable} ${jetbrainsMono.variable} font-body`}>
        <ErrorBoundary>
          <ThemeProvider>
            <LanguageProvider>
              <Component {...pageProps} />
            </LanguageProvider>
          </ThemeProvider>
        </ErrorBoundary>
      </div>
    </>
  );
}
