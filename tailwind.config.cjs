module.exports = {
  content: ["./public/index.html", "./public/js/**/*.js", "./src/**/*.{ts,js}"],
  theme: {
    extend: {
      colors: {
        navy: {
          50: "#f0f2f6",
          100: "#d9dde8",
          200: "#b3bbcf",
          300: "#8d99b7",
          400: "#67779e",
          500: "#415586",
          600: "#2e3f66",
          700: "#1a2744",
          800: "#131c32",
          900: "#0c1220",
        },
        gold: {
          50: "#fdf9ed",
          100: "#faf0cc",
          200: "#f5e199",
          300: "#f0d266",
          400: "#e0be33",
          500: "#c9a227",
          600: "#a6841e",
          700: "#836616",
          800: "#5f490e",
          900: "#3b2d06",
        },
        base: {
          50: "#ffffff",
          100: "#f8f9fa",
          200: "#e9ecef",
          300: "#dee2e6",
          400: "#ced4da",
          500: "#adb5bd",
        },
        success: { 100: "#d1fae5", 500: "#10b981", 700: "#047857" },
        warning: { 100: "#fef3c7", 500: "#f59e0b", 700: "#b45309" },
        danger: { 100: "#fee2e2", 500: "#ef4444", 700: "#b91c1c" },
      },
      fontFamily: {
        sans: ["Inter", "sans-serif"],
      },
      borderRadius: {
        "3xl": "1.25rem",
        "4xl": "1.5rem",
      },
    },
  },
};
