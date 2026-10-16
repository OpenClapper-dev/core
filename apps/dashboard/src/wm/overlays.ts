import { useEffect, useState } from "preact/hooks";

/**
 * The shell's global overlays (Go to…, the shortcut sheet, New shot), opened from any app: the
 * shell renders them above every window.
 */
export type OverlayId = "palette" | "sheet" | "newShot";
let open: OverlayId | null = null;
const listeners = new Set<(o: OverlayId | null) => void>();
export function openOverlay(o: OverlayId | null) { open = o; for (const cb of listeners) cb(o); }
export const closeOverlay = () => openOverlay(null);
export function useOverlay(): OverlayId | null {
  const [o, setO] = useState(open);
  useEffect(() => { listeners.add(setO); return () => { listeners.delete(setO); }; }, []);
  return o;
}
