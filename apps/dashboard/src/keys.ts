import { useEffect, useRef } from "preact/hooks";
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
 * Keyboard shortcuts for one surface. Keys are matched against `e.key` with modifier prefixes
 * ("Alt+ArrowUp", "Shift+N", "Mod+s" where Mod is Ctrl or ⌘). Plain keys never fire while typing;
 * modified keys do (⌘S in the JSON editor). The handler returns false to let the event through.
 */
export function useKeys(map: Record<string, (e: KeyboardEvent) => void | boolean>, enabled = true) {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    if (!enabled) return;
    const on = (e: KeyboardEvent) => {
      if (e.defaultPrevented || overlayOpen()) return;
      const t = e.target as HTMLElement | null;
      // Enter and Space belong to the focused button or link.
      if ((e.key === "Enter" || e.key === " ") && t && (t.tagName === "BUTTON" || t.tagName === "A")) return;
      const mod = e.metaKey || e.ctrlKey;
      const name = `${mod ? "Mod+" : ""}${e.altKey ? "Alt+" : ""}${e.shiftKey && e.key.length > 1 ? "Shift+" : ""}${e.key}`;
      const typing = !mod && !e.altKey && isTyping(e) && e.key !== "Escape";
      if (name === "g" && !typing) lastG = Date.now();
      const fn = ref.current[name] ?? (e.shiftKey && e.key.length === 1 ? ref.current[`Shift+${e.key.toUpperCase()}`] : undefined);
      if (!fn || typing) return;
      if (fn(e) === false) return;
      e.preventDefault();
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [enabled]);
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
