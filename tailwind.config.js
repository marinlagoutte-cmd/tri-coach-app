/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // "ink" remplace l'échelle slate par défaut : même structure de teintes
        // (mêmes numéros 50 → 950, donc compatible avec toutes les classes déjà
        // utilisées dans l'app), mais avec une légère dominante indigo/violette au
        // lieu du gris neutre générique — cohérent avec l'accent "volt" ci-dessous.
        ink: {
          50: '#F6F5FB',
          100: '#ECE9F7',
          200: '#D6D1EC',
          300: '#AFA6D6',
          400: '#8177AC',
          500: '#5F5686',
          600: '#463D68',
          700: '#332C4E',
          800: '#1F1A32',
          900: '#131022',
          950: '#080614',
        },
        // "volt" = accent de marque du COACH IA (violet électrique). Volontairement
        // distinct des 3 couleurs sport (cyan=nat, amber=vélo, emerald=course) déjà
        // utilisées dans l'app : le violet identifie tout ce qui vient de l'IA/du
        // coach (CTA, onglet actif, éléments de suivi), jamais une discipline précise.
        volt: {
          50: '#F4F1FF',
          100: '#EBE5FF',
          200: '#D6C9FF',
          300: '#B7A0FF',
          400: '#9A78FF',
          500: '#8358FF',
          600: '#6D3FF0',
          700: '#5931C7',
          800: '#44269B',
          900: '#331C74',
          950: '#1F1149',
        },
        // "flare" = second accent chaud (utilisé avec parcimonie : dégradés de CTA,
        // repères "modifié via chat", moments qui doivent attirer l'œil).
        flare: {
          400: '#FF7A9C',
          500: '#FF4D80',
          600: '#F02E68',
        },
        ria: {
          bg: '#080614',
          surface: '#131022',
          border: '#1F1A32',
          neon: '#8358FF',
          neonHover: '#6D3FF0',
          sub: '#8177AC',
          ocean: '#152249',
          coral: '#FF4D80',
        },
      },
      fontFamily: {
        display: ['var(--font-display)', 'sans-serif'],
        body: ['var(--font-body)', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      spacing: {
        'safe-b': 'env(safe-area-inset-bottom)',
        'safe-t': 'env(safe-area-inset-top)',
      },
      minHeight: {
        tap: '44px',
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(131,88,255,0.25), 0 8px 24px -4px rgba(131,88,255,0.35)',
        'glow-sm': '0 4px 14px -2px rgba(131,88,255,0.4)',
      },
      backgroundImage: {
        'tri-spectrum': 'linear-gradient(90deg, #22D3EE 0%, #FBBF24 50%, #34D399 100%)',
      },
    },
  },
  plugins: [],
};
