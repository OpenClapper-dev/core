import type { ComponentChildren, RefObject } from "preact";
import { createPortal } from "preact/compat";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { cx } from "../util";

/**
 * A surface that floats next to a control: the list of a select, a menu, a popover. It is rendered outside the
 * place it belongs to (at the nearest themed root), so no scrolling panel, clipped row or animated section can cut
 * it off or paint over it. It follows its anchor on scroll and resize and opens upward when there is no room below.
 */
export interface FloatingProps {
  /** The control it belongs to. */
  anchor: RefObject<HTMLElement>;
  align?: "start" | "end";
  /** At least as wide as the anchor (lists of selects and comboboxes). */
  matchWidth?: boolean;
  /** Called on a press outside the anchor and the surface. */
  onDismiss?: () => void;
  className?: string;
  children?: ComponentChildren;
}

interface Place { left?: number; right?: number; top?: number; bottom?: number; minWidth?: number; maxHeight: number }

export function Floating({ anchor, align = "start", matchWidth, onDismiss, className, children }: FloatingProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<Place | null>(null);
  const root = anchor.current?.closest<HTMLElement>("[data-theme]") ?? (typeof document !== "undefined" ? document.body : null);
  const measure = () => {
    const a = anchor.current;
    if (!a) return;
    const r = a.getBoundingClientRect(), gap = 2, below = window.innerHeight - r.bottom - 8, above = r.top - 8;
    const want = Math.min(ref.current?.scrollHeight ?? 220, 320);
    const up = below < want && above > below;
    setPlace({
      ...(align === "end" ? { right: Math.max(4, window.innerWidth - r.right) } : { left: Math.max(4, Math.min(r.left, window.innerWidth - (ref.current?.offsetWidth ?? 0) - 4)) }),
      ...(up ? { bottom: window.innerHeight - r.top + gap } : { top: r.bottom + gap }),
      minWidth: matchWidth ? r.width : undefined,
      maxHeight: Math.max(96, up ? above : below),
    });
  };
  useLayoutEffect(() => { measure(); }, []);
  useEffect(() => {
    measure(); // again once the surface has its real size
    const move = () => measure();
    const press = (e: PointerEvent) => { const t = e.target as Node; if (!ref.current?.contains(t) && !anchor.current?.contains(t) && onDismiss) onDismiss(); };
    window.addEventListener("scroll", move, true); window.addEventListener("resize", move); document.addEventListener("pointerdown", press, true);
    return () => { window.removeEventListener("scroll", move, true); window.removeEventListener("resize", move); document.removeEventListener("pointerdown", press, true); };
  }, []);
  if (!root) return null;
  return createPortal(
    <div ref={ref} className={cx("oc-floating", className)} style={{ ...place, visibility: place ? undefined : "hidden" }}>{children}</div>,
    root,
  );
}
