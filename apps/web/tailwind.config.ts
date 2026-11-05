import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    container: {
      center: true,
      padding: '1rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        border: 'hsl(var(--border))',
        ring: 'hsl(var(--ring))',
        /* Colores de estado del hogar. Se ajustan solos en claro/oscuro
           porque salen de las mismas variables que la capa ambiental. */
        state: {
          light: 'hsl(var(--state-light))',
          heat: 'hsl(var(--state-heat))',
          cool: 'hsl(var(--state-cool))',
          live: 'hsl(var(--state-live))',
          /* Variantes legibles como texto sobre superficie teñida. */
          'light-fg': 'hsl(var(--state-light-fg))',
          'heat-fg': 'hsl(var(--state-heat-fg))',
          'cool-fg': 'hsl(var(--state-cool-fg))',
          'live-fg': 'hsl(var(--state-live-fg))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        /* Escala de titular para las pantallas protagonistas. */
        display: ['clamp(2.25rem, 1.4rem + 3.4vw, 3.75rem)', { lineHeight: '1.02', letterSpacing: '-0.035em' }],
        'display-sm': ['clamp(1.75rem, 1.2rem + 2.2vw, 2.5rem)', { lineHeight: '1.08', letterSpacing: '-0.03em' }],
      },
    },
  },
  plugins: [],
};

export default config;
