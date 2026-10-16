import type { FileResourceType } from "@fielder/vocab";
import { ApiError, deleteDesktopItem, deleteField, deleteFolder, deleteLocation, deleteShot, deleteView, existingIdOf, patchShot, placeItem, putDesktopItem, putFolder, putLocation, putView, type DesktopItem, type Folder } from "../api";
import * as data from "../data";
import { folderPath } from "../fileTree";
import { confirmDialog, promptDialog, toast } from "../ui";
import type { FileEntry } from "./fileEntries";

/**
 * Folder, placement and shortcut changes for Files and the desktop: each calls the API, then
 * updates the shared store (data.ts) so every window and the desktop follow at once.
 */

const fail = (what: string) => (e: unknown) => { toast(`${what} failed: ${(e as Error).message}`, "danger"); };
const files = () => data.getData().files;

/** Ask for a name and create a folder in `parentId` (null = root). Resolves the new folder. */
export async function newFolder(projectId: string, parentId: string | null): Promise<Folder | null> {
  const name = await promptDialog({ title: "New folder", input: { label: "Name", placeholder: "e.g. Rooftops" }, confirmLabel: "Create folder" });
  if (!name) return null;
  try {
    const f = await putFolder({ id: crypto.randomUUID(), project_id: projectId, name, parent_id: parentId });
    data.setFiles((cur) => ({ ...cur, folders: [...cur.folders, f] }));
    return f;
  } catch (e) {
    if (existingIdOf(e)) toast(`There is already a folder “${name}” here`, "danger"); else fail("Creating the folder")(e);
    return null;
  }
}

export async function renameFolder(f: Folder) {
  const name = await promptDialog({ title: "Rename folder", input: { label: "Name", value: f.name }, confirmLabel: "Rename" });
  if (!name || name === f.name) return;
  try {
    const saved = await putFolder({ id: f.id, project_id: f.project_id, name });
    data.setFiles((cur) => ({ ...cur, folders: cur.folders.map((x) => (x.id === saved.id ? saved : x)) }));
  } catch (e) { if (existingIdOf(e)) toast(`There is already a folder “${name}” here`, "danger"); else fail("Rename")(e); }
}

/** Move a folder under another (null = root); the server refuses cycles and more than 8 levels. */
export async function moveFolder(f: Folder, parentId: string | null) {
  if (f.parent_id === parentId || f.id === parentId) return;
  try {
    const saved = await putFolder({ id: f.id, project_id: f.project_id, name: f.name, parent_id: parentId });
    data.setFiles((cur) => ({ ...cur, folders: cur.folders.map((x) => (x.id === saved.id ? saved : x)) }));
  } catch (e) { if (existingIdOf(e)) toast(`There is already a folder “${f.name}” there`, "danger"); else fail("Moving the folder")(e); }
}

/** Delete a folder after saying where its contents go (they fall up one level, server side). */
export async function removeFolder(f: Folder): Promise<boolean> {
  const all = files()?.folders ?? [];
  const parent = f.parent_id ? folderPath(all, f.parent_id).map((x) => x.name).join(" › ") : null;
  const ok = await confirmDialog({ title: `Delete the folder “${f.name}”?`, body: `Its subfolders and files move to ${parent ? `“${parent}”` : "the top level"}. Nothing else is deleted.`, confirmLabel: "Delete folder", danger: true });
  if (!ok) return false;
  try { await deleteFolder(f.id); await data.loadFiles(f.project_id); toast("Folder deleted"); return true; } catch (e) { fail("Delete")(e); return false; }
}

/** Put files into a folder (null = back to the top level). */
export async function placeFiles(list: { type: FileResourceType; id: string }[], folderId: string | null) {
  try {
    const saved = await Promise.all(list.map((x) => placeItem(x.type, x.id, folderId)));
    data.setFiles((cur) => {
      const keys = new Set(list.map((x) => `${x.type}:${x.id}`));
      return { ...cur, items: [...cur.items.filter((i) => !keys.has(`${i.resource_type}:${i.resource_id}`)), ...saved.filter((i): i is NonNullable<typeof i> => !!i)] };
    });
  } catch (e) { fail("Moving")(e); }
}

/** A shortcut on the active project's desktop; one per target (an existing one is only flashed). */
export async function addShortcut(projectId: string, target: Pick<DesktopItem, "kind" | "resource_type" | "resource_id" | "folder_id" | "app_id">, at: { x: number; y: number }): Promise<DesktopItem | null> {
  try {
    const item = await putDesktopItem({ id: crypto.randomUUID(), project_id: projectId, label: null, x: Math.max(0, Math.round(at.x)), y: Math.max(0, Math.round(at.y)), ...target });
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

export async function moveShortcut(d: DesktopItem, x: number, y: number) {
  const next = { ...d, x: Math.max(0, Math.round(x)), y: Math.max(0, Math.round(y)) };
  data.setFiles((cur) => ({ ...cur, desktop: cur.desktop.map((i) => (i.id === d.id ? next : i)) }));
  try { await putDesktopItem(next); } catch (e) { fail("Moving the icon")(e); }
}

export async function renameShortcut(d: DesktopItem, current: string) {
  const name = await promptDialog({ title: "Rename the shortcut", input: { label: "Label (empty: the item's own name)", value: d.label ?? current }, confirmLabel: "Rename" });
  if (name === null) return;
  const next = { ...d, label: name === current && !d.label ? null : name };
  try { const saved = await putDesktopItem(next); data.setFiles((cur) => ({ ...cur, desktop: cur.desktop.map((i) => (i.id === d.id ? saved : i)) })); } catch (e) { fail("Rename")(e); }
}

export async function removeShortcut(d: DesktopItem) {
  data.setFiles((cur) => ({ ...cur, desktop: cur.desktop.filter((i) => i.id !== d.id) }));
  try { await deleteDesktopItem(d.id); } catch (e) { if (!(e instanceof ApiError && e.status === 404)) fail("Removing the shortcut")(e); }
}

/** What Files may rename: timelines and days are renamed in their own window (it holds their copy). */
export const canRename = (t: FileResourceType) => t === "shot" || t === "view" || t === "location";
/** What Files may delete: timelines and days only in their own window, for the same reason. */
export const canDelete = (t: FileResourceType) => t !== "timeline" && t !== "day";

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

/** Delete a file with the honest consequences of its type; its placement and shortcuts go too. */
export async function deleteEntry(e: FileEntry): Promise<void> {
  const prune = () => data.setFiles((cur) => ({ ...cur, items: cur.items.filter((i) => !(i.resource_type === e.type && i.resource_id === e.id)), desktop: cur.desktop.filter((d) => !(d.resource_type === e.type && d.resource_id === e.id)) }));
  try {
    if (e.type === "shot") {
      const choice = await confirmDialog({ title: `Delete “${e.name}”?`, body: "Removes its images, drawings and metadata from the server permanently, and its clips from any timeline. Archive keeps them.", confirmLabel: "Delete", danger: true, altLabel: e.archived ? undefined : "Archive" });
      if (choice === "alt") { data.updated(await patchShot(e.id, { state: "archived" })); toast("Archived"); return; }
      if (!choice) return;
      await deleteShot(e.id); data.deleted([e.id]);
    } else if (e.type === "view") {
      if (!(await confirmDialog({ title: `Delete the view “${e.name}”?`, body: "Only the saved filter is deleted; no shots.", confirmLabel: "Delete view", danger: true }))) return;
      await deleteView(e.id); data.setViews((cur) => (cur ?? []).filter((x) => x.id !== e.id));
    } else if (e.type === "location") {
      if (!(await confirmDialog({ title: `Delete the location “${e.name}”?`, body: "Its spots go with it. Its shots stay, without a location.", confirmLabel: "Delete location", danger: true }))) return;
      await deleteLocation(e.id); data.setLocations((cur) => (cur ?? []).filter((x) => x.id !== e.id)); data.refreshCounts();
    } else if (e.type === "field") {
      if (!(await confirmDialog({ title: `Delete the field “${e.name}”?`, body: "Shots keep their stored values; they are just no longer shown or checked.", confirmLabel: "Delete field", danger: true }))) return;
      await deleteField(e.id); data.setFields((cur) => (cur ?? []).filter((x) => x.id !== e.id));
    } else return;
    prune();
    toast("Deleted");
  } catch (err) { fail("Delete")(err); }
}
