/** Small behaviour hooks shared by the overlay-style components (select, popover, scope switch, multi-pick). */
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import type { RefObject } from "preact";

/**
 * Calls `onOutside` on a mouse press outside the element `box()` returns, while `active`.
 * A getter rather than a ref so a popover can measure against its anchor (its parent).
 */
export function useOutsideClick(box: () => Element | null | undefined, onOutside: () => void, active = true) {
  const cb = useRef(onOutside);
  cb.current = onOutside;
  useEffect(() => {
    if (!active) return;
    const h = (e: MouseEvent) => { if (!box()?.contains(e.target as Node)) cb.current(); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [active]);
}

const DROP_GAP = 4 + 8; // the list's offset from its anchor, plus air to the edge
const DROP_MIN = 96;

/**
 * Where a dropdown hangs (#196): below its anchor (the list's parent) unless the list does not fit
 * there and there is more room above, then `data-drop="up"`; either way `--drop-max` caps it to the
 * room on that side, so it scrolls instead of spilling. Room is measured inside the nearest ancestor
 * that clips vertically, else the window. Decided once per open, written to the element so no
 * re-render is needed. Sizes from offsetHeight/scrollHeight: the enter transition's translate
 * would skew getBoundingClientRect (#160).
 */
export function useDropDirection(list: RefObject<HTMLElement>, open: boolean) {
  useLayoutEffect(() => {
    const el = list.current, anchor = el?.parentElement;
    if (!open || !el || !anchor) return;
    const a = anchor.getBoundingClientRect();
    let top = 0, bottom = window.innerHeight;
    for (let p = anchor.parentElement; p; p = p.parentElement) {
      if (getComputedStyle(p).overflowY !== "visible") { const r = p.getBoundingClientRect(); top = Math.max(top, r.top); bottom = Math.min(bottom, r.bottom); break; }
    }
    const below = bottom - a.bottom - DROP_GAP, above = a.top - top - DROP_GAP;
    const need = el.scrollHeight + el.offsetHeight - el.clientHeight;
    const up = need > below && above > below;
    const room = Math.max(DROP_MIN, up ? above : below);
    if (up) el.dataset.drop = "up"; else delete el.dataset.drop;
    el.style.setProperty("--drop-max", `${Math.floor(room)}px`);
    if (need > room) el.dataset.capped = ""; else delete el.dataset.capped;
  }, [open]);
}
