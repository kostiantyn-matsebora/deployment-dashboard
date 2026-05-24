/** @type {import('tailwindcss').Config} */
// Mockup-app Tailwind config — standalone; no @dd/* library content paths.
// Theme axis strategy: CSS-overlay only (no `dark:` utility variants),
// mirroring the SPA's approach. Dark palette is in src/styles.css as a
// [data-theme="dark"] block, identical to the SPA's styles.css.
module.exports = {
  content: [
    './src/**/*.{html,ts}'
  ],
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
