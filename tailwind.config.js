/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        // Brand typography (Athelas + Vanguard stand-ins via Google Fonts). Vanguard → Outfit
        // (professional geometric sans) drives every piece of body/UI text. Athelas → Lora
        // (editorial serif) is the display font for headings. Tempting remains the elegant
        // script accent, used only on high-visibility display moments (hero headlines,
        // brand wordmark) via the `font-script` utility so script never overwhelms.
        sans: ['Outfit', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['Lora', 'ui-serif', 'Georgia', 'serif'],
        script: ['Tempting', 'ui-serif', 'Georgia', 'cursive'],
        // Kitchen display system (KitchenLiveBoard terminal): Open Sans is the primary
        // typeface, Times New Roman the secondary fallback.
        kds: ['"Open Sans"', '"Times New Roman"', 'serif'],
      },
      colors: {
        // ─── Semantic palette (COZY CAFÉ & BAKERY, spec §6) ────────────────────
        // 60% Cocoa — warm cream backgrounds + espresso text
        ink: {
          DEFAULT: '#4A3525',
          50: '#FDF8F5',
          100: '#F6EDE5',
          700: '#6B5240',
          800: '#573F2E',
          900: '#4A3525',
          950: '#2E2016',
        },
        // 30% Cocoa surfaces — cards, panels, nav
        navy: {
          DEFAULT: '#FFFFFF',
          50: '#FDF8F5',
          100: '#F6EDE5',
          300: '#CBB8A7',
          400: '#E2D0C1',
          500: '#9C8574',
          600: '#32251B',
          700: '#3A2C21',
          800: '#46372A',
          900: '#1F1610',
        },
        // 10% Terracotta — actionable / important / selected (spec §6)
        gold: {
          DEFAULT: '#E06A3B',
          50: '#FDF0EA',
          100: '#FADCCB',
          200: '#F6C0A3',
          300: '#F08A5D',
          400: '#E06A3B',
          500: '#C9501F',
          600: '#B24A1E',
          700: '#8A3A18',
          800: '#6B2C12',
          900: '#4A1D0A',
        },
        // Elevated surface token
        surface: {
          DEFAULT: '#FFFFFF',
          light: '#FFFFFF',
        },
        // Text / borders / status (spec §6)
        cream: '#FDF8F5',
        muted: '#9C8574',
        line: '#EEE2D8',
        success: {
          DEFAULT: '#2E9E6E',
          50: '#E6F5EF',
          100: '#C9EBDA',
          500: '#1FA971',
        },
        warning: {
          DEFAULT: '#C98A1B',
          50: '#FBF3E5',
          100: '#F6E3C4',
        },
        error: {
          DEFAULT: '#D64545',
          50: '#FBE8E8',
          100: '#F5CDCD',
          500: '#B03535',
        },
        // Legacy palette kept for backward compatibility with untouched surfaces.
        burntOrange: '#C9501F',
      },
      borderRadius: {
        sm: '8px',
        md: '14px',
        lg: '20px',
        xl: '24px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(74, 53, 37, 0.06), 0 18px 45px -20px rgba(74, 53, 37, 0.22)',
        'card-hover': '0 1px 2px rgba(74, 53, 37, 0.06), 0 24px 55px -20px rgba(74, 53, 37, 0.32)',
        float: '0 1px 2px rgba(74, 53, 37, 0.12), 0 24px 48px -16px rgba(74, 53, 37, 0.35)',
      },
      transitionDuration: {
        fast: '160ms',
        normal: '240ms',
        slow: '480ms',
      },
      keyframes: {
        'fade-in-up': {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-400px 0' },
          '100%': { backgroundPosition: '400px 0' },
        },
      },
      animation: {
        'fade-in-up': 'fade-in-up 0.45s cubic-bezier(0.22, 1, 0.36, 1) both',
        shimmer: 'shimmer 1.6s linear infinite',
      },
    },
  },
  plugins: [],
}
