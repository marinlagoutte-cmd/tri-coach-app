/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        ria: {
          bg: '#020617',
          surface: '#0B1220',
          border: '#1E293B',
          neon: '#FF5722',
          neonHover: '#E64A19',
          darkText: '#0F172A',
          sub: '#64748B',
          sand: '#E8DCC8',
          forest: '#1F4D3A',
          ocean: '#0E3A53',
          coral: '#FF6B4A',
        },
      },
      fontFamily: {
        display: ['var(--font-display)', 'sans-serif'],
        body: ['var(--font-body)', 'sans-serif'],
      },
      spacing: {
        'safe-b': 'env(safe-area-inset-bottom)',
        'safe-t': 'env(safe-area-inset-top)',
      },
      minHeight: {
        tap: '44px',
      },
    },
  },
  plugins: [],
};
