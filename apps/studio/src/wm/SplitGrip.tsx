import { SnapGrip } from "@openclapper/design";
import { endGesture, startGesture } from "./gesture";
import * as wm from "./wm";

/** The desktop area the windows live in; the split is a CSS variable on it (`--oc-split`). */
const areaEl = () => document.querySelector<HTMLElement>(".oc-desktop__area");

/**
 * Drag the side-by-side split: from the grip between two snapped windows, or from a snapped
 * window's inner edge. Both windows follow live (the variable on the desktop area is written
 * directly, rAF-throttled, with `wm-gesture` shielding window content); the store gets the result
 * once, on pointerup.
 */
export function startSplitDrag(e: PointerEvent) {
  if (e.button !== 0) return;
  const area = areaEl();
  if (!area) return;
  const box = area.getBoundingClientRect();
  const handle = e.currentTarget as HTMLElement;
  let ratio = wm.getSplit();
  let raf = 0;
  const paint = () => { raf = 0; area.style.setProperty("--oc-split", String(ratio)); };
  const move = (ev: PointerEvent) => {
    ratio = wm.clampSplit((ev.clientX - box.left) / box.width);
    if (!raf) raf = requestAnimationFrame(paint);
  };
  const done = (commit: boolean) => {
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", up);
    handle.removeEventListener("pointercancel", cancel);
    endGesture();
    if (raf) cancelAnimationFrame(raf);
    // The shell writes the variable from the store again on render; set it here so nothing jumps.
    area.style.setProperty("--oc-split", String(commit ? wm.clampSplit(ratio) : wm.getSplit()));
    if (commit) wm.setSplit(ratio);
  };
  const up = () => done(true);
  const cancel = () => done(false);
  startGesture();
  handle.setPointerCapture(e.pointerId);
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", up);
  handle.addEventListener("pointercancel", cancel);
  e.preventDefault();
  e.stopPropagation();
}

/** The grip between snapped windows: drag it, double-click for half and half, or ←/→ when it has focus. */
export function SplitGrip() {
  const split = wm.useSplit();
  const windows = wm.useWindows();
  if (!windows.some((w) => w.mode === "snapped")) return null;
  return (
    <SnapGrip aria-valuemin={20} aria-valuemax={80} aria-valuenow={Math.round(split * 100)}
      onPointerDown={startSplitDrag}
      onDblClick={() => wm.setSplit(wm.SPLIT_DEFAULT)}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); e.stopPropagation(); wm.setSplit(split + (e.key === "ArrowLeft" ? -0.02 : 0.02)); }
        else if (e.key === "Home") { e.preventDefault(); wm.setSplit(wm.SPLIT_DEFAULT); }
      }} />
  );
}
