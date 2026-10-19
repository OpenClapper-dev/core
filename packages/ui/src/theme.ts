import { useEffect, useState } from "preact/hooks";
import { withViewTransition } from "./motion";

/** "auto" follows the OS; "sun" (light, for daylight) and "set" (dark) are manual overrides kept in localStorage. */
export type ThemeChoice = "auto" | "sun" | "set";

const mq = () => window.matchMedia?.("(prefers-color-scheme: dark)");
function stored(): ThemeChoice {
  try { const v = localStorage.getItem("theme"); return v === "sun" || v === "set" ? v : "auto"; } catch { return "auto"; }
}
function apply(choice: ThemeChoice) {
  const t = choice === "auto" ? (mq()?.matches ? "set" : "sun") : choice;
  document.documentElement.setAttribute("data-theme", t);
  // Title bar of the installed app follows the theme's surface colour.
  const surface = getComputedStyle(document.documentElement).getPropertyValue("--surface").trim();
  if (surface) document.querySelector('meta[name="theme-color"]')?.setAttribute("content", surface);
}

// Module store (settings.ts idiom) so the taskbar and the Settings window stay in sync.
let current = stored();
const listeners = new Set<(c: ThemeChoice) => void>();
if (typeof window !== "undefined") {
  apply(current); // index.html sets data-theme before first paint; this syncs the theme-color meta (no crossfade)
  mq()?.addEventListener("change", () => { if (current === "auto") void withViewTransition(() => apply("auto")); });
}

export const getTheme = () => current;
export function setTheme(c: ThemeChoice) {
  try { if (c === "auto") localStorage.removeItem("theme"); else localStorage.setItem("theme", c); } catch { /* ignore */ }
  current = c;
  // A crossfade of the whole page (#167); the buttons update inside it, so the old picture is all old.
  void withViewTransition(() => { apply(c); for (const cb of listeners) cb(c); });
}

/** The theme choice as state (the inline script in index.html sets it before first paint). */
export function useTheme(): [ThemeChoice, (c: ThemeChoice) => void] {
  const [choice, setChoice] = useState(current);
  useEffect(() => { listeners.add(setChoice); return () => { listeners.delete(setChoice); }; }, []);
  return [choice, setTheme];
}

/** The theme button's cycle (taskbar, admin header): Auto → Sun → Set → Auto. */
export const THEME_CYCLE: Record<ThemeChoice, ThemeChoice> = { auto: "sun", sun: "set", set: "auto" };
export const THEME_LABEL: Record<ThemeChoice, string> = { auto: "Theme: Auto (follows the system)", sun: "Theme: Sun", set: "Theme: Set" };
export const THEME_ICON: Record<ThemeChoice, string> = { auto: "theme-light-dark", sun: "white-balance-sunny", set: "weather-night" };
