import type { JSX } from "preact";
import { useRef, useState } from "preact/hooks";

/** Interactive things inside a pane where a press is theirs, not the start of a rectangle. */
const OWN = "button, input, textarea, select, a, label, [contenteditable], [role=checkbox], [role=slider], [data-no-marquee]";

/**
 * Selecting with a rectangle, as in an OS file manager: a press on the empty part of a pane clears the
 * selection (Ctrl/⌘ keeps it), dragging draws a rectangle and selects every item it touches. Items are
 * the elements matching `items`, each naming its id in `attr`. Put `onPointerDown` on the scrolling
 * pane (positioned, so the rectangle lies in it) and render `band` inside it.
 */
export function useMarquee({ items, attr, selected, onSelect }: { items: string; attr: string; selected: readonly string[]; onSelect: (ids: string[]) => void }) {
  const [band, setBand] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const latest = useRef(selected);
  latest.current = selected;
  const onPointerDown = (e: JSX.TargetedPointerEvent<HTMLElement>) => {
    const t = e.target as Element;
    if (e.button !== 0 || t.closest(items) || t.closest(OWN)) return;
    const pane = e.currentTarget;
    const at = (x: number, y: number) => { const r = pane.getBoundingClientRect(); return { x: x - r.left + pane.scrollLeft, y: y - r.top + pane.scrollTop }; };
    const from = at(e.clientX, e.clientY);
    const keep = e.ctrlKey || e.metaKey ? [...latest.current] : [];
    if (!keep.length && latest.current.length) onSelect([]);
    let last = { x: e.clientX, y: e.clientY }, drawn = false;
    const hit = () => {
      const p = at(last.x, last.y);
      const r = { x: Math.min(from.x, p.x), y: Math.min(from.y, p.y), w: Math.abs(p.x - from.x), h: Math.abs(p.y - from.y) };
      if (!drawn && r.w < 4 && r.h < 4) return;
      drawn = true;
      setBand(r);
      const pr = pane.getBoundingClientRect();
      const ids = [...pane.querySelectorAll(items)].filter((el) => {
        const b = el.getBoundingClientRect(), x = b.left - pr.left + pane.scrollLeft, y = b.top - pr.top + pane.scrollTop;
        return x < r.x + r.w && x + b.width > r.x && y < r.y + r.h && y + b.height > r.y;
      }).map((el) => el.getAttribute(attr)).filter((id): id is string => !!id);
      onSelect([...new Set([...keep, ...ids])]);
    };
    // Near an edge the pane scrolls, as a file manager's does.
    const timer = setInterval(() => {
      const r = pane.getBoundingClientRect(), dy = last.y < r.top + 16 ? -16 : last.y > r.bottom - 16 ? 16 : 0;
      if (dy && drawn) { pane.scrollTop += dy; hit(); }
    }, 40);
    const move = (ev: PointerEvent) => { last = { x: ev.clientX, y: ev.clientY }; hit(); };
    const up = () => { clearInterval(timer); pane.removeEventListener("pointermove", move); pane.removeEventListener("pointerup", up); pane.removeEventListener("pointercancel", up); setBand(null); };
    pane.setPointerCapture(e.pointerId);
    pane.addEventListener("pointermove", move);
    pane.addEventListener("pointerup", up);
    pane.addEventListener("pointercancel", up);
  };
  return { onPointerDown, band: band && <div className="oc-marquee" style={{ left: band.x, top: band.y, width: band.w, height: band.h }} /> };
}

/**
 * What a click on an item does to a selection, as in an OS file manager: alone it selects only that
 * item, Ctrl/⌘ adds or removes it, Shift selects the range from the anchor (the last item clicked).
 */
export function clickSelect(order: readonly string[], selected: readonly string[], anchor: string | null, id: string, e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): string[] {
  const add = e.ctrlKey || e.metaKey;
  if (e.shiftKey && anchor && order.includes(anchor)) {
    const a = order.indexOf(anchor), b = order.indexOf(id);
    const range = order.slice(Math.min(a, b), Math.max(a, b) + 1);
    return add ? [...new Set([...selected, ...range])] : range;
  }
  if (add) return selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
  return [id];
}
