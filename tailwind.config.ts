import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/client/**/*.{ts,tsx}"],
  corePlugins: {
    preflight: false
  },
  theme: {
    extend: {
      colors: {
        md3: {
          background: "var(--md3-background)",
          onBackground: "var(--md3-on-background)",
          surface: "var(--md3-surface)",
          surfaceContainer: "var(--md3-surface-container)",
          surfaceContainerLow: "var(--md3-surface-container-low)",
          primary: "var(--md3-primary)",
          onPrimary: "var(--md3-on-primary)",
          primaryContainer: "var(--md3-primary-container)",
          onPrimaryContainer: "var(--md3-on-primary-container)",
          secondaryContainer: "var(--md3-secondary-container)",
          onSecondaryContainer: "var(--md3-on-secondary-container)",
          tertiary: "var(--md3-tertiary)",
          onTertiary: "var(--md3-on-tertiary)",
          outline: "var(--md3-outline)",
          outlineVariant: "var(--md3-outline-variant)",
          onSurfaceVariant: "var(--md3-on-surface-variant)",
          danger: "var(--md3-danger)",
          dangerContainer: "var(--md3-danger-container)",
          successContainer: "var(--md3-success-container)"
        }
      },
      borderRadius: {
        md3xs: "var(--md3-radius-xs)",
        md3s: "var(--md3-radius-s)",
        md3m: "var(--md3-radius-m)",
        md3l: "var(--md3-radius-l)",
        md3xl: "var(--md3-radius-xl)",
        md32xl: "var(--md3-radius-2xl)"
      },
      boxShadow: {
        md31: "var(--md3-shadow-1)",
        md32: "var(--md3-shadow-2)"
      },
      transitionTimingFunction: {
        md3: "var(--md3-easing-standard)"
      },
      transitionDuration: {
        md3fast: "var(--md3-duration-fast)",
        md3: "var(--md3-duration-standard)"
      }
    }
  },
  plugins: []
};

export default config;
