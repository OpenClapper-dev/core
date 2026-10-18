import { DEFAULT_VIEWFINDER_LAYOUT, layoutLook, layoutOptions, type ViewfinderLayout, type VfLook, type VfOptions } from "@fielder/vocab";
import * as Crypto from "expo-crypto";
import { api, ApiError } from "./api";
import { log } from "./log";
import { store } from "./storage";
import type { LayoutEntry, Settings, ViewSettings } from "./types";

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

/** A change from the phone: the layout's new look and/or options, written to the cache now and queued for the server. */
export function editLayout(entry: LayoutEntry, patch: { look?: Partial<VfLook>; options?: Partial<VfOptions> }): LayoutEntry {
  const l = entry.layout as ViewfinderLayout;
  const next: LayoutEntry = {
    ...entry,
    layout: { ...l, look: { ...layoutLook(l), ...patch.look }, options: { ...layoutOptions(l), ...patch.options } } satisfies ViewfinderLayout,
  };
  saveLocal(next);
  return next;
}

/** Make a copy of the Default on the phone (the Default itself can't be changed), queued like any edit. */
export function copyDefault(name: string): LayoutEntry {
  const entry: LayoutEntry = { id: Crypto.randomUUID(), name, layout: JSON.parse(JSON.stringify(DEFAULT_VIEWFINDER_LAYOUT)) };
  saveLocal(entry);
  return entry;
}

function saveLocal(e: LayoutEntry) {
  store.saveLayouts([...store.loadLayouts().filter((x) => x.id !== e.id), e].sort((a, b) => a.name.localeCompare(b.name)));
  store.savePendingLayouts([...store.loadPendingLayouts().filter((x) => x.id !== e.id), e]);
}

/**
 * Part of every flush, before the list is pulled: send what the phone changed. A layout the server
 * refuses (4xx) is dropped from the queue and logged, so one bad edit never blocks the others.
 */
export async function flushLayouts(): Promise<void> {
  for (const e of store.loadPendingLayouts()) {
    try {
      await api.putLayout(e.id, { name: e.name, layout: e.layout });
      // Edited again while this was on its way: keep the newer one queued.
      store.savePendingLayouts(store.loadPendingLayouts().filter((x) => !(x.id === e.id && JSON.stringify(x) === JSON.stringify(e))));
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      if (status >= 400 && status < 500 && status !== 401) {
        log("warn", "layout edit refused, dropped", { id: e.id, status });
        store.savePendingLayouts(store.loadPendingLayouts().filter((x) => x.id !== e.id));
      } else throw err;
    }
  }
}

/** The server's list with the phone's unsent changes on top. */
export const withPending = (server: LayoutEntry[]): LayoutEntry[] => {
  const pending = store.loadPendingLayouts();
  return [...server.filter((s) => !pending.some((p) => p.id === s.id)), ...pending].sort((a, b) => a.name.localeCompare(b.name));
};
