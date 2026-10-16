import { useEffect, useState } from "preact/hooks";

/**
 * The window manager (epic #72): a module store in the settings.ts idiom holding every open
 * window, the z-order, the snap preview and the taskbar pins. Pure logic — no DOM, no registry
 * import — so wm.test.ts can run it under node --test; sizes and singleton flags arrive with each
 * `open()` call (the registry's `launch()` fills them in).
 */

export interface Size { w: number; h: number }
export interface Rect { x: number; y: number; w: number; h: number }
/** The file/resource a window shows; part of the dedupe key, so one window per resource. */
export interface ResourceRef { type: string; id: string }
export type SnapHalf = "left" | "right";
export type WinMode = "normal" | "max" | "snapped" | "min";
export type SnapZone = SnapHalf | "max";

export interface Win {
  id: string;
  app: string;
  resource: ResourceRef | null;
  title: string;
  /** Normal-mode geometry. Snapping and maximizing never touch it, so restore is free. */
  bounds: Rect;
  min: Size;
  z: number;
  mode: WinMode;
  /** Which half, while mode is "snapped". */
  snap?: SnapHalf;
  /** Where a minimized window returns to. */
  wasMode?: Exclude<WinMode, "min">;
  /** Launch-intent state for the app (e.g. the shot list behind ←/→). Not persisted. */
  state?: unknown;
}

export interface OpenIntent {
  app: string;
  resource?: ResourceRef | null;
  title: string;
  /** One window for the whole app (no resource in the dedupe key). */
  singleton?: boolean;
  size?: Size;
  minSize?: Size;
  bounds?: Rect;
  state?: unknown;
}

const MIN_DEFAULT: Size = { w: 360, h: 240 };
const SIZE_DEFAULT: Size = { w: 920, h: 640 };
/** At least this much of a window must stay on-screen (grabbable). */
const KEEP = 48;
/** Title-bar height; the bar may never leave the desktop vertically. */
const BAR = 36;

let windows: Win[] = [];
let zTop = 0;
let focused: string | null = null;
let preview: SnapZone | null = null;
let pins: string[] = [];
/** The desktop area (without the taskbar); Shell keeps it current via a ResizeObserver. */
let viewport: Size = { w: 1280, h: 768 };

const listeners = new Set<() => void>();
function notify() { for (const cb of listeners) cb(); }
export function subscribe(cb: () => void): () => void { listeners.add(cb); return () => { listeners.delete(cb); }; }

export const getWindows = () => windows;
export const getFocusedId = () => focused;
export const getPins = () => pins;
export const getSnapPreview = () => preview;
export const getViewport = () => viewport;

export function setViewport(s: Size) {
  if (s.w === viewport.w && s.h === viewport.h) return;
  viewport = s;
  windows = windows.map((w) => ({ ...w, bounds: clampBounds(w.bounds, w.min) }));
  notify();
}

export function clampBounds(r: Rect, min: Size): Rect {
  const w = Math.min(Math.max(r.w, min.w), viewport.w);
  const h = Math.min(Math.max(r.h, min.h), viewport.h);
  const x = Math.round(Math.min(Math.max(r.x, KEEP - w), viewport.w - KEEP));
  const y = Math.round(Math.min(Math.max(r.y, 0), Math.max(0, viewport.h - BAR)));
  return { x, y, w: Math.round(w), h: Math.round(h) };
}

const dedupeKey = (app: string, resource: ResourceRef | null | undefined, singleton: boolean | undefined) =>
  resource ? `${app}:${resource.type}:${resource.id}` : singleton ? app : null;

/** Cascade placement so new windows don't stack exactly. */
function place(size: Size): Rect {
  const step = 32;
  const n = windows.length % 10;
  const w = Math.min(size.w, viewport.w - 16);
  const h = Math.min(size.h, viewport.h - 16);
  return { x: Math.min(40 + n * step, Math.max(8, viewport.w - w - 8)), y: Math.min(32 + n * step, Math.max(8, viewport.h - h - 8)), w, h };
}

/**
 * Open a window, or focus the existing one for the same app+resource (one window per resource —
 * do not relax this before per-resource stores exist, see docs/known-issues.md). Returns the id.
 */
export function open(intent: OpenIntent): string {
  const key = dedupeKey(intent.app, intent.resource, intent.singleton);
  const existing = key ? windows.find((w) => dedupeKey(w.app, w.resource, intent.singleton) === key) : undefined;
  if (existing) { focus(existing.id); return existing.id; }
  const min = intent.minSize ?? MIN_DEFAULT;
  const bounds = clampBounds(intent.bounds ?? place(intent.size ?? SIZE_DEFAULT), min);
  const win: Win = { id: crypto.randomUUID(), app: intent.app, resource: intent.resource ?? null, title: intent.title, bounds, min, z: ++zTop, mode: "normal", state: intent.state };
  windows = [...windows, win];
  focused = win.id;
  notify();
  return win.id;
}

function patch(id: string, p: Partial<Win>) {
  windows = windows.map((w) => (w.id === id ? { ...w, ...p } : w));
}

export function focus(id: string) {
  const w = windows.find((x) => x.id === id);
  if (!w) return;
  patch(id, { z: ++zTop, ...(w.mode === "min" ? { mode: w.wasMode ?? "normal", wasMode: undefined } : null) });
  focused = id;
  notify();
}

/** The visible window with the highest z, if any. */
const topmost = () => windows.filter((w) => w.mode !== "min").sort((a, b) => b.z - a.z)[0] ?? null;

export function close(id: string) {
  if (!windows.some((w) => w.id === id)) return;
  windows = windows.filter((w) => w.id !== id);
  if (focused === id) focused = topmost()?.id ?? null;
  notify();
}

export function minimize(id: string) {
  const w = windows.find((x) => x.id === id);
  if (!w || w.mode === "min") return;
  patch(id, { mode: "min", wasMode: w.mode });
  if (focused === id) focused = topmost()?.id ?? null;
  notify();
}

export function toggleMax(id: string) {
  const w = windows.find((x) => x.id === id);
  if (!w) return;
  patch(id, w.mode === "max" ? { mode: "normal", snap: undefined } : { mode: "max", snap: undefined, z: ++zTop });
  focused = id;
  notify();
}

/** Snap to a half, or back to normal with `null`; bounds stay untouched either way. */
export function setSnap(id: string, half: SnapHalf | null) {
  const w = windows.find((x) => x.id === id);
  if (!w) return;
  patch(id, half ? { mode: "snapped", snap: half, z: ++zTop } : { mode: "normal", snap: undefined });
  if (half) focused = id;
  notify();
}

/** Commit geometry (drag/resize end, or a mid-drag restore from max/snapped). */
export function setBounds(id: string, r: Rect, mode: "normal" | "keep" = "keep") {
  const w = windows.find((x) => x.id === id);
  if (!w) return;
  patch(id, { bounds: clampBounds(r, w.min), ...(mode === "normal" ? { mode: "normal" as const, snap: undefined } : null) });
  notify();
}

export function setTitle(id: string, title: string) {
  const w = windows.find((x) => x.id === id);
  if (!w || w.title === title) return;
  patch(id, { title });
  notify();
}

/** Move focus through the windows in z-order (Ctrl+` later); restores a minimized stop. */
export function cycle(dir: 1 | -1 = 1) {
  if (windows.length === 0) return;
  const order = [...windows].sort((a, b) => a.z - b.z);
  const i = order.findIndex((w) => w.id === focused);
  const next = order[(i + dir + order.length) % order.length];
  if (next) focus(next.id);
}

export function setSnapPreview(zone: SnapZone | null) {
  if (zone === preview) return;
  preview = zone;
  notify();
}

export function togglePin(app: string) {
  pins = pins.includes(app) ? pins.filter((a) => a !== app) : [...pins, app];
  notify();
}

// ---------- Persistence seam (wm/desktopState.ts stores this per project) ----------

export interface WmSnapshot { windows: Win[]; zTop: number; focusedId: string | null; pins: string[] }
export const snapshot = (): WmSnapshot => ({ windows, zTop, focusedId: focused, pins });
export function hydrate(s: WmSnapshot) {
  windows = s.windows.map((w) => ({ ...w, bounds: clampBounds(w.bounds, w.min) }));
  zTop = Math.max(s.zTop, ...windows.map((w) => w.z), 0);
  focused = s.focusedId && windows.some((w) => w.id === s.focusedId) ? s.focusedId : topmost()?.id ?? null;
  pins = s.pins;
  notify();
}
export function reset() { hydrate({ windows: [], zTop: 0, focusedId: null, pins: [] }); }

// ---------- Hooks (settings.ts idiom) ----------

function useWm<T>(get: () => T): T {
  const [v, setV] = useState(get);
  useEffect(() => subscribe(() => setV(get())), []);
  return v;
}
/** All windows; a new array on every change, unsorted (render sorted by z). */
export const useWindows = () => useWm(getWindows);
export const useFocusedId = () => useWm(getFocusedId);
export const useSnapPreview = () => useWm(getSnapPreview);
export const usePins = () => useWm(getPins);
