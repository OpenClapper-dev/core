import type { ComponentChildren } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { reducedMotion } from "./motion";

/** Longest exit (--dur-slow) plus a margin, in case `transitionend` never comes (a hidden tab). */
const EXIT_MS = 280;

/**
 * Keeps a modal-like overlay on screen while it fades out (docs/design.md "Motion"). When `show`
 * turns false, the last children stay rendered, their root gets `is-leaving` (motion.css styles the
 * exit) and loses `data-overlay` at once, so the page's shortcuts are live again during the exit;
 * they unmount when the root's or a direct child's opacity transition ends. Under reduced motion
 * they unmount at once. Showing again mid-exit mounts a fresh copy.
 */
export function Presence({ show, children }: { show: boolean; children: ComponentChildren }) {
  const [mounted, setMounted] = useState(show);
  const [gen, setGen] = useState(0);
  const last = useRef(children);
  const box = useRef<HTMLDivElement>(null);
  const leaving = useRef(false);
  if (show) last.current = children;

  useLayoutEffect(() => {
    if (show) {
      if (leaving.current) { leaving.current = false; setGen((g) => g + 1); }
      setMounted(true);
      return;
    }
    const el = box.current?.firstElementChild;
    if (!el || reducedMotion()) { setMounted(false); return; }
    leaving.current = true;
    el.classList.add("is-leaving");
    el.removeAttribute("data-overlay");
    const end = () => { leaving.current = false; setMounted(false); };
    // transitionend bubbles: only the root's own fade (or a direct child's, like the modal) ends it.
    const onEnd = (e: Event) => { const t = e.target as Element; if ((e as TransitionEvent).propertyName === "opacity" && (t === el || t.parentElement === el)) end(); };
    el.addEventListener("transitionend", onEnd);
    const timer = setTimeout(end, EXIT_MS);
    return () => { clearTimeout(timer); el.removeEventListener("transitionend", onEnd); };
  }, [show]);

  if (!show && !mounted) return null;
  return <div key={gen} ref={box} style={{ display: "contents" }}>{show ? children : last.current}</div>;
}
