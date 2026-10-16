import { useEffect, useState } from "preact/hooks";

/**
 * The window manager (epic #72): a module store in the settings.ts idiom holding every open
 * window, the z-order, the snap preview, the taskbar pins and the workspaces (virtual desktops,
 * epic #90: each window belongs to one; the desktop icons are shared by all). Pure logic — no DOM, no registry
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

/** A virtual desktop: its own windows, focus and side-by-side split. */
export interface Workspace {
  id: string;
  name: string;
  /** The left share while two windows are snapped side by side (0.2..0.8). */
  split?: number;
  /** The window that had focus when this workspace was left. */
  focusedId?: string | null;
}

export interface Win {
  id: string;
  app: string;
  /** The workspace it sits on. */
  ws: string;
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
  /** Bumped when an open() re-targets this window with new state, so the app can react. */
  stateSeq?: number;
  /** The hash this window shows in the URL while focused (set by the app via replaceRoute). */
  route?: string;
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
const firstWs = (): Workspace => ({ id: crypto.randomUUID(), name: "Desktop 1" });
let workspaces: Workspace[] = [firstWs()];
let active = workspaces[0].id;
/** The active workspace's windows, cached until the windows or the workspace change. */
let here: Win[] = [];
let hereOf: { windows: Win[]; active: string } | null = null;
const onHere = () => {
  if (!hereOf || hereOf.windows !== windows || hereOf.active !== active) { here = windows.filter((w) => w.ws === active); hereOf = { windows, active }; }
  return here;
};
/** The desktop area (without the taskbar); Shell keeps it current via a ResizeObserver. */
let viewport: Size = { w: 1280, h: 768 };

const listeners = new Set<() => void>();
function notify() { for (const cb of listeners) cb(); }
export function subscribe(cb: () => void): () => void { listeners.add(cb); return () => { listeners.delete(cb); }; }

/** The active workspace's windows (what the taskbar, cycling and Show desktop work on). */
export const getWindows = () => onHere();
/** Every window of every workspace (the shell keeps them all mounted; the task view shows them). */
export const getAllWindows = () => windows;
export const getWorkspaces = () => workspaces;
export const getActiveWs = () => active;
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

/**
 * Singleton apps: one window, whatever it shows. Per-resource apps: one window per resource, plus
 * one resource-less window (the app's list/picker).
 */
const dedupeKey = (app: string, resource: ResourceRef | null | undefined, singleton: boolean | undefined) =>
  !singleton && resource ? `${app}:${resource.type}:${resource.id}` : app;

/** Cascade placement so new windows don't stack exactly. */
function place(size: Size): Rect {
  const step = 32;
  const n = onHere().length % 10;
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
  // One window per resource across every workspace: a hit elsewhere switches there (focus does).
  const existing = windows.find((w) => dedupeKey(w.app, w.resource, intent.singleton) === key);
  if (existing) {
    if (intent.state !== undefined) patch(existing.id, { state: intent.state, stateSeq: (existing.stateSeq ?? 0) + 1 });
    focus(existing.id);
    return existing.id;
  }
  const min = intent.minSize ?? MIN_DEFAULT;
  const bounds = clampBounds(intent.bounds ?? place(intent.size ?? SIZE_DEFAULT), min);
  const win: Win = { id: crypto.randomUUID(), app: intent.app, ws: active, resource: intent.resource ?? null, title: intent.title, bounds, min, z: ++zTop, mode: "normal", state: intent.state };
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
  if (w.ws !== active) leaveFor(w.ws);
  patch(id, { z: ++zTop, ...(w.mode === "min" ? { mode: w.wasMode ?? "normal", wasMode: undefined } : null) });
  focused = id;
  notify();
}

/** The active workspace's visible window with the highest z, if any. */
const topmost = () => onHere().filter((w) => w.mode !== "min").sort((a, b) => b.z - a.z)[0] ?? null;

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

/** The app's current URL hash (written to the address bar while the window is focused). */
export function setRoute(id: string, route: string) {
  const w = windows.find((x) => x.id === id);
  if (!w || w.route === route) return;
  patch(id, { route });
  notify();
}

/**
 * In-window navigation to another resource (a timeline picked from the list). When another window
 * already shows it, that one is focused instead (one window per resource) and false is returned.
 */
export function setResource(id: string, resource: ResourceRef | null): boolean {
  const w = windows.find((x) => x.id === id);
  if (!w) return false;
  const other = resource && windows.find((x) => x.id !== id && x.app === w.app && x.resource?.type === resource.type && x.resource.id === resource.id);
  if (other) { focus(other.id); return false; }
  patch(id, { resource });
  notify();
  return true;
}

/** Nothing focused: the desktop itself has focus (the URL shows #/). */
export function focusDesktop() {
  if (focused === null) return;
  focused = null;
  notify();
}

/** Show desktop: minimize every window (again: bring them back). */
export function toggleDesktop() {
  const visible = onHere().filter((w) => w.mode !== "min");
  if (visible.length) {
    windows = windows.map((w) => (w.ws !== active || w.mode === "min" ? w : { ...w, mode: "min" as const, wasMode: w.mode as Exclude<WinMode, "min"> }));
    focused = null;
  } else {
    windows = windows.map((w) => (w.ws !== active ? w : { ...w, mode: w.wasMode ?? "normal", wasMode: undefined }));
    focused = topmost()?.id ?? null;
  }
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
  if (onHere().length === 0) return;
  const order = [...onHere()].sort((a, b) => a.z - b.z);
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

// ---------- Workspaces (virtual desktops, epic #90) ----------

/** Make `id` the active workspace, remembering what had focus on the one left. */
function leaveFor(id: string) {
  workspaces = workspaces.map((x) => (x.id === active ? { ...x, focusedId: focused } : x));
  active = id;
  const back = workspaces.find((x) => x.id === id)?.focusedId;
  const w = back ? windows.find((x) => x.id === back && x.ws === id && x.mode !== "min") : undefined;
  focused = w?.id ?? topmost()?.id ?? null;
}

/** The next free "Desktop n" name. */
function freshName(): string {
  const taken = new Set(workspaces.map((w) => w.name.toLowerCase()));
  for (let n = workspaces.length + 1; ; n++) if (!taken.has(`desktop ${n}`)) return `Desktop ${n}`;
}

/** A new, empty workspace at the end; `go` switches to it. Returns its id. */
export function addWorkspace(opts: { name?: string; go?: boolean } = {}): string {
  const ws: Workspace = { id: crypto.randomUUID(), name: opts.name?.trim() || freshName() };
  workspaces = [...workspaces, ws];
  if (opts.go) leaveFor(ws.id);
  notify();
  return ws.id;
}

/** Switch to a workspace by id, or step through them (+1/-1, wrapping). */
export function switchWorkspace(to: string | 1 | -1) {
  const i = workspaces.findIndex((w) => w.id === active);
  const id = typeof to === "string" ? to : workspaces[(i + to + workspaces.length) % workspaces.length].id;
  if (id === active || !workspaces.some((w) => w.id === id)) return;
  leaveFor(id);
  notify();
}

/** Remove a workspace (never the last one); its windows go to the neighbour before it (or after). */
export function removeWorkspace(id: string) {
  const i = workspaces.findIndex((w) => w.id === id);
  if (i < 0 || workspaces.length === 1) return;
  const heir = workspaces[i > 0 ? i - 1 : 1];
  windows = windows.map((w) => (w.ws === id ? { ...w, ws: heir.id } : w));
  const wasActive = active === id;
  workspaces = workspaces.filter((w) => w.id !== id);
  if (wasActive) { active = heir.id; focused = topmost()?.id ?? null; }
  notify();
}

export function renameWorkspace(id: string, name: string) {
  const n = name.trim();
  if (!n) return;
  workspaces = workspaces.map((w) => (w.id === id ? { ...w, name: n.slice(0, 40) } : w));
  notify();
}

/** Move a window to another workspace ("new": a fresh one); the active one keeps its focus. */
export function moveToWorkspace(winId: string, to: string | "new") {
  const w = windows.find((x) => x.id === winId);
  if (!w) return;
  const target = to === "new" ? addWorkspace() : to;
  if (target === w.ws || !workspaces.some((x) => x.id === target)) return;
  patch(winId, { ws: target });
  // It is that workspace's front window now.
  workspaces = workspaces.map((x) => (x.id === target ? { ...x, focusedId: winId } : x));
  if (focused === winId) focused = topmost()?.id ?? null;
  notify();
}

// ---------- Persistence seam (wm/desktopState.ts stores this per project) ----------

export interface WmSnapshot { windows: Win[]; zTop: number; focusedId: string | null; pins: string[]; workspaces?: Workspace[]; active?: string }
export const snapshot = (): WmSnapshot => ({ windows, zTop, focusedId: focused, pins, workspaces, active });
/** Restore a stored desktop; windows of a workspace that is gone (or from before workspaces) land on the first. */
export function hydrate(s: WmSnapshot) {
  workspaces = s.workspaces?.length ? s.workspaces : [firstWs()];
  const known = new Set(workspaces.map((w) => w.id));
  active = s.active && known.has(s.active) ? s.active : workspaces[0].id;
  windows = s.windows.map((w) => ({ ...w, ws: w.ws && known.has(w.ws) ? w.ws : workspaces[0].id, bounds: clampBounds(w.bounds, w.min) }));
  zTop = Math.max(s.zTop, ...windows.map((w) => w.z), 0);
  focused = s.focusedId && onHere().some((w) => w.id === s.focusedId) ? s.focusedId : topmost()?.id ?? null;
  pins = s.pins;
  notify();
}
export function reset() { hydrate({ windows: [], zTop: 0, focusedId: null, pins: [] }); }

// ---------- Hooks (settings.ts idiom) ----------

function useWm<T>(get: () => T): T {
  const [v, setV] = useState(get);
  // Read again on subscribing: the store may have changed between the first render and this effect
  // (a desktop restored on load), and no later notify would tell.
  useEffect(() => { setV(get()); return subscribe(() => setV(get())); }, []);
  return v;
}
/** The active workspace's windows; a new array on every change, unsorted (render sorted by z). */
export const useWindows = () => useWm(getWindows);
export const useAllWindows = () => useWm(getAllWindows);
export const useWorkspaces = () => useWm(getWorkspaces);
export const useActiveWs = () => useWm(getActiveWs);
export const useFocusedId = () => useWm(getFocusedId);
export const useSnapPreview = () => useWm(getSnapPreview);
export const usePins = () => useWm(getPins);
