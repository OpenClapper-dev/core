import { appDef, launch } from "../apps/registry";
import * as wm from "./wm";
import type { Win } from "./wm";

/**
 * URL ⇄ windows. In: a hash is a launch command, `#/<app>[/<rest>]`: on boot (after the desktop is
 * restored) and on every hashchange it opens or focuses that app's window, so deep links work.
 * Out: the address bar shows the focused window's route (replaceState, no history entries); the
 * desktop itself is `#/`.
 */
export const DESKTOP_HASH = "#/";
const isDesktopHash = (h: string) => h === "" || h === "#" || h === DESKTOP_HASH;

/** Open (or focus) the window a hash addresses; the desktop hash, or an app this build does not have, opens nothing. */
export function openHash(hash: string) {
  if (isDesktopHash(hash)) return;
  const [app, ...rest] = hash.replace(/^#\/?/, "").split("/");
  const def = appDef(decodeURIComponent(app));
  if (!def) return;
  launch({ app: def.id, ...def.fromRoute?.(rest.join("/")) });
}

/** The hash for a window: its app, and what the app last reported after it. */
export const windowHash = (w: Win): string => `#/${w.app}${w.route ? `/${w.route}` : ""}`;

/**
 * Keep the address bar on the focused window, and open windows for typed or pasted hashes. Writes
 * only when the focused window or its route changes.
 */
export function startRouteBridge(): () => void {
  let last: string | null = null;
  const sync = () => {
    const f = wm.getWindows().find((w) => w.id === wm.getFocusedId());
    const want = f ? windowHash(f) : DESKTOP_HASH;
    const key = `${f?.id ?? ""} ${want}`;
    if (key === last) return;
    last = key;
    if (location.hash !== want && !(isDesktopHash(location.hash) && want === DESKTOP_HASH)) history.replaceState(history.state, "", want);
  };
  const onHash = () => { openHash(location.hash); sync(); };
  window.addEventListener("hashchange", onHash);
  const unsub = wm.subscribe(sync);
  sync();
  return () => { window.removeEventListener("hashchange", onHash); unsub(); };
}
