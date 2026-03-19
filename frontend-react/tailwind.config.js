/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: '#0ca89a',
          secondary: '#153a59',
          accent: '#f08a32',
          dark: '#0c1828',
          surface: '#f8f4ee',
          text: '#16263a',
          muted: '#617487',
          border: '#d7d6d0',
          ink: '#f3eee6',
          panel: '#fffdf9',
        },
      },
      fontFamily: {
        sans: ['"Manrope"', 'system-ui', 'sans-serif'],
        display: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
    },
  },
  plugins: [],
}
