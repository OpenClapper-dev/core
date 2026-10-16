import { launch, type AppId } from "../apps/registry";
import { parseRoute, routeHash, type Route } from "../router";
import * as wm from "./wm";
import type { ResourceRef, Win } from "./wm";

/**
 * URL ⇄ windows (epic #72). In: a hash is a launch command — on boot (after the desktop is
 * restored) and on every hashchange it opens or focuses the window for it, so deep links keep
 * working. Out: the address bar shows the focused window's route (replaceState, no history
 * entries); the desktop itself is `#/`.
 */

export interface LaunchIntent { app: AppId; resource?: ResourceRef | null; state?: unknown }

/** Every Route variant to the window that shows it. */
export function routeToLaunch(r: Route): LaunchIntent {
  switch (r.page) {
    case "shots": return { app: "gallery", state: { viewId: r.viewId } };
    case "shot": return { app: "shot", resource: { type: "shot", id: r.shotId }, state: { stage: r.stage } };
    case "plan": return { app: "plan", state: { dayId: r.dayId } };
    case "metadata": return { app: "metadata", state: { field: r.field } };
    case "timeline": return { app: "timeline", state: { timelineId: r.timelineId, at: r.at ?? null } };
    case "settings": return { app: "settings", state: { tab: r.tab } };
    case "library": return { app: r.section, state: { id: r.id } };
    case "files": return { app: "files", state: { folderId: r.folderId } };
  }
}

/** The route of a window whose app has not reported one yet. */
export function defaultRoute(w: Pick<Win, "app" | "resource">): Route | null {
  const id = w.resource?.id ?? null;
  switch (w.app as AppId) {
    case "gallery": return { page: "shots", viewId: null };
    case "shot": return id ? { page: "shot", shotId: id, stage: "photo" } : null;
    case "plan": return { page: "plan", dayId: null };
    case "metadata": return { page: "metadata", field: "location" };
    case "timeline": return { page: "timeline", timelineId: null };
    case "settings": return { page: "settings", tab: "general" };
    case "files": return { page: "files", folderId: null };
    case "projects": case "fields": case "rigs": case "locations": case "viewfinder": return { page: "library", section: w.app as "projects", id: null };
    default: return null;
  }
}

export const DESKTOP_HASH = "#/";
const isDesktopHash = (h: string) => h === "" || h === "#" || h === DESKTOP_HASH;

/** Open (or focus) the window a hash addresses; the desktop hash opens nothing. */
export function openHash(hash: string) {
  if (isDesktopHash(hash)) return;
  launch(routeToLaunch(parseRoute(hash)));
}

/** The hash for a window: what its app last reported, else its default. */
export function windowHash(w: Win): string {
  if (w.route) return w.route;
  const r = defaultRoute(w);
  return r ? routeHash(r) : DESKTOP_HASH;
}

/**
 * Keep the address bar on the focused window, and open windows for typed or pasted hashes.
 * Writes only when the focused window or its route changes, so a silent in-app write (the cut
 * position) is not overwritten by unrelated window moves.
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
