import { useContext, useEffect, useRef } from "preact/hooks";
import { GLOBAL, liveMaps, register, WindowIdContext } from "./wm/keyboard";
import { shortcut, type ActionOf, type ScopeId } from "./shortcuts";

/** True while focus is in a text field: single-key shortcuts must not fire then. */
export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA" || t.isContentEditable);
}

let lastG = 0;
/** True right after a plain "G": the next key is a section jump (G S, G R, …), not a page shortcut. */
export const afterG = () => Date.now() - lastG < 1200;

/** A dialog, palette or sheet is open: page shortcuts pause (the overlay handles its own keys). */
export const overlayOpen = () => !!document.querySelector("[data-overlay]");

/**
 * The key as the maps name it: `e.key` with modifier prefixes. With Alt a letter is taken from the
 * physical key, since Option (Mac) and AltGr (Ctrl+Alt on Windows) turn `e.key` into a symbol.
 */
function keyName(e: KeyboardEvent): string {
  const letter = e.altKey && /^Key[A-Z]$/.test(e.code) ? e.code.slice(3) : null;
  const key = letter ? (e.shiftKey ? letter : letter.toLowerCase()) : e.key;
  return `${e.metaKey || e.ctrlKey ? "Mod+" : ""}${e.altKey ? "Alt+" : ""}${e.shiftKey && key.length > 1 ? "Shift+" : ""}${key}`;
}

/**
 * The one window keydown listener (epic #72): a key goes to the focused window's maps, then the
 * global ones (wm/keyboard.ts), and the first map that handles it wins.
 */
function onKeyDown(e: KeyboardEvent) {
  if (e.defaultPrevented || overlayOpen()) return;
  const t = e.target as HTMLElement | null;
  // Enter and Space belong to the focused button or link.
  if ((e.key === "Enter" || e.key === " ") && t && (t.tagName === "BUTTON" || t.tagName === "A")) return;
  const mod = e.metaKey || e.ctrlKey;
  const name = keyName(e);
  const typing = !mod && !e.altKey && isTyping(e) && e.key !== "Escape";
  if (name === "g" && !typing) lastG = Date.now();
  if (typing) return;
  for (const map of liveMaps()) {
    const fn = map[name] ?? (e.shiftKey && e.key.length === 1 ? map[`Shift+${e.key.toUpperCase()}`] : undefined);
    if (!fn) continue;
    if (fn(e) === false) continue;
    e.preventDefault();
    return;
  }
}
let listening = false;

/**
 * Keyboard shortcuts for one surface. Keys are matched against `e.key` with modifier prefixes
 * ("Alt+ArrowUp", "Shift+N", "Mod+s" where Mod is Ctrl or ⌘). Plain keys never fire while typing;
 * modified keys do (⌘S in the JSON editor). The handler returns false to let the event through.
 * Inside a window the map only hears keys while that window has focus.
 */
export function useKeys(map: Record<string, (e: KeyboardEvent) => void | boolean>, enabled = true) {
  const ref = useRef(map);
  ref.current = map;
  const owner = useContext(WindowIdContext) ?? GLOBAL;
  useEffect(() => {
    if (!enabled) return;
    if (!listening) { listening = true; window.addEventListener("keydown", onKeyDown); }
    return register(owner, ref);
  }, [enabled, owner]);
}

type Handler = (e: KeyboardEvent) => void | boolean;

/**
 * A useKeys map for one scope of the registry (shortcuts.ts): each handler is put under its entry's
 * keys. Plain letters step aside right after G (the next key is a section jump); chord entries fire
 * only then. Handlers sharing a key run in turn until one does not return false.
 */
export function bind<S extends ScopeId>(scope: S, handlers: Partial<Record<ActionOf<S>, Handler>>): Record<string, Handler> {
  const byKey = new Map<string, Handler[]>();
  for (const [action, fn] of Object.entries(handlers) as [string, Handler | undefined][]) {
    const s = shortcut(scope, action);
    if (!fn || !s || s.info) continue;
    for (const k of s.keys) {
      const guarded: Handler = s.chord ? (e) => (afterG() ? fn(e) : false) : /^[a-z]$/i.test(k) ? (e) => (afterG() ? false : fn(e)) : fn;
      byKey.set(k, [...(byKey.get(k) ?? []), guarded]);
    }
  }
  return Object.fromEntries([...byKey].map(([k, fns]) => [k, (e: KeyboardEvent) => {
    for (const fn of fns) if (fn(e) !== false) return;
    return false;
  }]));
}

/** ⇧ + an arrow moves a frame by 1 % of the photo (Framing stage and inline re-frame). */
export const NUDGE: Record<string, [number, number]> = { ArrowLeft: [-0.01, 0], ArrowRight: [0.01, 0], ArrowUp: [0, -0.01], ArrowDown: [0, 0.01] };
