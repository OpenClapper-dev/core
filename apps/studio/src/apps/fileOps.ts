import type { AppIdV, FileResourceType } from "@openclapper/vocab";
import { ApiError, deleteDay, deleteDesktopItem, deleteField, deleteFolder, deleteLocation, deleteShot, deleteTimeline, deleteView, existingIdOf, patchShot, placeItem, putDesktopItem, putFolder, putLocation, putView, type DesktopItem, type Folder } from "../api";
import * as data from "../data";
import { placementOf, subtree } from "../fileTree";
import { invalidateDays, invalidateTimelines } from "../Inspector";
import { promptDialog, toast } from "@openclapper/ui";
import type { FileEntry } from "./fileEntries";
import { binned, confirmShotBin, type Binned } from "./trashOps";

/**
 * Folder, placement and desktop changes for Files and the desktop: each calls the API, then
 * updates the shared store (data.ts) so every window and the desktop follow at once.
 *
 * The desktop is a folder (epic #90): what sits in the project's Desktop folder is on the desktop
 * as a real item (no arrow), at the position of its desktop_items row. Moving something into the
 * Desktop folder makes that row, moving it out removes it; anything else on the desktop is a
 * shortcut (an app, or a file or folder that lives elsewhere).
 */

const fail = (what: string) => (e: unknown) => { toast(`${what} failed: ${(e as Error).message}`, "danger"); };
const files = () => data.getData().files;
type Target = Pick<DesktopItem, "kind" | "resource_type" | "resource_id" | "folder_id" | "app_id">;
type Spot = { x: number; y: number };
export const fileTarget = (type: FileResourceType, id: string): Target => ({ kind: "resource", resource_type: type, resource_id: id, folder_id: null, app_id: null });
export const folderTarget = (id: string): Target => ({ kind: "folder", folder_id: id, resource_type: null, resource_id: null, app_id: null });
const sameTarget = (d: DesktopItem, t: Target) => d.kind === t.kind && d.resource_type === t.resource_type && d.resource_id === t.resource_id && d.folder_id === t.folder_id && d.app_id === t.app_id;

/** The active project's Desktop folder (made by the Worker on the first /api/files). */
export const desktopFolderId = (): string | null => files()?.folders.find((f) => f.kind === "desktop")?.id ?? null;
/** The icons on the desktop (taskbar pins are desktop items too, in their own area). */
export const desktopRows = (): DesktopItem[] => (files()?.desktop ?? []).filter((d) => d.area !== "taskbar");
const rowOf = (t: Target) => desktopRows().find((d) => sameTarget(d, t));

/**
 * Free spots for new icons, near `near` when given: the desktop registers this (it knows its grid
 * and what is taken) so nothing ever lands on another icon. `n` spots, all different.
 */
let placer: ((n: number, near?: Spot) => Spot[]) | null = null;
export function setDesktopPlacer(f: typeof placer) { placer = f; }
const spots = (n: number, near?: Spot): Spot[] => placer?.(n, near) ?? Array.from({ length: n }, (_, i) => ({ x: 12 + 96 * Math.floor((desktopRows().length + i) / 6), y: 12 + 100 * ((desktopRows().length + i) % 6) }));

/** Make desktop rows for targets that have none yet (quietly: an existing one is kept). */
/** Targets whose row is being made right now (a move and the desktop's self-heal may both ask). */
const inflight = new Set<string>();
const targetKey = (t: Target) => `${t.kind}:${t.resource_type ?? ""}:${t.resource_id ?? t.folder_id ?? t.app_id}`;
export async function addRows(projectId: string, targets: Target[], near?: Spot): Promise<DesktopItem[]> {
  const missing = targets.filter((t) => !rowOf(t) && !inflight.has(targetKey(t)));
  if (!missing.length) return [];
  for (const t of missing) inflight.add(targetKey(t));
  try { return await makeRows(projectId, missing, near); } finally { for (const t of missing) inflight.delete(targetKey(t)); }
}
async function makeRows(projectId: string, missing: Target[], near?: Spot): Promise<DesktopItem[]> {
  const at = spots(missing.length, near);
  const made: DesktopItem[] = [];
  for (const [i, t] of missing.entries()) {
    try { made.push(await putDesktopItem({ id: crypto.randomUUID(), project_id: projectId, label: null, x: at[i].x, y: at[i].y, ...t })); } catch (e) { if (!existingIdOf(e)) fail("Placing the icon")(e); }
  }
  if (made.length) data.setFiles((cur) => ({ ...cur, desktop: [...cur.desktop, ...made] }));
  return made;
}
async function dropRows(targets: Target[]) {
  const gone = targets.map(rowOf).filter((d): d is DesktopItem => !!d);
  if (!gone.length) return;
  const ids = new Set(gone.map((d) => d.id));
  data.setFiles((cur) => ({ ...cur, desktop: cur.desktop.filter((d) => !ids.has(d.id)) }));
  await Promise.all(gone.map((d) => deleteDesktopItem(d.id).catch((e) => { if (!(e instanceof ApiError && e.status === 404)) fail("Removing the icon")(e); })));
}

/** Ask for a name and create a folder in `parentId` (null = root); in the Desktop folder it gets its icon at `at`. */
export async function newFolder(projectId: string, parentId: string | null, at?: Spot): Promise<Folder | null> {
  const name = await promptDialog({ title: "New folder", input: { label: "Name", placeholder: "e.g. Rooftops" }, confirmLabel: "Create folder" });
  if (!name) return null;
  try {
    const f = await putFolder({ id: crypto.randomUUID(), project_id: projectId, name, parent_id: parentId });
    // The icon first, where it was asked for (the desktop would otherwise give it any free cell).
    if (parentId && parentId === desktopFolderId()) await addRows(projectId, [folderTarget(f.id)], at);
    data.setFiles((cur) => ({ ...cur, folders: [...cur.folders, f] }));
    return f;
  } catch (e) {
    if (existingIdOf(e)) toast(`There is already a folder “${name}” here`, "danger"); else fail("Creating the folder")(e);
    return null;
  }
}

export async function renameFolder(f: Folder) {
  if (f.kind === "desktop") { toast("The Desktop folder keeps its name", "info"); return; }
  const name = await promptDialog({ title: "Rename folder", input: { label: "Name", value: f.name }, confirmLabel: "Rename" });
  if (!name || name === f.name) return;
  try {
    const saved = await putFolder({ id: f.id, project_id: f.project_id, name });
    data.setFiles((cur) => ({ ...cur, folders: cur.folders.map((x) => (x.id === saved.id ? saved : x)) }));
  } catch (e) { if (existingIdOf(e)) toast(`There is already a folder “${name}” here`, "danger"); else fail("Rename")(e); }
}

/** Move a folder under another (null = root); the server refuses cycles and more than 8 levels. Resolves whether it moved. */
export async function moveFolder(f: Folder, parentId: string | null, at?: Spot): Promise<boolean> {
  if (f.kind === "desktop") { toast("The Desktop folder stays where it is", "info"); return false; }
  if (f.parent_id === parentId || f.id === parentId) return false;
  const all = files()?.folders ?? [];
  if (parentId && subtree(all, f.id).has(parentId)) { toast("A folder cannot go inside itself", "info"); return false; }
  const desk = desktopFolderId();
  try {
    const saved = await putFolder({ id: f.id, project_id: f.project_id, name: f.name, parent_id: parentId });
    if (desk && parentId === desk) await addRows(f.project_id, [folderTarget(f.id)], at);
    data.setFiles((cur) => ({ ...cur, folders: cur.folders.map((x) => (x.id === saved.id ? saved : x)) }));
    if (desk && f.parent_id === desk && parentId !== desk) await dropRows([folderTarget(f.id)]);
    return true;
  } catch (e) { if (existingIdOf(e)) toast(`There is already a folder “${f.name}” there`, "danger"); else fail("Moving the folder")(e); return false; }
}

/** A folder goes to the recycle bin with everything in it (Undo in the toast); the Desktop folder stays. */
export async function removeFolder(f: Folder): Promise<boolean> {
  return binItems([{ type: "folder", id: f.id, name: f.name }], f.project_id);
}

/** Put files into a folder (null = back to the top level); into or out of the Desktop folder their icon follows. */
export async function placeFiles(list: { type: FileResourceType; id: string }[], folderId: string | null, at?: Spot) {
  const cur = files();
  const desk = desktopFolderId();
  const was = cur ? placementOf(cur.items, cur.folders) : () => null;
  const leaving = list.filter((x) => desk && was(x.type, x.id) === desk && folderId !== desk);
  try {
    const saved = await Promise.all(list.map((x) => placeItem(x.type, x.id, folderId)));
    const projectId = cur?.projectId;
    // Icons first, around the drop spot; then the placements (the desktop heals only what is left).
    if (desk && folderId === desk && projectId) await addRows(projectId, list.map((x) => fileTarget(x.type, x.id)), at);
    data.setFiles((c) => {
      const keys = new Set(list.map((x) => `${x.type}:${x.id}`));
      return { ...c, items: [...c.items.filter((i) => !keys.has(`${i.resource_type}:${i.resource_id}`)), ...saved.filter((i): i is NonNullable<typeof i> => !!i)] };
    });
    if (leaving.length) await dropRows(leaving.map((x) => fileTarget(x.type, x.id)));
  } catch (e) { fail("Moving")(e); }
}

/** What a drop or a selection names: a file (by type) or a folder. */
export type Item = { kind: "file"; type: FileResourceType; id: string } | { kind: "folder"; id: string };

/** Move files and folders into a folder (the Desktop folder too), skipping what cannot go there. */
export async function moveItems(list: Item[], folderId: string | null, at?: Spot) {
  const all = files()?.folders ?? [];
  const fileList = list.filter((x): x is Extract<Item, { kind: "file" }> => x.kind === "file").map((x) => ({ type: x.type, id: x.id }));
  if (fileList.length) await placeFiles(fileList, folderId, at);
  for (const x of list) if (x.kind === "folder") { const f = all.find((y) => y.id === x.id); if (f) await moveFolder(f, folderId, at); }
}

/** A shortcut on the active project's desktop; one per target (an existing one is only flashed). */
export async function addShortcut(projectId: string, target: Target, at?: Spot): Promise<DesktopItem | null> {
  const existing = rowOf(target);
  if (existing) { toast("It is already on the desktop", "info"); flashIcon(existing.id); return null; }
  const [spot] = spots(1, at);
  try {
    const item = await putDesktopItem({ id: crypto.randomUUID(), project_id: projectId, label: null, x: spot.x, y: spot.y, ...target });
    data.setFiles((cur) => ({ ...cur, desktop: [...cur.desktop, item] }));
    return item;
  } catch (e) {
    if (existingIdOf(e)) { toast("It is already on the desktop", "info"); flashIcon(existingIdOf(e)!); } else fail("Adding the shortcut")(e);
    return null;
  }
}

/** Briefly highlight a desktop icon (a duplicate shortcut was asked for). */
export function flashIcon(id: string) {
  const el = document.querySelector(`[data-icon-id="${id}"]`);
  el?.classList.add("is-flash");
  setTimeout(() => el?.classList.remove("is-flash"), 1200);
}

/** Move icons to new spots in one go (the desktop has made sure they are free). */
export async function moveShortcuts(moves: { d: DesktopItem; x: number; y: number }[]) {
  if (!moves.length) return;
  const next = new Map(moves.map(({ d, x, y }) => [d.id, { ...d, x: Math.max(0, Math.round(x)), y: Math.max(0, Math.round(y)) }]));
  data.setFiles((cur) => ({ ...cur, desktop: cur.desktop.map((i) => next.get(i.id) ?? i) }));
  try { await Promise.all([...next.values()].map((d) => putDesktopItem(d))); } catch (e) { fail("Moving the icon")(e); }
}
export const moveShortcut = (d: DesktopItem, x: number, y: number) => moveShortcuts([{ d, x, y }]);

export async function renameShortcut(d: DesktopItem, current: string) {
  const name = await promptDialog({ title: "Rename the shortcut", input: { label: "Label (empty: the item's own name)", value: d.label ?? current }, confirmLabel: "Rename" });
  if (name === null) return;
  const next = { ...d, label: name === current && !d.label ? null : name };
  try { const saved = await putDesktopItem(next); data.setFiles((cur) => ({ ...cur, desktop: cur.desktop.map((i) => (i.id === d.id ? saved : i)) })); } catch (e) { fail("Rename")(e); }
}

export async function removeShortcut(d: DesktopItem) { await removeShortcuts([d]); }
export async function removeShortcuts(list: DesktopItem[]) {
  const ids = new Set(list.map((d) => d.id));
  data.setFiles((cur) => ({ ...cur, desktop: cur.desktop.filter((i) => !ids.has(i.id)) }));
  await Promise.all(list.map((d) => deleteDesktopItem(d.id).catch((e) => { if (!(e instanceof ApiError && e.status === 404)) fail("Removing the shortcut")(e); })));
}

/** What Files may rename: timelines and days are renamed in their own window (it holds their copy). */
export const canRename = (t: FileResourceType) => t === "shot" || t === "view" || t === "location";
/** Everything can go to the recycle bin from Files (an open Timeline or Plan drops it from its list). */
export const canDelete = (_t: FileResourceType) => true;

export async function renameEntry(e: FileEntry, projectId: string) {
  const name = await promptDialog({ title: `Rename “${e.name}”`, input: { label: "Name", value: e.name }, confirmLabel: "Rename" });
  if (!name || name === e.name) return;
  try {
    if (e.type === "shot") data.updated(await patchShot(e.id, { name }));
    else if (e.type === "view") {
      const v = data.getData().views?.find((x) => x.id === e.id);
      if (v) { const saved = await putView({ id: v.id, project_id: v.project_id, name, filter: v.filter }); data.setViews((cur) => (cur ?? []).map((x) => (x.id === saved.id ? saved : x))); }
    } else if (e.type === "location") {
      const saved = await putLocation({ id: e.id, project_id: projectId, name });
      data.setLocations((cur) => (cur ?? []).map((x) => (x.id === saved.id ? { ...x, ...saved } : x)));
    }
  } catch (err) { if (existingIdOf(err)) toast(`“${name}” is taken`, "danger"); else fail("Rename")(err); }
}

/** Move one file to the recycle bin (Undo in the toast). */
export async function deleteEntry(e: FileEntry, projectId: string): Promise<void> {
  await binItems([{ type: e.type, id: e.id, name: e.name }], projectId);
}

/**
 * Move files and folders to the recycle bin with one toast (Undo brings them all back). Only shots
 * ask first, when timelines or shooting days would lose them; the Desktop folder never goes.
 * Placements and desktop icons wait in the bin with what they point at.
 */
export async function binItems(list: (Binned & { name: string })[], projectId: string): Promise<boolean> {
  const desk = desktopFolderId();
  const items = list.filter((x) => !(x.type === "folder" && x.id === desk));
  if (items.length < list.length) toast("The Desktop folder cannot be deleted", "info");
  if (!items.length) return false;
  const shots = items.filter((x) => x.type === "shot").map((x) => x.id);
  if (shots.length && !(await confirmShotBin(projectId, shots))) return false;
  const done: typeof items = [];
  let failure: unknown = null;
  for (const x of items) {
    try {
      if (x.type === "shot") await deleteShot(x.id);
      else if (x.type === "view") await deleteView(x.id);
      else if (x.type === "location") await deleteLocation(x.id);
      else if (x.type === "field") await deleteField(x.id);
      else if (x.type === "timeline") await deleteTimeline(x.id);
      else if (x.type === "day") await deleteDay(x.id);
      else await deleteFolder(x.id);
      done.push(x);
    } catch (e) { failure = e; }
  }
  if (done.length) {
    const has = (t: string) => done.some((x) => x.type === t);
    if (has("shot")) data.deleted(done.filter((x) => x.type === "shot").map((x) => x.id));
    if (has("view")) data.setViews((cur) => (cur ?? []).filter((v) => !done.some((x) => x.id === v.id)));
    if (has("location")) { data.setLocations((cur) => (cur ?? []).filter((l) => !done.some((x) => x.id === l.id))); data.refreshCounts(); }
    if (has("field")) data.setFields((cur) => (cur ?? []).filter((f) => !done.some((x) => x.id === f.id)));
    invalidateTimelines(projectId); invalidateDays(projectId);
    // A folder took its contents along: every list reads again.
    if (has("folder")) await data.load();
    const what = done.length > 1 ? `${done.length} items` : done[0].type === "folder" ? `The folder “${done[0].name}” and its contents` : `“${done[0].name}”`;
    binned(done.map(({ type, id }) => ({ type, id })), projectId, what);
  }
  if (failure) fail("Delete")(failure);
  return done.length > 0;
}

// ---------- Taskbar pins (epic #90): desktop items in the taskbar area, ordered by position ----------

/** The project's pins, in taskbar order. */
export const taskbarRows = (): DesktopItem[] => (files()?.desktop ?? []).filter((d) => d.area === "taskbar").sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
export const appTarget = (app: AppIdV): Target => ({ kind: "app", app_id: app, resource_type: null, resource_id: null, folder_id: null });
const pinOf = (t: Target) => taskbarRows().find((d) => sameTarget(d, t));
export const pinnedApp = (app: string) => taskbarRows().find((d) => d.kind === "app" && d.app_id === app);

/** Pin targets to the taskbar, before the pin at index `at` (default: at the end); already pinned ones are skipped. */
export async function pinItems(projectId: string, targets: Target[], at?: number): Promise<void> {
  const fresh = targets.filter((t, i) => !pinOf(t) && targets.findIndex((u) => sameTarget(u as DesktopItem, t)) === i);
  if (!fresh.length) { toast(targets.length === 1 ? "It is pinned already" : "They are pinned already", "info"); return; }
  const rows = taskbarRows();
  const made: DesktopItem[] = [];
  for (const [i, t] of fresh.entries()) {
    try { made.push(await putDesktopItem({ id: crypto.randomUUID(), project_id: projectId, label: null, x: 0, y: 0, area: "taskbar", position: rows.length + i, ...t })); }
    catch (e) { if (!existingIdOf(e)) fail("Pinning")(e); }
  }
  if (!made.length) return;
  data.setFiles((cur) => ({ ...cur, desktop: [...cur.desktop, ...made] }));
  if (at !== undefined && at < rows.length) { const order = [...rows]; order.splice(at, 0, ...made); await reorderPins(order); }
}
export const pinItem = (projectId: string, t: Target) => pinItems(projectId, [t]);

export async function unpin(d: DesktopItem) { await removeShortcuts([d]); }

/** Store a new taskbar order (only the pins whose position changed are sent). */
export async function reorderPins(order: DesktopItem[]) {
  const changed = order.map((d, i) => ({ ...d, position: i })).filter((d, i) => order[i].position !== i);
  if (!changed.length) return;
  const next = new Map(changed.map((d) => [d.id, d]));
  data.setFiles((cur) => ({ ...cur, desktop: cur.desktop.map((d) => next.get(d.id) ?? d) }));
  try { await Promise.all(changed.map((d) => putDesktopItem(d))); } catch (e) { fail("Reordering")(e); }
}

/** Pin or unpin an app (launcher and window menus). */
export async function togglePinApp(projectId: string, app: AppIdV) {
  const p = pinnedApp(app);
  if (p) await unpin(p); else await pinItem(projectId, appTarget(app));
}
