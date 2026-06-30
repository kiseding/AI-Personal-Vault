/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}", "./worker/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "SF Pro Text",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "system-ui",
          "sans-serif",
        ],
      },
      colors: {
        // Apple 风格中性色调
        ink: {
          50: "#f7f7f8",
          100: "#eeeef1",
          200: "#d8d9de",
          300: "#b6b8c0",
          400: "#8e909a",
          500: "#6e707a",
          600: "#56585f",
          700: "#44454a",
          800: "#2d2e31",
          900: "#1c1c1e",
          950: "#0e0e10",
        },
        accent: {
          DEFAULT: "#0a84ff",
          hover: "#0071e3",
        },
      },
      borderRadius: {
        xl: "0.875rem",
        "2xl": "1.25rem",
      },
      transitionTimingFunction: {
        apple: "cubic-bezier(0.4, 0.0, 0.2, 1)",
      },
    },
  },
  plugins: [],
};
