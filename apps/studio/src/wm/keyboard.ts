import { createContext } from "preact";

/**
 * Who may hear a key (epic #72). Every useKeys map registers here under an owner: the id of the
 * window it renders in (WindowIdContext), or "global" outside any window (the shell, overlays).
 * keys.ts dispatches a key to the focused window's maps first, then the global ones, so two
 * windows of the same app never both react. Within an owner, maps keep registration order
 * (children register before their parents, as the per-hook listeners did before).
 */

export type Handler = (e: KeyboardEvent) => void | boolean;
export type KeyMap = Record<string, Handler>;

/** The window an app renders in; null outside any window. */
export const WindowIdContext = createContext<string | null>(null);

export const GLOBAL = "global";

interface Reg { owner: string; map: { current: KeyMap } }
let regs: Reg[] = [];
let focusedOwner: () => string | null = () => null;

/** The shell tells the dispatcher which window has focus (the wm store). */
export function setFocusSource(get: () => string | null) { focusedOwner = get; }

/** Add a map; `map.current` is read at key time, so handlers stay fresh. Returns the removal. */
export function register(owner: string, map: { current: KeyMap }): () => void {
  const reg = { owner, map };
  regs = [...regs, reg];
  return () => { regs = regs.filter((r) => r !== reg); };
}

/** The maps a key press may reach right now, in dispatch order. */
export function liveMaps(): KeyMap[] {
  const f = focusedOwner();
  return [...regs.filter((r) => f !== null && r.owner === f), ...regs.filter((r) => r.owner === GLOBAL)].map((r) => r.map.current);
}
