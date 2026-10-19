/** Motion helpers (epic #156, docs/design.md "Motion"): the JS side of the reduced-motion rule. */

/** The user asked the OS for less motion: transitions are already zeroed in CSS, JS-driven motion checks this. */
export const reducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Runs a state change inside a View Transition (a crossfade or morph of the whole page), or plainly
 * when the browser has none, motion is reduced or a window gesture is running. The callback waits
 * one macrotask after `fn` so Preact (which re-renders on a microtask) has painted the new state.
 */
export function withViewTransition(fn: () => void): void {
  if (!document.startViewTransition || reducedMotion() || document.body.classList.contains("wm-gesture")) { fn(); return; }
  document.startViewTransition(async () => { fn(); await new Promise((r) => setTimeout(r)); });
}
