import { Oswald, Inter } from 'next/font/google';
import '../styles/globals.css';

const oswald = Oswald({ subsets: ['latin'], weight: ['600', '700'], variable: '--font-display' });
const inter = Inter({ subsets: ['latin'], variable: '--font-body' });

export default function App({ Component, pageProps }) {
  return (
    <div className={`${oswald.variable} ${inter.variable} font-body`}>
      <Component {...pageProps} />
    </div>
  );
}
