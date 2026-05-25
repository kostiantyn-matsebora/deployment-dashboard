/** @type {import('tailwindcss').Config} */
// Mockup-app Tailwind config — standalone; no @dd/* library content paths.
// Theme axis strategy: selector-based dark mode keyed on [data-theme="dark"]
// on <html>. Tailwind v3.4+ supports ['selector', '...'] array form.
// The matching [data-theme="dark"] CSS overrides in styles.css are kept for
// legacy component-class specificity; dark: variants now also work directly.
module.exports = {
  content: [
    './src/**/*.{html,ts}'
  ],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'sans-serif']
      },
      keyframes: {
        'pulse-border': {
          '0%, 100%': {
            borderColor: 'rgba(251,146,60,0.5)',
            boxShadow: '0 0 0 0 rgba(251,146,60,0)'
          },
          '50%': {
            borderColor: 'rgba(234,88,12,1)',
            boxShadow: '0 0 0 3px rgba(251,146,60,0.15)'
          }
        }
      },
      animation: {
        'pulse-border': 'pulse-border 1.8s ease-in-out infinite'
      }
    }
  },
  plugins: []
};
