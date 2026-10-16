import type { FileResourceType } from "@fielder/vocab";
import type { DesktopItem, Folder, FolderItem } from "./api";

/** The drag payload between Files, its folder tree and the desktop. */
export const FILE_DRAG = "application/x-fielder-file";
export type FileDrag = { kind: "file"; type: FileResourceType; id: string } | { kind: "folder"; id: string };

/**
 * Folder logic for the Files app and the desktop (epic #72), pure so it is tested on its own.
 * The server keeps folders, placements and shortcuts; everything else (what sits where, paths,
 * search) is computed here from the loaded data.
 */

/** A resource's folder, or null for the root. A placement in a folder that is gone counts as root. */
export function placementOf(items: readonly FolderItem[], folders: readonly Folder[]): (type: string, id: string) => string | null {
  const known = new Set(folders.map((f) => f.id));
  const m = new Map(items.filter((i) => known.has(i.folder_id)).map((i) => [`${i.resource_type}:${i.resource_id}`, i.folder_id]));
  return (type, id) => m.get(`${type}:${id}`) ?? null;
}

/** The folders directly inside `parentId` (null = root), by name. */
export const childFolders = (folders: readonly Folder[], parentId: string | null): Folder[] =>
  folders.filter((f) => f.parent_id === parentId).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }));

/** Root → … → the folder itself; empty for the root. Stops on a broken chain or a cycle. */
export function folderPath(folders: readonly Folder[], id: string | null): Folder[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const out: Folder[] = [];
  const seen = new Set<string>();
  for (let cur = id ? byId.get(id) : undefined; cur && !seen.has(cur.id); cur = cur.parent_id ? byId.get(cur.parent_id) : undefined) {
    seen.add(cur.id);
    out.unshift(cur);
  }
  return out;
}

/** The folder and every folder below it. */
export function subtree(folders: readonly Folder[], id: string): Set<string> {
  const out = new Set([id]);
  for (let grew = true; grew;) {
    grew = false;
    for (const f of folders) if (f.parent_id && out.has(f.parent_id) && !out.has(f.id)) { out.add(f.id); grew = true; }
  }
  return out;
}

/** Folders a folder may move into: not itself, not below itself. */
export const moveTargets = (folders: readonly Folder[], id: string): Folder[] => { const no = subtree(folders, id); return folders.filter((f) => !no.has(f.id)); };

/** Case-insensitive match on any of the given texts. */
export const matches = (q: string, ...texts: (string | null | undefined)[]) => { const s = q.trim().toLowerCase(); return !s || texts.some((t) => t?.toLowerCase().includes(s)); };

/** The desktop item a target already has (the server answers 409 for a second one). */
export function shortcutFor(desktop: readonly DesktopItem[], t: { kind: DesktopItem["kind"]; resource_type?: string | null; resource_id?: string | null; folder_id?: string | null; app_id?: string | null }): DesktopItem | undefined {
  return desktop.find((d) => d.kind === t.kind && (d.resource_type ?? null) === (t.resource_type ?? null) && (d.resource_id ?? null) === (t.resource_id ?? null) && (d.folder_id ?? null) === (t.folder_id ?? null) && (d.app_id ?? null) === (t.app_id ?? null));
}

/** The first free cell of the desktop grid (column-major, like a desktop), for a new icon. */
export function freeCell(desktop: readonly Pick<DesktopItem, "x" | "y">[], cell: { w: number; h: number }, rows: number): { x: number; y: number } {
  const taken = new Set(desktop.map((d) => `${Math.round(d.x / cell.w)}:${Math.round(d.y / cell.h)}`));
  for (let c = 0; ; c++) for (let r = 0; r < Math.max(1, rows); r++) if (!taken.has(`${c}:${r}`)) return { x: c * cell.w, y: r * cell.h };
}
