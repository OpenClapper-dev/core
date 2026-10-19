import { useEffect, useState } from "preact/hooks";

/**
 * The active project (issue #44: the Studio always works inside one; epic #72: the desktop is
 * scoped to it). Remembered per browser in localStorage["project"]. Whether the id still names a
 * project is the shell's call, once data.ts has loaded the list.
 */

function read(): string | null { try { return localStorage.getItem("project"); } catch { return null; } }

let current = read();
const listeners = new Set<(id: string | null) => void>();
/** Asked before a switch; any guard resolving false vetoes it (unsaved edits in an app). */
const guards = new Set<(next: string) => boolean | Promise<boolean>>();

export const getProjectId = () => current;

/** Set without asking (first pick in the project gate, or the gate's "New project"). */
export function setProjectId(id: string) {
  if (id === current) return;
  current = id;
  try { localStorage.setItem("project", id); } catch { /* private mode: kept for this session */ }
  for (const cb of listeners) cb(id);
}

/**
 * Switch the desktop to another project: every beforeProjectSwitch guard may veto first. Resolves
 * whether the switch happened.
 */
export async function switchProject(id: string): Promise<boolean> {
  if (id === current) return true;
  for (const g of [...guards]) if (!(await g(id))) return false;
  setProjectId(id);
  return true;
}

/** Register a guard for project switches (an app with unsaved edits confirms or vetoes). */
export function beforeProjectSwitch(guard: (next: string) => boolean | Promise<boolean>): () => void {
  guards.add(guard);
  return () => { guards.delete(guard); };
}

export function onProjectChange(cb: (id: string | null) => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** The active project id as state. */
export function useProjectId(): string | null {
  const [id, setId] = useState(current);
  useEffect(() => onProjectChange(setId), []);
  return id;
}
