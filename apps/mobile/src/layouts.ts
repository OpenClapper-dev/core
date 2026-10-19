import { DEFAULT_VIEWFINDER_LAYOUT, layoutLook, layoutOptions, type ViewfinderLayout } from "@fielder/vocab";
import * as Crypto from "expo-crypto";
import { api, ApiError } from "./api";
import { log } from "./log";
import { isOfflineMode } from "./net";
import { applyPatch, mergePatch, type LayoutPatch } from "./layoutPatch";
import { store } from "./storage";
import type { LayoutEntry, PendingLayout, Settings, ViewSettings } from "./types";

/**
 * The layout's look and control options as the screens read them (issue #68): the phone's own
 * settings plus the layout's. In toggle mode the Human value is the layout's; cycling it is phone state.
 */
export function withLook(s: Settings, l: ViewfinderLayout): ViewSettings {
  const look = layoutLook(l), opt = layoutOptions(l);
  return {
    ...s,
    hudChips: look.hud,
    borderColor: look.frameColor,
    borderWidthPx: look.frameWidth,
    blackoutEnabled: look.blackout,
    blackoutColor: look.blackoutColor,
    humanViewButton: opt.human.mode,
    humanViewFocalMm: opt.human.mode === "toggle" ? opt.human.mm : s.humanViewFocalMm,
    phoneLenses: opt.lenses,
  };
}

/**
 * A change from the phone: written to the cache now, and queued as the change itself (issue #198), so
 * the flush applies it to the server's current layout instead of overwriting newer Studio edits.
 */
export function editLayout(entry: LayoutEntry, patch: LayoutPatch): LayoutEntry {
  const next: LayoutEntry = { ...entry, layout: applyPatch(entry.layout as ViewfinderLayout, patch) satisfies ViewfinderLayout };
  saveCache(next);
  const queued = store.loadPendingLayouts().find((x) => x.id === entry.id);
  queue(queued ? { ...queued, patch: mergePatch(queued.patch, patch) } : { id: entry.id, name: entry.name, patch });
  return next;
}

/** Make a copy of the Default on the phone (the Default itself can't be changed), queued like any edit. */
export function copyDefault(name: string): LayoutEntry {
  const layout: ViewfinderLayout = JSON.parse(JSON.stringify(DEFAULT_VIEWFINDER_LAYOUT));
  const entry: LayoutEntry = { id: Crypto.randomUUID(), name, layout };
  saveCache(entry);
  queue({ id: entry.id, name, patch: {}, base: layout });
  return entry;
}

function saveCache(e: LayoutEntry) {
  store.saveLayouts([...store.loadLayouts().filter((x) => x.id !== e.id), e].sort((a, b) => a.name.localeCompare(b.name)));
}

function queue(p: PendingLayout) {
  store.savePendingLayouts([...store.loadPendingLayouts().filter((x) => x.id !== p.id), p]);
}

/** What a queued edit makes of the server's entry (or of its own base, for a layout made on the phone); null when the Studio deleted it. */
function resolvePending(p: PendingLayout, server: LayoutEntry | undefined): LayoutEntry | null {
  if (server) return { ...server, layout: applyPatch(server.layout as ViewfinderLayout, p.patch) };
  return p.base ? { id: p.id, name: p.name, layout: applyPatch(p.base, p.patch) } : null;
}

/**
 * Part of every flush, before the list is pulled: send what the phone changed, each edit applied to
 * the layout as the server has it now. A layout the server refuses (4xx), or one the Studio deleted
 * meanwhile, is dropped from the queue and logged, so one bad edit never blocks the others.
 */
export async function flushLayouts(): Promise<void> {
  const pending = store.loadPendingLayouts();
  if (pending.length === 0) return;
  const server = await api.listLayouts();
  for (const e of pending) {
    const drop = () => store.savePendingLayouts(store.loadPendingLayouts().filter((x) => x.id !== e.id));
    const next = resolvePending(e, server.find((x) => x.id === e.id));
    if (!next) { log("warn", "layout edit for a deleted layout, dropped", { id: e.id }); drop(); continue; }
    try {
      await api.putLayout(e.id, { name: next.name, layout: next.layout });
      // Edited again while this was on its way: keep the newer one queued.
      store.savePendingLayouts(store.loadPendingLayouts().filter((x) => !(x.id === e.id && JSON.stringify(x) === JSON.stringify(e))));
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      if (status >= 400 && status < 500 && status !== 401) {
        log("warn", "layout edit refused, dropped", { id: e.id, status });
        drop();
      } else throw err;
    }
  }
}

/** The server's list with the phone's unsent changes applied on top (the Studio's bars, the phone's look). */
export const withPending = (server: LayoutEntry[]): LayoutEntry[] => {
  const pending = store.loadPendingLayouts();
  const edited = server.map((s) => { const p = pending.find((x) => x.id === s.id); return (p && resolvePending(p, s)) || s; });
  const created = pending.filter((p) => !server.some((s) => s.id === p.id)).map((p) => resolvePending(p, undefined)).filter((x): x is LayoutEntry => !!x);
  return [...edited, ...created].sort((a, b) => a.name.localeCompare(b.name));
};

let refreshing: Promise<boolean> | null = null;

/**
 * Send the phone's edits and pull the list (issue #197). Runs with every flush, and on its own at the
 * moments the user is about to look at a layout (a Studio preview ends, Setup → Viewfinder opens, the
 * app comes back to the front): otherwise a Look set in the Studio waits for the next app start.
 * Concurrent calls share one request; offline it keeps the cache and resolves false.
 */
export function refreshLayouts(): Promise<boolean> {
  if (isOfflineMode()) return Promise.resolve(false);
  return (refreshing ??= (async () => {
    try {
      await flushLayouts();
      store.saveLayouts(withPending(await api.listLayouts()));
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })());
}
