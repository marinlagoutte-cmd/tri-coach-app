/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ria: {
          bg: "#0b0f12",
          card: "#161b22",
          border: "#21262d",
          neon: "#ccff00",
          neonHover: "#b8e600",
          darkText: "#0b0f12",
        },
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
