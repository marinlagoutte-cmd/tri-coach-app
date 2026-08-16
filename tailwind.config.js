/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // "ink" — refonte façon Strava : canvas gris très clair, cartes blanches,
        // texte quasi-noir. Même structure 50→950 qu'avant (donc zéro changement
        // à faire dans les composants) mais la direction est inversée : 950 est
        // désormais la teinte la plus CLAIRE (fond de page) et 50 la plus SOMBRE
        // (texte). Neutre pur, sans dominante de couleur — sobriété d'abord.
        ink: {
          50: '#10131A',
          100: '#14181F',
          200: '#262B33',
          300: '#3D434C',
          400: '#565D67',
          500: '#7B818A',
          600: '#A5AAB0',
          700: '#C7CBCE',
          800: '#E4E6E8',
          900: '#FFFFFF',
          950: '#F6F7F8',
        },
        // "volt" = accent de marque, aligné sur l'orange Strava (#FC4C02) : une
        // seule couleur forte, utilisée avec parcimonie (CTA, onglet actif),
        // jamais en néon/glow — plat et net.
        volt: {
          50: '#FFF4EE',
          100: '#FFE4D6',
          200: '#FFC7AD',
          300: '#FF9F72',
          400: '#FD7A3D',
          500: '#FC4C02',
          600: '#E44500',
          700: '#BD3900',
          800: '#962E00',
          900: '#7A2600',
          950: '#431400',
        },
        // "flare" = voisin chaud du volt (utilisé uniquement dans les dégradés
        // CTA existants) : très proche de volt pour que le dégradé reste quasi
        // plat, jamais un second accent de couleur différente.
        flare: {
          400: '#FF8A50',
          500: '#F03D00',
          600: '#D63500',
        },
        ria: {
          bg: '#F6F7F8',
          surface: '#FFFFFF',
          border: '#E4E6E8',
          neon: '#FC4C02',
          neonHover: '#E44500',
          sub: '#565D67',
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
        // Ombres plates et discrètes façon carte Strava — plus de halo lumineux,
        // juste assez de profondeur pour détacher un élément du fond gris clair.
        glow: '0 1px 2px rgba(16,19,26,0.06), 0 4px 10px -4px rgba(16,19,26,0.10)',
        'glow-sm': '0 1px 2px rgba(16,19,26,0.08)',
      },
      backgroundImage: {
        'tri-spectrum': 'linear-gradient(90deg, #22D3EE 0%, #FBBF24 50%, #34D399 100%)',
      },
    },
  },
  plugins: [],
};
