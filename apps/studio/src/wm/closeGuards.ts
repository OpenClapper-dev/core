import * as wm from "./wm";

/**
 * Apps with unsaved work register a guard for their window; closing it (button, taskbar, keys)
 * asks it first. Kept beside the pure wm store, which closes unconditionally.
 */
const guards = new Map<string, () => boolean | Promise<boolean>>();
let closer: (winId: string) => void = wm.close;
/** The shell closes with a fade: it takes over the last step and calls wm.close when the fade is done. */
export function setCloser(fn: (winId: string) => void) { closer = fn; }

export function setCloseGuard(winId: string, guard: (() => boolean | Promise<boolean>) | null) {
  if (guard) guards.set(winId, guard); else guards.delete(winId);
}

/** Close a window once its guard (if any) agrees. */
export async function requestClose(winId: string) {
  const g = guards.get(winId);
  if (g && !(await g())) return;
  guards.delete(winId);
  closer(winId);
}
