import type { Config } from 'tailwindcss';

const config = {
  darkMode: 'media',
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-conic':
          'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'var(--radius)',
        sm: 'var(--radius)',
      },
      spacing: {
        'toolbar':       '44px',
        'pos-toolbar':   '48px',
        'nav':           '220px',
        'props-panel':   '280px',
        'panel-x':       '14px',
        'nav-item':      '7px',
        'breadcrumb-h':  '32px',
        'table-cell-x':  '11px',
        'table-cell-y':  '6px',
        'kpi-min':       '130px',
        'icon-xs':       '13px',
        'icon-sm':       '14px',
        'topbar-btn':    '38px',
      },
      fontSize: {
        'nav':           ['12.5px', { lineHeight: '1.4' }],
        'nav-child':     ['12px',   { lineHeight: '1.4' }],
        'nav-section':   ['10px',   { lineHeight: '1' }],
        'table-header':  ['11px',   { lineHeight: '1.4' }],
        'table-body':    ['12px',   { lineHeight: '1.4' }],
        'panel-title':   ['13px',   { lineHeight: '1.4' }],
        'breadcrumb':    ['11px',   { lineHeight: '1' }],
        'kpi-value':     ['26px',   { lineHeight: '1' }],
        'kpi-label':     ['10px',   { lineHeight: '1.2' }],
        'tile-label':    ['11px',   { lineHeight: '1.3' }],
      },
      letterSpacing: {
        'nav-section':  '0.07em',
        'kpi':          '0.04em',
        'table-header': '0.04em',
      },
      transitionDuration: {
        'instant': '80ms',
        'fast':    '150ms',
        'medium':  '300ms',
      },
      borderWidth: {
        'selection': '3px',
      },      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
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
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          foreground: 'hsl(var(--warning-foreground))',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        /* Nav tree tokens */
        nav: {
          DEFAULT: 'hsl(var(--nav))',
          foreground: 'hsl(var(--nav-foreground))',
          muted: 'hsl(var(--nav-muted))',
          hover: 'hsl(var(--nav-hover))',
          active: 'hsl(var(--nav-active))',
          'active-foreground': 'hsl(var(--nav-active-foreground))',
          'active-bar': 'hsl(var(--nav-active-bar))',
          border: 'hsl(var(--nav-border))',
        },
        /* Topbar tokens */
        topbar: {
          DEFAULT: 'hsl(var(--topbar))',
          foreground: 'hsl(var(--topbar-foreground))',
          muted: 'hsl(var(--topbar-muted))',
        },
        /* Properties panel tokens */
        props: {
          DEFAULT: 'hsl(var(--props))',
          foreground: 'hsl(var(--props-foreground))',
          border: 'hsl(var(--props-border))',
        },
        /* KPI tile tokens */
        tile: {
          DEFAULT: 'hsl(var(--tile))',
          foreground: 'hsl(var(--tile-foreground))',
          warn: 'hsl(var(--tile-warn))',
          danger: 'hsl(var(--tile-danger))',
          success: 'hsl(var(--tile-success))',
        },
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar))',
          foreground: 'hsl(var(--sidebar-foreground))',
          accent: 'hsl(var(--sidebar-accent))',
          'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
          border: 'hsl(var(--sidebar-border))',
        },
        chart: {
          '1': 'hsl(var(--chart-1))',
          '2': 'hsl(var(--chart-2))',
          '3': 'hsl(var(--chart-3))',
          '4': 'hsl(var(--chart-4))',
          '5': 'hsl(var(--chart-5))',
        },
      },
      animation: {},
    },
  },
  plugins: [],
} satisfies Config;

export default config;
