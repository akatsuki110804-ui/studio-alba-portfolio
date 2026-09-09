/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx}',
    './components/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      colors: {
        ink: '#12141C',
        panel: '#1C2030',
        panelLine: '#33384A',
        paper: '#FAF8F4',
        gold: '#C9A227',
        teal: '#4E7C77',
        muted: '#ADB1C4',
      },
      fontFamily: {
        serif: ['Fraunces', 'serif'],
        sans: ['"IBM Plex Sans JP"', '"IBM Plex Sans"', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
