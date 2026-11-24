import { useEffect, useState } from "preact/hooks";

/**
 * Personal preferences (docs/rewrite/09-shells.md): what follows the account, not the browser.
 * One store with one shape; where it is kept is this module's business alone. For now that is the
 * browser; the last part of build step B1 moves it into a file of the account home, and nothing
 * outside this module changes.
 */
export type Edge = "bottom" | "top" | "left" | "right";

/** What a taskbar pin opens: an app, or a file by its id. */
export type Pin = { app: string } | { file: string };

export interface Prefs {
  taskbarEdge: Edge;
  taskbarAlign: "start" | "center";
  /** The taskbar's pins per project, in order. A project without an entry gets the default pins. */
  pins: Record<string, Pin[]>;
}

export const DEFAULT_PREFS: Prefs = { taskbarEdge: "bottom", taskbarAlign: "start", pins: {} };
const KEY = "prefs";

function read(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) } : DEFAULT_PREFS;
  } catch { return DEFAULT_PREFS; }
}

let prefs = read();
const listeners = new Set<(p: Prefs) => void>();

export const getPrefs = () => prefs;
export function setPrefs(change: Partial<Prefs>) {
  prefs = { ...prefs, ...change };
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* private mode: kept for this session */ }
  for (const cb of listeners) cb(prefs);
}
export function usePrefs(): Prefs {
  const [p, set] = useState(prefs);
  useEffect(() => { listeners.add(set); set(prefs); return () => { listeners.delete(set); }; }, []);
  return p;
}

export const samePin = (a: Pin, b: Pin) => ("app" in a ? "app" in b && a.app === b.app : "file" in b && a.file === b.file);
