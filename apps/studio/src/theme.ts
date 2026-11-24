import { useEffect, useState } from "preact/hooks";

/**
 * Light, dark, or as the system says. The design system reads `data-theme` on the root element
 * (packages/design tokens.css); index.html sets it before the first paint from the same key.
 */
export type Theme = "auto" | "light" | "dark";
export const THEMES: readonly Theme[] = ["auto", "light", "dark"];
export const THEME_LABEL: Record<Theme, string> = { auto: "Theme: as the system", light: "Theme: light", dark: "Theme: dark" };
const KEY = "theme";

const read = (): Theme => { try { const v = localStorage.getItem(KEY); return v === "light" || v === "dark" ? v : "auto"; } catch { return "auto"; } };
const dark = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)");

let theme = read();
const listeners = new Set<(t: Theme) => void>();

function apply() {
  const mq = dark();
  document.documentElement.setAttribute("data-theme", theme === "auto" ? (mq && mq.matches ? "dark" : "light") : theme);
}
const mq = dark();
if (mq) mq.addEventListener("change", () => { if (theme === "auto") apply(); });

export const getTheme = () => theme;
export function setTheme(t: Theme) {
  theme = t;
  try { if (t === "auto") localStorage.removeItem(KEY); else localStorage.setItem(KEY, t); } catch { /* private mode: kept for this session */ }
  apply();
  for (const cb of listeners) cb(t);
}
/** What is showing right now, whichever way it was chosen. */
export const shownTheme = (): "light" | "dark" => (document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light");

export function useTheme(): [Theme, (t: Theme) => void] {
  const [t, set] = useState(theme);
  useEffect(() => { listeners.add(set); set(theme); return () => { listeners.delete(set); }; }, []);
  return [t, setTheme];
}
