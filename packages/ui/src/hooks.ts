/** Small behaviour hooks shared by the overlay-style components (select, popover, scope switch, multi-pick). */
import { useEffect, useRef } from "preact/hooks";

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
