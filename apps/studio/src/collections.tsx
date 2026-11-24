import { useState } from "preact/hooks";
import { AppIcon, Button, Dialog, List, ListRow, colorCss, type ChosenColor } from "@openclapper/design";
import type { FileRec, Root } from "./api";
import { moveFiles } from "./fileOps";
import * as store from "./files";
import { openDialog, prompt, toast, toastError } from "./hosts";

/**
 * Collections (docs/rewrite/i1-interjection.md): photos that belong together. A photo is in at most
 * one; taking photos out or ungrouping deletes nothing. A collection has a colour, given at random
 * when it is made, and an order for the media library: by time taken, or set by hand.
 */
export interface CollectionBody { color: ChosenColor; order: "time" | "manual"; manual?: string[] }
export const bodyOf = (c: FileRec): CollectionBody => ({ color: 1, order: "time", ...(c.body as Partial<CollectionBody> | undefined) });
export const tintOf = (c: FileRec | undefined) => (c ? colorCss(bodyOf(c).color) : undefined);
const count = (n: number) => `${n} photo${n === 1 ? "" : "s"}`;

/** The collection a file sits in, if it is one. */
export function collectionOf(f: FileRec, map: ReadonlyMap<string, FileRec>): FileRec | undefined {
  const c = f.container ? map.get(f.container) : undefined;
  return c?.type === "collection" ? c : undefined;
}

/** A collection's photos in its order: by time taken, or as set by hand (photos the hand order does not name follow by time). */
export function photosOf(c: FileRec, files: readonly FileRec[]): FileRec[] {
  const byTime = files.filter((f) => f.container === c.id && f.type === "photo" && !f.internal_of).sort((a, b) => (a.photo?.taken_at ?? a.created_at).localeCompare(b.photo?.taken_at ?? b.created_at) || a.name.localeCompare(b.name));
  const b = bodyOf(c);
  if (b.order !== "manual" || !b.manual?.length) return byTime;
  const at = new Map(b.manual.map((id, i) => [id, i]));
  return [...byTime].sort((x, y) => (at.get(x.id) ?? 1e9) - (at.get(y.id) ?? 1e9));
}

/** Make a collection of these photos, where they are if they all sit in one ordinary place. */
export async function groupInto(root: Root, files: readonly FileRec[], photos: FileRec[]): Promise<void> {
  const list = photos.filter((f) => f.type === "photo");
  if (!list.length) return;
  const name = await prompt({ title: "New collection", label: "Name", value: "Collection", confirmLabel: "Make collection" });
  if (!name) return;
  const map = store.byId(files);
  const places = new Set(list.map((f) => { const c = f.container ? map.get(f.container) : undefined; return c?.type === "collection" ? c.container : f.container; }));
  const container = places.size === 1 ? [...places][0] : null;
  try {
    const coll = await store.create(root, "collection", { name, container, body: { color: 1 + Math.floor(Math.random() * 8), order: "time" } });
    await store.move(root, list.map((f) => f.id), coll.id);
    toast(`${count(list.length)} in the collection “${coll.name}”`);
  } catch (e) { toastError(e); }
}

/** Take photos out of their collections: each goes to where its collection is. */
export async function takeOut(root: Root, files: readonly FileRec[], photos: FileRec[]): Promise<void> {
  const map = store.byId(files);
  const byPlace = new Map<string | null, FileRec[]>();
  for (const f of photos) { const c = collectionOf(f, map); if (c) byPlace.set(c.container, [...(byPlace.get(c.container) ?? []), f]); }
  try {
    for (const [place, list] of byPlace) await store.move(root, list.map((f) => f.id), place);
    if (byPlace.size) toast(`${count([...byPlace.values()].flat().length)} taken out; nothing was deleted`);
  } catch (e) { toastError(e); }
}

/** Ungroup: the photos go to where the collection is, then the empty collection goes to the bin. */
export async function ungroup(root: Root, files: readonly FileRec[], c: FileRec): Promise<void> {
  const list = photosOf(c, files);
  try {
    if (list.length) await store.move(root, list.map((f) => f.id), c.container);
    await store.bin(root, [c.id]);
    toast(`“${c.name}” ungrouped; its ${count(list.length)} stay`);
  } catch (e) { toastError(e); }
}

export async function setColor(c: FileRec, color: ChosenColor) {
  try { await store.saveBody(c, { ...bodyOf(c), color }); } catch (e) { toastError(e); }
}
export async function setOrder(c: FileRec, files: readonly FileRec[], order: "time" | "manual", manual?: string[]) {
  const b = bodyOf(c);
  try { await store.saveBody(c, { ...b, order, manual: order === "manual" ? manual ?? photosOf(c, files).map((f) => f.id) : b.manual }); } catch (e) { toastError(e); }
}

function CollectionPicker({ files, onPick, close }: { files: readonly FileRec[]; onPick: (c: FileRec) => void; close: () => void }) {
  const [sel, setSel] = useState<string | null>(null);
  const list = files.filter((f) => f.type === "collection" && !f.internal_of).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return (
    <Dialog fixed title="Add to collection" onClose={close} footer={<><Button onClick={close}>Cancel</Button><Button variant="primary" disabled={!sel} onClick={() => { close(); onPick(list.find((c) => c.id === sel)!); }}>Add</Button></>}>
      {list.length ? (
        <List className="st-pick__list">
          {list.map((c) => <ListRow key={c.id} selected={c.id === sel} leading={<i className="st-dot" style={{ background: tintOf(c) }} />} meta={count(photosOf(c, files).length)} onClick={() => setSel(c.id)} onDblClick={() => { close(); onPick(c); }}>{c.name}</ListRow>)}
        </List>
      ) : <p className="st-note">There is no collection yet. Use “Group into a collection”.</p>}
    </Dialog>
  );
}

/** Ask which collection, then put the photos in it. */
export function addToCollection(root: Root, files: readonly FileRec[], photos: FileRec[]) {
  openDialog((close) => <CollectionPicker files={files} close={close} onPick={(c) => void moveFiles(root, files, photos.filter((f) => f.type === "photo"), c.id)} />);
}

/** A collection's colour as an icon: its type glyph on its own colour. */
export const CollectionIcon = ({ c, size }: { c: FileRec; size: number }) => <AppIcon glyph="layers" size={size} style={{ background: tintOf(c), color: "var(--over-paper)" }} />;
