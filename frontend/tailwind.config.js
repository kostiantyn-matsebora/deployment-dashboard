/** @type {import('tailwindcss').Config} */
// Theme axis strategy — CSS-OVERLAY ONLY (no `dark:` utility variants).
// The dark palette lives as a single `[data-theme="dark"]` block in
// `dashboard/src/styles.css` that remaps Tailwind utility classes
// (`bg-white`, `text-gray-900`, …) to their Dim equivalents. This mirrors
// the mockup verbatim (docs/deployment-dashboard.html §"Theme axis") and
// keeps leaf-renderer DOM + class strings byte-identical between palettes.
// Consequently, no `darkMode` entry is needed here — Tailwind's `dark:`
// variant is intentionally NOT used anywhere in templates.
module.exports = {
  content: [
    './dashboard/src/**/*.{html,ts}',
    './matrix/src/**/*.{html,ts}',
    './drawer/src/**/*.{html,ts}',
    './shared/src/**/*.{html,ts}'
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
