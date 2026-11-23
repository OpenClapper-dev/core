// Reordering by dragging, with the pointer and a ghost of our own (no native drag and drop): the dragged item follows
// the pointer, the others make room. For the content list and the progression of the U3 prototype.
import type { ComponentChildren, JSX } from "preact";
import { createPortal } from "preact/compat";
import { useRef, useState } from "preact/hooks";

interface Drag { from: number; to: number; x: number; y: number; w: number; h: number; size: number; root: Element }

/** Children of one parent that carry `data-sort` are the items. `onMove(from, to)`: `to` is the item's new index. */
export function useSort(axis: "x" | "y", onMove: (from: number, to: number) => void) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const live = useRef<Drag | null>(null);
  const start = (index: number) => (e: JSX.TargetedPointerEvent<HTMLElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("[data-nodrag], input, .oc-menu-host")) return;
    const el = e.currentTarget, list = el.parentElement!, sx = e.clientX, sy = e.clientY;
    let rects: DOMRect[] | null = null;
    const move = (m: PointerEvent) => {
      if (!rects) { if (Math.hypot(m.clientX - sx, m.clientY - sy) < 5) return; rects = [...list.querySelectorAll(":scope > [data-sort]")].map((c) => c.getBoundingClientRect()); }
      const r = rects[index], p = axis === "x" ? m.clientX : m.clientY;
      const to = rects.filter((q, i) => i !== index && (axis === "x" ? q.left + q.width / 2 : q.top + q.height / 2) < p).length;
      const gap = rects.length > 1 ? (axis === "x" ? rects[1].left - rects[0].right : rects[1].top - rects[0].bottom) : 0;
      const d: Drag = { from: index, to, x: r.left + m.clientX - sx, y: r.top + m.clientY - sy, w: r.width, h: r.height, size: (axis === "x" ? r.width : r.height) + gap, root: el.closest("[data-theme]") ?? document.body };
      live.current = d; setDrag(d);
    };
    const up = () => {
      removeEventListener("pointermove", move); removeEventListener("pointerup", up);
      const d = live.current; live.current = null; setDrag(null);
      if (!d) return;
      if (d.to !== d.from) onMove(d.from, d.to);
      // The release of a drag is not a click on what lies under it.
      const eat = (c: MouseEvent) => { c.stopPropagation(); c.preventDefault(); };
      addEventListener("click", eat, { capture: true, once: true }); setTimeout(() => removeEventListener("click", eat, { capture: true }), 0);
    };
    addEventListener("pointermove", move); addEventListener("pointerup", up);
  };
  /** The style of item `i` while something is dragged: the dragged one leaves its place, the ones it passes move over. */
  const style = (i: number): JSX.CSSProperties | undefined => {
    if (!drag) return undefined;
    if (i === drag.from) return { visibility: "hidden" };
    const by = drag.from < drag.to && i > drag.from && i <= drag.to ? -drag.size : drag.to < drag.from && i >= drag.to && i < drag.from ? drag.size : 0;
    return { transform: axis === "x" ? `translateX(${by}px)` : `translateY(${by}px)`, transition: "transform var(--dur-fast, 120ms)" };
  };
  const ghost = (children: (from: number) => ComponentChildren) => drag && createPortal(<div className="u3-ghost" style={{ left: drag.x, top: drag.y, width: drag.w, height: drag.h }}>{children(drag.from)}</div>, drag.root);
  return { start, style, ghost, dragging: drag?.from ?? null };
}

/** `list` with the item at `from` moved to index `to`. */
export const moved = <T,>(list: T[], from: number, to: number) => { const out = [...list], [x] = out.splice(from, 1); out.splice(to, 0, x); return out; };
