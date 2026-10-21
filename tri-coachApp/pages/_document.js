// pages/_document.js — langue de la page : français. Nécessaire à la césure automatique des
// textes justifiés (hyphens: auto) et à la bonne prononciation par les lecteurs d'écran.
import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    <Html lang="fr">
      <Head />
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
