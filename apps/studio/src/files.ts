import { useEffect, useState } from "preact/hooks";
import * as api from "./api";
import type { FileRec, Root } from "./api";

/**
 * The files of a root, one copy for every window (docs/rewrite/07-organisation.md): the Files app,
 * the desktop's icons, the taskbar's pins and the recycle bin all read this store, so a change in
 * one shows in all. A change goes to the server first and the root is read again; nothing is
 * guessed locally.
 */
export interface RootFiles { files: FileRec[] | null; bin: FileRec[] | null; error: string | null }
const EMPTY: RootFiles = { files: null, bin: null, error: null };

export const rootKey = (r: Root) => (r === "home" ? "home" : r.project);
const roots = new Map<string, RootFiles>();
const listeners = new Set<() => void>();
const notify = () => { for (const cb of listeners) cb(); };
const put = (r: Root, change: Partial<RootFiles>) => { roots.set(rootKey(r), { ...(roots.get(rootKey(r)) ?? EMPTY), ...change }); notify(); };

export const getRoot = (r: Root): RootFiles => roots.get(rootKey(r)) ?? EMPTY;

/** Read a root's live files and its bin again. */
export async function loadRoot(r: Root): Promise<void> {
  try {
    const [files, bin] = await Promise.all([api.fetchFiles(r), api.fetchBin(r)]);
    put(r, { files, bin, error: null });
  } catch (e) { put(r, { error: (e as Error).message }); }
}
/** Forget everything (another account signed in). */
export function clearFiles() { roots.clear(); notify(); }

/** The root a file belongs to. */
export const rootOf = (f: Pick<FileRec, "project_id">): Root => (f.project_id ? { project: f.project_id } : "home");

/** Run a change, then read the root again, whether it worked or not (a refusal may be about what changed meanwhile). */
async function change<T>(r: Root, run: () => Promise<T>): Promise<T> {
  try { return await run(); } finally { await loadRoot(r); }
}

export const create = (r: Root, type: string, more: { id?: string; name?: string; container?: string | null; body?: Record<string, unknown>; refs?: { kind: string; to: string }[] } = {}) => {
  const { id = crypto.randomUUID(), ...rest } = more;
  return change(r, () => api.createFile(r, id, { type, ...rest }));
};
export const rename = (f: FileRec, name: string) => change(rootOf(f), () => api.putFile(f.id, { name }));
/** Save a file's body (a collection's colour or order); the type's rules are checked by the server. */
export const saveBody = (f: FileRec, body: Record<string, unknown>) => change(rootOf(f), () => api.putFile(f.id, { body }));
export const move = (r: Root, ids: string[], container: string | null) => change(r, () => api.moveFiles(ids, container));
export const bin = (r: Root, ids: string[]) => change(r, () => api.binFiles(ids));
export const restore = (r: Root, ids: string[]) => change(r, () => api.restoreFiles(ids));
export const purge = (r: Root, ids: string[]) => change(r, () => api.purgeFiles(ids));
export const emptyBin = (r: Root) => change(r, () => api.emptyBin(r));
export const duplicate = (f: FileRec, more: { name?: string; container?: string | null } = {}) => change(rootOf(f), () => api.duplicateFile(f.id, { id: crypto.randomUUID(), ...more }));

export function useRoot(r: Root): RootFiles {
  const key = rootKey(r);
  const [, tick] = useState(0);
  useEffect(() => {
    const cb = () => tick((n) => n + 1);
    listeners.add(cb);
    if (!roots.get(key)?.files) void loadRoot(r);
    return () => { listeners.delete(cb); };
  }, [key]);
  return getRoot(r);
}

// ---------- Reading the tree ----------

export const byId = (files: readonly FileRec[]) => new Map(files.map((f) => [f.id, f]));
export const fixedFolder = (files: readonly FileRec[], which: "desktop" | "settings") => files.find((f) => f.fixed === which) ?? null;
/** The containers from the top level down to a file's own container (empty at the top level). */
export function pathOf(files: readonly FileRec[], containerId: string | null): FileRec[] {
  const m = byId(files);
  const out: FileRec[] = [];
  for (let c = containerId ? m.get(containerId) : undefined, n = 0; c && n < 64; c = c.container ? m.get(c.container) : undefined, n++) out.unshift(c);
  return out;
}
/** A file and everything inside it (ids). */
export function subtree(files: readonly FileRec[], id: string): Set<string> {
  const out = new Set([id]);
  for (let grew = true; grew;) { grew = false; for (const f of files) if (f.container && out.has(f.container) && !out.has(f.id)) { out.add(f.id); grew = true; } }
  return out;
}
