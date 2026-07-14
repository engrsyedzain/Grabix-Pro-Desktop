/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      keyframes: {
        'progress-indeterminate': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(300%)' },
        },
      },
      animation: {
        'progress-indeterminate': 'progress-indeterminate 1.5s infinite linear',
      },
      colors: {
        // Brand: electric blue, matched to the app icon and the Android client.
        // Dark surfaces sit in the icon's navy family (#14283c) rather than the
        // old neutral greys, so the chrome reads as one palette with the logo.
        'grabix-bg': {
          DEFAULT: '#ffffff',
          dark: '#0a0f16',
        },
        'grabix-surface': {
          DEFAULT: '#f4f7fa',
          dark: '#141c27',
        },
        'grabix-input': {
          DEFAULT: '#ffffff',
          dark: '#1b2531',
        },
        'grabix-border': {
          DEFAULT: '#e3e9f0',
          dark: '#24303e',
        },
        // NOTE: token intentionally keeps the `grabix-purple` *name* — the class
        // string `bg-grabix-purple` is used as a querySelector hook in App.tsx.
        // Only the value changed (purple -> electric blue).
        'grabix-purple': {
          DEFAULT: '#0f9be0',
          hover: '#35bfff',
        },
        'grabix-muted': '#8798a9',
        'grabix-dim': '#566578',
        'grabix-white': '#eaf2fb',
      },
    },
  },
  plugins: [],
}
