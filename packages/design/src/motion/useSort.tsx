import type { ComponentChildren, JSX } from "preact";
import { createPortal } from "preact/compat";
import { useRef, useState } from "preact/hooks";

interface Drag { from: number; to: number; x: number; y: number; w: number; h: number; size: number; root: Element }
/** Where a dragged item can go besides its own list (`useSort`'s `out`). */
export interface SortOut { over: (from: number, e: PointerEvent) => boolean; drop: (from: number, e: PointerEvent) => boolean }

/**
 * Reordering a list by dragging, with the pointer and a ghost of our own (no native drag and drop):
 * the dragged item follows the pointer, the others make room. Children of one parent that carry
 * `data-sort` are the items; `onMove(from, to)` gets the item's old and new index.
 *
 * `start(i)` goes on an item (or its handle) as `onPointerDown`, `style(i)` on the item, and
 * `ghost(render)` once next to the list. `keys(i, count)` goes on a focusable item or handle as
 * `onKeyDown`: Alt with an arrow along the axis moves it one place, so nothing needs a pointer.
 *
 * `out` lets an item be dragged out of the list onto something else (a content card onto a progression's
 * track): while `over` says the pointer is there the list keeps its order, and when `drop` takes the item
 * on release, the list is not reordered.
 */
export function useSort(axis: "x" | "y", onMove: (from: number, to: number) => void, out?: SortOut) {
  const outRef = useRef(out);
  outRef.current = out;
  const [drag, setDrag] = useState<Drag | null>(null);
  const live = useRef<Drag | null>(null);
  const start = (index: number) => (e: JSX.TargetedPointerEvent<HTMLElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("[data-nodrag], input, .oc-menu-host")) return;
    const el = e.currentTarget, list = el.closest("[data-sort]")?.parentElement ?? el.parentElement!, sx = e.clientX, sy = e.clientY;
    let rects: DOMRect[] | null = null;
    const move = (m: PointerEvent) => {
      if (!rects) { if (Math.hypot(m.clientX - sx, m.clientY - sy) < 5) return; rects = [...list.querySelectorAll(":scope > [data-sort]")].map((c) => c.getBoundingClientRect()); }
      const r = rects[index], p = axis === "x" ? m.clientX : m.clientY;
      const away = outRef.current?.over(index, m) ?? false;
      const to = away ? index : rects.filter((q, i) => i !== index && (axis === "x" ? q.left + q.width / 2 : q.top + q.height / 2) < p).length;
      const gap = rects.length > 1 ? (axis === "x" ? rects[1].left - rects[0].right : rects[1].top - rects[0].bottom) : 0;
      const d: Drag = { from: index, to, x: r.left + m.clientX - sx, y: r.top + m.clientY - sy, w: r.width, h: r.height, size: (axis === "x" ? r.width : r.height) + gap, root: el.closest("[data-theme]") ?? document.body };
      live.current = d; setDrag(d);
    };
    const up = (e: PointerEvent) => {
      removeEventListener("pointermove", move); removeEventListener("pointerup", up);
      const d = live.current; live.current = null; setDrag(null);
      if (!d) return;
      if (outRef.current?.drop(d.from, e)) { /* taken by what it was dropped on */ } else if (d.to !== d.from) onMove(d.from, d.to);
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
  const ghost = (children: (from: number) => ComponentChildren) => drag && createPortal(<div className="oc-sort-ghost" style={{ left: drag.x, top: drag.y, width: drag.w, height: drag.h }}>{children(drag.from)}</div>, drag.root);
  /** Alt + an arrow along the axis moves item `i` one place; focus follows it. */
  const keys = (i: number, count: number) => (e: JSX.TargetedKeyboardEvent<HTMLElement>) => {
    if (!e.altKey) return;
    const back = axis === "x" ? "ArrowLeft" : "ArrowUp", on = axis === "x" ? "ArrowRight" : "ArrowDown";
    const to = e.key === back ? i - 1 : e.key === on ? i + 1 : -1;
    if (to < 0 || to >= count) return;
    e.preventDefault(); e.stopPropagation();
    const item = e.currentTarget.closest("[data-sort]") ?? e.currentTarget, list = item.parentElement, own = e.currentTarget === item ? null : [...item.querySelectorAll("*")].indexOf(e.currentTarget);
    onMove(i, to);
    requestAnimationFrame(() => { const next = list?.querySelectorAll(":scope > [data-sort]")[to] as HTMLElement | undefined; ((own != null ? next?.querySelectorAll("*")[own] : next) as HTMLElement | undefined)?.focus(); });
  };
  return { start, style, ghost, keys, dragging: drag?.from ?? null };
}

/** `list` with the item at `from` moved to index `to`. */
export const moved = <T,>(list: readonly T[], from: number, to: number): T[] => { const out = [...list], [x] = out.splice(from, 1); out.splice(to, 0, x); return out; };
