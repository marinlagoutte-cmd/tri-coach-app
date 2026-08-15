import { useEffect } from 'react';
import Head from 'next/head';
import { Oswald, Inter } from 'next/font/google';
import '../styles/globals.css';
import { registerServiceWorker } from '../lib/registerServiceWorker';

const oswald = Oswald({ subsets: ['latin'], weight: ['600', '700'], variable: '--font-display' });
const inter = Inter({ subsets: ['latin'], variable: '--font-body' });

export default function App({ Component, pageProps }) {
  useEffect(() => {
    registerServiceWorker();
  }, []);

  return (
    <>
      <Head>
        {/* Installation en app (icône + lancement plein écran sans navigateur) */}
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#FF5722" />
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
      <div className={`${oswald.variable} ${inter.variable} font-body`}>
        <Component {...pageProps} />
      </div>
    </>
  );
}
