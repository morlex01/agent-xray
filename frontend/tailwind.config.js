/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        page: "#f4f2ee",
        surface: "#ffffff",
        ink: {
          DEFAULT: "#0a0a0a",
          soft: "#1a1a1a",
          mute: "#3d3d3d",
          faint: "#6b6b6b",
        },
        line: {
          DEFAULT: "#0a0a0a",
          soft: "#cfcbc4",
          faint: "#e5e1da",
        },
        jev: {
          DEFAULT: "#e11d7a",
          soft: "#f472b6",
          pale: "#fce7f3",
          ink: "#9d174d",
        },
        electric: {
          DEFAULT: "#2563eb",
          soft: "#93c5fd",
          pale: "#dbeafe",
        },
        fail: "#dc2626",
        ok: "#16a34a",
        warn: "#d97706",
        terminal: "#0a0a0a",
      },
      fontFamily: {
        sans: ["Space Grotesk", "Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "IBM Plex Mono", "ui-monospace", "monospace"],
      },
      borderRadius: {
        sm: "2px",
        DEFAULT: "4px",
        md: "4px",
        lg: "6px",
      },
      boxShadow: {
        panel: "0 1px 0 rgba(10,10,10,0.04)",
      },
    },
  },
  plugins: [],
};
