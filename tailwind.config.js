/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./App.{js,jsx}', './src/**/*.{js,jsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        primary: '#22A06B',
        mint: '#E9F8F1',
        orange: '#FF8A3D',
        charcoal: '#1F2933',
        softgray: '#F5F6F7',
        alertred: '#E5484D',
      },
    },
  },
  plugins: [],
};
