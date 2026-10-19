import type { RefObject } from "preact";
import { endGesture, startGesture } from "./gesture";
import * as wm from "./wm";
import type { Rect, SnapZone, Win } from "./wm";

/** Resize handle directions (8 handles around the frame). */
export type HandleDir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export const HANDLE_DIRS: readonly HandleDir[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

/** Px the pointer must travel before a bar press counts as a drag, not a click. */
const DRAG_START = 4;
/** Snap zones at the desktop edges: left/right halves, top maximizes. */
const SNAP_X = 16;
const SNAP_Y = 8;

/** The desktop area the window lives in (its offset parent), as a viewport rect. */
const areaBox = (el: HTMLElement) => (el.offsetParent as HTMLElement | null)?.getBoundingClientRect() ?? new DOMRect(0, 0, innerWidth, innerHeight);

function zoneAt(e: PointerEvent, area: DOMRect): SnapZone | null {
  if (e.clientY - area.top < SNAP_Y) return "max";
  if (e.clientX - area.left < SNAP_X) return "left";
  if (area.right - e.clientX < SNAP_X) return "right";
  return null;
}

/**
 * Pointer-capture drag and resize for one window (pattern: the Panel grip in ui/layout.tsx).
 * During a gesture the element is written directly (rAF-throttled) and `wm-gesture` on <body>
 * turns off pointer events inside every window content (Leaflet/canvas must not see the drag);
 * the result is committed to the store once, on pointerup.
 */
export function useWindowDrag(win: Win, rootRef: RefObject<HTMLElement>) {
  const onBarPointerDown = (e: PointerEvent) => {
    const el = rootRef.current;
    if (e.button !== 0 || !el || (e.target as HTMLElement).closest("button")) return;
    const bar = e.currentTarget as HTMLElement;
    const start = { x: e.clientX, y: e.clientY };
    // base is the geometry the deltas apply to; for a maxed/snapped window it is fixed on the
    // first real move, when the window restores to its normal size under the cursor.
    let base: Rect | null = win.mode === "normal" ? win.bounds : null;
    let origin = start;
    let moved = false;
    let raf = 0;
    let zone: SnapZone | null = null;
    let last = { dx: 0, dy: 0 };
    const area = areaBox(el);

    const paint = () => { raf = 0; el.style.transform = `translate(${last.dx}px, ${last.dy}px)`; };
    const onMove = (ev: PointerEvent) => {
      if (!moved) {
        if (Math.abs(ev.clientX - start.x) < DRAG_START && Math.abs(ev.clientY - start.y) < DRAG_START) return;
        moved = true;
        startGesture();
        if (!base) {
          // Restore under the cursor: normal width/height, the grab point kept proportional.
          const r = el.getBoundingClientRect();
          const { w, h } = win.bounds;
          base = {
            x: Math.round(ev.clientX - area.left - ((start.x - r.left) / r.width) * w),
            y: Math.round(ev.clientY - area.top - (start.y - r.top)),
            w, h,
          };
          origin = { x: ev.clientX, y: ev.clientY };
          wm.setBounds(win.id, base, "normal");
          base = wm.getWindows().find((x) => x.id === win.id)?.bounds ?? base;
        }
      }
      last = { dx: ev.clientX - origin.x, dy: ev.clientY - origin.y };
      if (!raf) raf = requestAnimationFrame(paint);
      const z = zoneAt(ev, area);
      if (z !== zone) { zone = z; wm.setSnapPreview(z); }
    };
    const done = (commit: boolean) => {
      bar.removeEventListener("pointermove", onMove);
      bar.removeEventListener("pointerup", onUp);
      bar.removeEventListener("pointercancel", onCancel);
      endGesture();
      wm.setSnapPreview(null);
      if (raf) cancelAnimationFrame(raf);
      el.style.transform = "";
      if (!commit || !moved || !base) return;
      if (zone === "max") wm.toggleMax(win.id);
      else if (zone) wm.setSnap(win.id, zone);
      else wm.setBounds(win.id, { ...base, x: base.x + last.dx, y: base.y + last.dy }, "normal");
    };
    const onUp = () => done(true);
    const onCancel = () => done(false);
    bar.setPointerCapture(e.pointerId);
    bar.addEventListener("pointermove", onMove);
    bar.addEventListener("pointerup", onUp);
    bar.addEventListener("pointercancel", onCancel);
    e.preventDefault();
  };

  const onHandlePointerDown = (e: PointerEvent, dir: HandleDir) => {
    const el = rootRef.current;
    if (e.button !== 0 || !el || win.mode !== "normal") return;
    const handle = e.currentTarget as HTMLElement;
    const start = { x: e.clientX, y: e.clientY };
    const base = win.bounds;
    const { min } = win;
    let raf = 0;
    let next: Rect = base;
    const apply = () => {
      raf = 0;
      el.style.left = `${next.x}px`;
      el.style.top = `${next.y}px`;
      el.style.width = `${next.w}px`;
      el.style.height = `${next.h}px`;
    };
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      let { x, y, w, h } = base;
      if (dir.includes("e")) w = base.w + dx;
      if (dir.includes("s")) h = base.h + dy;
      if (dir.includes("w")) { w = base.w - dx; x = base.x + dx; }
      if (dir.includes("n")) { h = base.h - dy; y = base.y + dy; }
      // The min size pins the edge being dragged, not the opposite one.
      if (w < min.w) { if (dir.includes("w")) x -= min.w - w; w = min.w; }
      if (h < min.h) { if (dir.includes("n")) y -= min.h - h; h = min.h; }
      next = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const done = (commit: boolean) => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onCancel);
      endGesture();
      if (raf) cancelAnimationFrame(raf);
      if (commit) wm.setBounds(win.id, next);
      else { next = base; apply(); }
    };
    const onUp = () => done(true);
    const onCancel = () => done(false);
    startGesture();
    handle.setPointerCapture(e.pointerId);
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onCancel);
    e.preventDefault();
    wm.focus(win.id);
  };

  return { onBarPointerDown, onHandlePointerDown };
}
