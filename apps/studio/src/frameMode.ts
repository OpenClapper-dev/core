import { useEffect, useState } from "preact/hooks";
import { FRAME_MODES, isFrameMode } from "./format";
import type { MaskMode } from "./Framed";

/**
 * How the rig frame is drawn on photos everywhere (Settings, M in Gallery): one value for every
 * window, per browser in localStorage["maskMode"]. A shot window starts from it and may keep its
 * own while it is open.
 */
function read(): MaskMode { try { const v = localStorage.getItem("maskMode"); return isFrameMode(v) ? v : "mask"; } catch { return "mask"; } }
let current = read();
const listeners = new Set<(m: MaskMode) => void>();
export const getMask = () => current;
export function setMask(m: MaskMode) {
  current = m;
  try { localStorage.setItem("maskMode", m); } catch { /* a preference */ }
  for (const cb of listeners) cb(m);
}
export const nextMask = (m: MaskMode) => FRAME_MODES[(FRAME_MODES.indexOf(m) + 1) % FRAME_MODES.length];
export function useMask(): [MaskMode, (m: MaskMode) => void] {
  const [m, setM] = useState(current);
  useEffect(() => { listeners.add(setM); return () => { listeners.delete(setM); }; }, []);
  return [m, setMask];
}
