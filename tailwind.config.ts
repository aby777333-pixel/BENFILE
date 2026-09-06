import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#070A0F',
          900: '#0B1017',
          850: '#0F1621',
          800: '#141C29',
          700: '#1B2535',
          600: '#26334A',
          500: '#3A4A66',
          400: '#5B6C8A',
          300: '#8E9DB8',
          200: '#BCC7DB',
          100: '#E3E9F3',
        },
        gold: { 500: '#D4A94A', 400: '#E2BE67', 300: '#F0D58F' },
        verified: '#2FBF71',
        warn: '#E8B23A',
        danger: '#E05252',
        critical: '#B91C1C',
        info: '#4C8DFF',
        derived: '#9A7BFF',
        declared: '#3AB8C8',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        panel: '0 1px 0 0 rgba(255,255,255,0.03) inset, 0 8px 24px -12px rgba(0,0,0,0.6)',
      },
    },
  },
  plugins: [],
};
export default config;
