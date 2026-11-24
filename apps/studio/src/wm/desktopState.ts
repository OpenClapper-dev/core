import type { Desk, Win, WmSnapshot } from "./wm";

/**
 * Per-project window layout: geometry, z-order and the desks, per browser in
 * localStorage["desktop.<projectId>"], saved debounced. Geometry depends on the screen, so it stays
 * with the browser (docs/rewrite/09-shells.md); pins and icon places are preferences of the account.
 */

/** 3: the rebuild (desks; app ids of the new catalogue). Layouts of the first app are not read. */
const VERSION = 3;
interface Stored { v: number; windows: Omit<Win, "state">[]; zTop: number; focusedId: string | null; desks?: Desk[]; active?: string }

const key = (projectId: string) => `desktop.${projectId}`;

/** The stored layout, or null for a fresh one (also on another version or a parse failure). */
export function load(projectId: string): WmSnapshot | null {
  try {
    const raw = localStorage.getItem(key(projectId));
    if (!raw) return null;
    const s = JSON.parse(raw) as Stored;
    if (s.v !== VERSION || !Array.isArray(s.windows)) return null;
    const desks = Array.isArray(s.desks) ? s.desks.filter((d) => d && typeof d.id === "string" && typeof d.name === "string") : undefined;
    return { windows: s.windows as Win[], zTop: s.zTop ?? 0, focusedId: s.focusedId ?? null, desks, active: s.active };
  } catch { return null; }
}

let timer: ReturnType<typeof setTimeout> | undefined;
let pending: (() => void) | null = null;
function write(projectId: string, snap: WmSnapshot) {
  // Launch-intent state is transient; a restored window re-derives it.
  const s: Stored = { v: VERSION, windows: snap.windows.map(({ state: _state, ...w }) => w), zTop: snap.zTop, focusedId: snap.focusedId, desks: snap.desks, active: snap.active };
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
