import type { JSX, RefObject } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

interface Box { left: number; top: number; width: number; height: number }

/**
 * The sliding selection of Segmented, TabBar and BottomTabs. Returns a ref for the container and an element
 * to render inside it; the element moves to the child matching `selector`. The first placement is instant so
 * nothing slides in on mount.
 */
export function useIndicator<T extends HTMLElement>(selector: string, dep: unknown): [RefObject<T>, JSX.Element | null] {
  const ref = useRef<T>(null);
  const [box, setBox] = useState<Box | null>(null);
  const first = useRef(true);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      const sel = el.querySelector(selector);
      if (!sel) { setBox(null); return; }
      // Measured in layout pixels: a scaled ancestor (task view) must not distort the box.
      const a = el.getBoundingClientRect(), b = sel.getBoundingClientRect();
      const sx = el.offsetWidth ? a.width / el.offsetWidth : 1, sy = el.offsetHeight ? a.height / el.offsetHeight : 1;
      const cs = getComputedStyle(el), bl = parseFloat(cs.borderLeftWidth) || 0, bt = parseFloat(cs.borderTopWidth) || 0;
      setBox({ left: (b.left - a.left) / sx - bl + el.scrollLeft, top: (b.top - a.top) / sy - bt, width: b.width / sx, height: b.height / sy });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    void document.fonts.ready.then(measure);
    return () => ro.disconnect();
  }, [dep, selector]);
  useEffect(() => { if (box) first.current = false; }, [box]);
  const indicator = box ? <span className={`oc-ind${first.current ? " is-instant" : ""}`} aria-hidden="true" style={{ ...box }} /> : null;
  return [ref, indicator];
}
