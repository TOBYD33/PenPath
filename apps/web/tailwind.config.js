/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        "bg-base": "#FFFFFF",
        "bg-secondary": "#F7F8F7",
        "brand-primary": "#1B5E3A",
        "brand-dark": "#124529",
        accent: "#C1592B",
        "accent-light": "#E08B5C",
        "text-primary": "#1F2421",
        "text-muted": "#6B7570",
        border: "#E2E5E3",
        "status-success": "#3E8E5C",
        "status-warning": "#D98B3A",
        "status-error": "#B3403A",
      },
    },
  },
  plugins: [],
};
