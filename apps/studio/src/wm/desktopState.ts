import type { Win, WmSnapshot, Workspace } from "./wm";

/**
 * Per-project desktop persistence: window geometry and taskbar pins, per browser in
 * localStorage["desktop.<projectId>"], saved debounced. Geometry is viewport-dependent, so it
 * stays client-side (folders and icons are server-side, phase 3). Everything funnels through
 * load/save so a server backend could replace this without touching callers.
 */

/** 2 added workspaces (epic #90); a version-1 layout still loads, its windows on one workspace. */
const VERSION = 2;
interface Stored { v: number; windows: Omit<Win, "state">[]; zTop: number; focusedId: string | null; pins: string[]; workspaces?: Workspace[]; active?: string }

const key = (projectId: string) => `desktop.${projectId}`;

/** The stored desktop, or null for a fresh one (also on an unknown version or parse failure). */
export function load(projectId: string): WmSnapshot | null {
  try {
    const raw = localStorage.getItem(key(projectId));
    if (!raw) return null;
    const s = JSON.parse(raw) as Stored;
    if ((s.v !== VERSION && s.v !== 1) || !Array.isArray(s.windows)) return null;
    const workspaces = s.v === VERSION && Array.isArray(s.workspaces) ? s.workspaces.filter((w) => w && typeof w.id === "string" && typeof w.name === "string") : undefined;
    return { windows: s.windows as Win[], zTop: s.zTop ?? 0, focusedId: s.focusedId ?? null, pins: Array.isArray(s.pins) ? s.pins : [], workspaces, active: s.v === VERSION ? s.active : undefined };
  } catch { return null; }
}

let timer: ReturnType<typeof setTimeout> | undefined;
let pending: (() => void) | null = null;
function write(projectId: string, snap: WmSnapshot) {
  const s: Stored = {
    v: VERSION,
    // Launch-intent state is transient; a restored window re-derives it.
    windows: snap.windows.map(({ state: _state, ...w }) => w),
    zTop: snap.zTop,
    focusedId: snap.focusedId,
    pins: snap.pins,
    workspaces: snap.workspaces,
    active: snap.active,
  };
  try { localStorage.setItem(key(projectId), JSON.stringify(s)); } catch { /* private mode: layout kept for this session */ }
}

/** Debounced (600 ms): drags and z-order changes save as one write. */
export function save(projectId: string, snap: WmSnapshot) {
  pending = () => { pending = null; write(projectId, snap); };
  clearTimeout(timer);
  timer = setTimeout(() => pending?.(), 600);
}

/** Write out a pending save now (project switch, pagehide). */
export function flush() { clearTimeout(timer); pending?.(); }
