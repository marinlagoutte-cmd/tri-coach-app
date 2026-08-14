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
          bg: '#F8FAFC',
          border: '#E2E8F0',
          neon: '#FF5722',
          neonHover: '#E64A19',
          darkText: '#0F172A',
          sub: '#64748B',
        },
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
