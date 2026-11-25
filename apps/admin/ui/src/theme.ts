import { useEffect, useState } from "preact/hooks";
import type { IconName } from "@openclapper/design";

/**
 * Light, dark, or as the system says, as in the Studio (apps/studio/src/theme.ts): the design system reads
 * `data-theme` on the root element; index.html sets it before the first paint from the same key.
 */
export type Theme = "auto" | "light" | "dark";
export const NEXT: Record<Theme, Theme> = { auto: "light", light: "dark", dark: "auto" };
export const LABEL: Record<Theme, string> = { auto: "Theme: as the system", light: "Theme: light", dark: "Theme: dark" };
export const GLYPH: Record<Theme, IconName> = { auto: "contrast", light: "sun", dark: "moon" };
const read = (): Theme => { try { const v = localStorage.getItem("theme"); return v === "light" || v === "dark" ? v : "auto"; } catch { return "auto"; } };
function apply(t: Theme) {
  const dark = typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.setAttribute("data-theme", t === "auto" ? (dark ? "dark" : "light") : t);
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [t, set] = useState(read);
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const follow = () => { if (read() === "auto") apply("auto"); };
    mq.addEventListener("change", follow);
    return () => mq.removeEventListener("change", follow);
  }, []);
  return [t, (next) => { try { if (next === "auto") localStorage.removeItem("theme"); else localStorage.setItem("theme", next); } catch { /* private window */ } apply(next); set(next); }];
}
