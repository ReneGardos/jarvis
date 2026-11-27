import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0b0d12",
        panel: "#11141b",
        panel2: "#171b24",
        line: "#232836",
        muted: "#8b93a7",
        accent: { DEFAULT: "#5b8cff", soft: "#5b8cff22" },
        ok: "#3ecf8e",
        warn: "#f5b544",
        bad: "#f06a6a",
      },
      fontFamily: { sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"] },
      keyframes: {
        fadein: { from: { opacity: "0", transform: "translateY(4px)" }, to: { opacity: "1", transform: "none" } },
        pulsering: { "0%,100%": { transform: "scale(1)", opacity: "0.6" }, "50%": { transform: "scale(1.15)", opacity: "1" } },
      },
      animation: { fadein: "fadein .25s ease-out", pulsering: "pulsering 1.6s ease-in-out infinite" },
    },
  },
  plugins: [],
} satisfies Config;
