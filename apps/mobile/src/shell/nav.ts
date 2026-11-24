/**
 * Going from one app to another: the camera's uploads chip opens Setup's Uploads, its last photo opens
 * Media on that photo. The shell registers how to bring a tab to the front; an app registers what it
 * does with a request. A request for an app not mounted yet waits until it registers. A tab that is
 * not on this device cannot be opened.
 */
let front: ((id: string) => boolean) | null = null;
const handlers = new Map<string, (arg: string) => void>();
const pending = new Map<string, string>();

export const setTabOpener = (fn: ((id: string) => boolean) | null) => { front = fn; };
/** Called by an app with what it does when another app asks it to show something. */
export function onOpen(app: string, fn: (arg: string) => void): () => void {
  handlers.set(app, fn);
  const arg = pending.get(app);
  if (arg !== undefined) { pending.delete(app); fn(arg); }
  return () => { if (handlers.get(app) === fn) handlers.delete(app); };
}

/** Brings an app to the front (and asks it to show `arg`); false when it is not a tab here. */
export function openApp(app: string, arg?: string): boolean {
  if (!front?.(app)) return false;
  if (arg !== undefined) { const h = handlers.get(app); if (h) h(arg); else pending.set(app, arg); }
  return true;
}
