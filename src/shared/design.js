// Shared design tokens — values copied 1:1 from src/App.jsx so the new
// Strategy tool renders in the exact same design system. The 9-Question
// analyzer keeps its own inline copy and is intentionally left untouched;
// this module is consumed only by the new code (Root + StrategyApp).
export const C = {
  bg: "#1F1E21",
  card: "#29282C",
  card2: "#343238",
  sub: "rgba(31,30,33,0.5)",
  chip: "rgba(85,80,92,0.25)",
  line: "rgba(255,255,255,0.1)",
  green: "#6CD7A4",
  red: "#D23D40",
  blue: "#4193FF",
  amber: "#E0A458",
  text: "#fff",
  t70: "rgba(255,255,255,0.7)",
  t50: "rgba(255,255,255,0.5)",
  t40: "rgba(255,255,255,0.4)",
  t25: "rgba(255,255,255,0.25)",
};
export const INSET = "inset 0 0 0 1px rgba(255,255,255,0.1)";
export const FONT_EN = "Inter, -apple-system, BlinkMacSystemFont, sans-serif";
export const FONT_HE = "Heebo, -apple-system, BlinkMacSystemFont, sans-serif";
export const fontFor = (lang) => (lang === "he" ? FONT_HE : FONT_EN);
