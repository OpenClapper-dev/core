import { useState } from "preact/hooks";
import { takenFrame } from "./canvas/geometry";
import { getPrefs } from "./prefs";
import { Button, Dialog, Tree, type TreeNodeData } from "@openclapper/design";
import { MAX_FILE_NAME, emptyCanvas, fileType, placementError } from "@openclapper/model";
import type { FileRec, Root } from "./api";
import { appDef, appFor, launch } from "./apps/registry";
import { fixedGlyph, kindOf, targetOf } from "./fileKinds";
import * as store from "./files";
import { openDialog, prompt, toast, toastError } from "./hosts";

/**
 * What a person does with files, wherever they do it (the Files app, the desktop, the bin): each
 * operation asks what it needs, changes the store, and says what happened. Views call these and
 * hold no rules of their own.
 */

/** Files dragged inside the Studio carry their ids under this type. */
export const FILE_DRAG = "application/x-oc-files";
export function setDrag(e: DragEvent, ids: string[]) {
  if (!e.dataTransfer) return;
  e.dataTransfer.setData(FILE_DRAG, JSON.stringify(ids));
  e.dataTransfer.effectAllowed = "copyMove";
}
export const hasDrag = (e: DragEvent) => !!e.dataTransfer?.types.includes(FILE_DRAG);
export function readDrag(e: DragEvent): string[] | null {
  try { const v = JSON.parse(e.dataTransfer?.getData(FILE_DRAG) ?? "") as unknown; return Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : null; } catch { return null; }
}

const nameCheck = (v: string) => (!v ? "Type a name" : v.length > MAX_FILE_NAME ? `At most ${MAX_FILE_NAME} characters` : null);
const count = (n: number, one = "file") => `${n} ${one}${n === 1 ? "" : "s"}`;

/**
 * A folder (or collection) in a window of its own, as an OS file manager opens one: one window per folder
 * (#426), so an open one comes to the front. `null` is the root (the project's, or the home's).
 */
export function openFolder(id: string | null, home = false, type = "folder") {
  launch({ app: "files", resource: id ? { type, id } : null, state: { folder: id, home } });
}

/** Open a file in the app registered for its type; a folder opens in Files, a shortcut opens what it points at. */
export function openFile(f: FileRec, files: ReadonlyMap<string, FileRec>) {
  if (f.type === "shortcut") {
    const t = targetOf(f, files);
    if (!t) { toast(`“${f.name}” points at something that is gone`, { tone: "warning" }); return; }
    if ("app" in t) { launch({ app: t.app }); return; }
    openFile(t.file, files);
    return;
  }
  if (kindOf(f.type).holds) { openFolder(f.id, f.home, f.type); return; }
  // A file made only inside another (a shot's progression) opens with the file it lives in.
  if (f.internal_of && fileType(f.type)?.insideOf) { const parent = files.get(f.internal_of); if (parent) { openFile(parent, files); return; } }
  // A filter opens in the file browser, which lists what matches it now.
  if (f.type === "filter") { launch({ app: "files", state: { filter: f.id } }); return; }
  const app = appFor(f.type);
  // An app that is one window in all opens as itself, told which file (`state.open`); any other opens a window for this file.
  if (app) launch(app.singleton ? { app: app.id, state: { open: { type: f.type, id: f.id } } } : { app: app.id, resource: { type: f.type, id: f.id }, title: f.name });
  else toast(`No app opens a ${kindOf(f.type).label.toLowerCase()} yet`, { tone: "info" });
}

export async function newFolder(root: Root, container: string | null): Promise<FileRec | null> {
  const name = await prompt({ title: "New folder", label: "Name", value: "New folder", confirmLabel: "Create", check: nameCheck });
  if (!name) return null;
  try { return await store.create(root, "folder", { name, container }); } catch (e) { toastError(e); return null; }
}

/** A new blank canvas (16:9), opened at once; named by the project's pattern. */
export async function newCanvas(root: Root, container: string | null): Promise<void> {
  try {
    const id = crypto.randomUUID();
    const f = await store.create(root, "canvas", { id, container, body: emptyCanvas() as unknown as Record<string, unknown> });
    launch({ app: "canvas", resource: { type: "canvas", id }, title: f.name });
  } catch (e) { toastError(e); }
}

/**
 * A canvas with a photo as its base, opened at once (docs/rewrite/05-composition.md): where the photo
 * is, or next to its collection (a collection holds photos only).
 */
export async function canvasFromPhoto(photo: FileRec, files: ReadonlyMap<string, FileRec>): Promise<void> {
  try {
    const id = crypto.randomUUID(), at = photo.container ? files.get(photo.container) : undefined;
    const container = at?.type === "collection" ? at.container : photo.container;
    const body = { ...emptyCanvas(), surface: { kind: "photo" }, ...takenFrame(photo, new Set([...files.values()].filter((x) => x.type === "preset" && !x.deleted_at).map((x) => x.id)), getPrefs().canvasTakesFrame) };
    const f = await store.create(store.rootOf(photo), "canvas", { id, container, body: body as unknown as Record<string, unknown>, refs: [{ kind: "base", to: photo.id }] });
    launch({ app: "canvas", resource: { type: "canvas", id }, title: f.name });
  } catch (e) { toastError(e); }
}

export async function renameFile(f: FileRec): Promise<void> {
  if (f.fixed) { toast(`The ${f.name} folder cannot be renamed`, { tone: "info" }); return; }
  const name = await prompt({ title: `Rename ${kindOf(f.type).label.toLowerCase()}`, label: "Name", value: f.name, confirmLabel: "Rename", check: nameCheck });
  if (!name || name === f.name) return;
  try { await store.rename(f, name); } catch (e) { toastError(e); }
}

/** To the recycle bin, with Undo. Fixed folders stay. */
export async function binFiles(root: Root, list: FileRec[]): Promise<void> {
  const ok = list.filter((f) => !f.fixed);
  if (!ok.length) { if (list.length) toast(`The ${list[0].name} folder cannot be deleted`, { tone: "info" }); return; }
  const ids = ok.map((f) => f.id);
  try {
    await store.bin(root, ids);
    toast(ok.length === 1 ? `“${ok[0].name}” moved to the recycle bin` : `${count(ok.length)} moved to the recycle bin`, { action: { label: "Undo", onClick: () => void store.restore(root, ids).catch(toastError) } });
  } catch (e) { toastError(e); }
}

/** Why these files cannot go into that container, before asking the server: the same rules, from the shared model. */
export function moveError(files: readonly FileRec[], list: FileRec[], container: string | null, root: Root): string | null {
  const m = store.byId(files);
  const into = container ? m.get(container) : null;
  for (const f of list) {
    if (f.fixed) return `The ${f.name} folder cannot be moved`;
    if (container && store.subtree(files, f.id).has(container)) return "A folder cannot go inside itself";
    const t = fileType(f.type);
    const wrong = t && placementError(t, into ? { type: into.type, fixed: into.fixed } : null, root === "home" ? "home" : "project");
    if (wrong) return wrong[0].toUpperCase() + wrong.slice(1);
  }
  return null;
}

/** Move files into a container (null: the top level); what is there already is left out. Returns whether anything moved. */
export async function moveFiles(root: Root, files: readonly FileRec[], list: FileRec[], container: string | null): Promise<boolean> {
  const moving = list.filter((f) => f.container !== container && f.id !== container);
  if (!moving.length) return false;
  const wrong = moveError(files, moving, container, root);
  if (wrong) { toast(wrong, { tone: "warning" }); return false; }
  const from = new Map(moving.map((f) => [f.id, f.container]));
  try {
    await store.move(root, moving.map((f) => f.id), container);
    const where = container ? `“${store.byId(files).get(container)?.name ?? "the folder"}”` : "the top level";
    toast(`${moving.length === 1 ? `“${moving[0].name}”` : count(moving.length)} moved to ${where}`, {
      action: { label: "Undo", onClick: () => { for (const back of new Set(from.values())) void store.move(root, moving.filter((f) => from.get(f.id) === back).map((f) => f.id), back).catch(toastError); } },
    });
    return true;
  } catch (e) { toastError(e); return false; }
}

export async function duplicateFile(f: FileRec): Promise<void> {
  try { const copy = await store.duplicate(f); toast(`Copied as “${copy.name}”`); } catch (e) { toastError(e); }
}

/** A shortcut to a file or an app, in a container (the Desktop folder). One per target there: a second one is not made. */
export async function makeShortcut(root: Root, files: readonly FileRec[], target: { file: FileRec } | { app: string }, container: string | null): Promise<FileRec | null> {
  const m = store.byId(files);
  const same = files.find((f) => f.type === "shortcut" && f.container === container && (() => { const t = targetOf(f, m); return !!t && ("app" in target ? "app" in t && t.app === target.app : "file" in t && t.file.id === target.file.id); })());
  if (same) { toast(`“${same.name}” is there already`, { tone: "info" }); return same; }
  try {
    return "app" in target
      ? await store.create(root, "shortcut", { name: appDef(target.app)?.name ?? target.app, container, body: { app: target.app }, refs: [] })
      : await store.create(root, "shortcut", { name: target.file.name, container, body: { app: null }, refs: [{ kind: "target", to: target.file.id }] });
  } catch (e) { toastError(e); return null; }
}

/** The folders of a root as tree nodes; `skip` leaves out folders that cannot be a target (what is being moved). */
export function folderNodes(files: readonly FileRec[], parent: string | null, skip: ReadonlySet<string> = new Set()): TreeNodeData[] {
  return files.filter((f) => kindOf(f.type).holds && f.container === parent && !f.internal_of && !skip.has(f.id))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }))
    .map((f) => ({ id: f.id, label: f.name, icon: f.fixed ? fixedGlyph(f.fixed) : kindOf(f.type).glyph, children: folderNodes(files, f.id, skip) }));
}

function FolderPicker({ files, rootLabel, skip, title, onPick, close }: { files: readonly FileRec[]; rootLabel: string; skip: ReadonlySet<string>; title: string; onPick: (container: string | null) => void; close: () => void }) {
  const [sel, setSel] = useState("root");
  return (
    <Dialog fixed title={title} onClose={close} footer={<><Button onClick={close}>Cancel</Button><Button variant="primary" onClick={() => { close(); onPick(sel === "root" ? null : sel); }}>Move here</Button></>}>
      <Tree className="st-picker" nodes={[{ id: "root", label: rootLabel, icon: "slate", children: folderNodes(files, null, skip) }]} defaultExpanded={["root"]} selected={sel} onSelect={setSel} />
    </Dialog>
  );
}

/** Ask where to, then move. */
export function moveFilesTo(root: Root, files: readonly FileRec[], list: FileRec[], rootLabel: string) {
  const skip = new Set(list.flatMap((f) => [...store.subtree(files, f.id)]));
  openDialog((close) => <FolderPicker files={files} rootLabel={rootLabel} skip={skip} close={close} title={list.length === 1 ? `Move “${list[0].name}” to…` : `Move ${count(list.length)} to…`} onPick={(c) => void moveFiles(root, files, list, c)} />);
}
