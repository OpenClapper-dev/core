// A shot's progressions as the Studio reads them (docs/features/shots.md, #426 feedback 4): each is a file made
// inside the shot and listed in its content; its items are "item" references with their time and frame. Pure: the
// shot window, the cover, the timeline and the tests read them the same way.
import { itemAt, itemTimes, itemUnits, newProgression, shotCover, type CanvasBody, type ItemData, type Progression } from "@openclapper/model";
import type { FileRec } from "../api";
import type { PicRef } from "./picture";

/** An item of a progression: the picture it shows and its data; `key` only tells items apart while editing. */
export interface Item { key: string; to: string; data: ItemData }

let keys = 0;
export const itemKey = () => `i${++keys}`;

/** What the readers need of a file (the Studio's records and the cut's both fit). */
export interface ProgFile { id: string; type: string; deleted_at: string | null; body?: Record<string, unknown>; refs?: { kind: string; to: string; data: Record<string, unknown> | null }[] }
type Files = ReadonlyMap<string, ProgFile>;

/** A progression file's settings, whatever its stored body lacks. */
export const progressionBody = (f: Pick<ProgFile, "body"> | undefined): Progression => ({ ...newProgression(), ...(f?.body as Partial<Progression> | undefined) });

/** Its items, in order. */
export const itemsOf = (f: Pick<ProgFile, "refs"> | undefined): Item[] =>
  (f?.refs ?? []).filter((r) => r.kind === "item").map((r) => ({ key: itemKey(), to: r.to, data: (r.data ?? { ms: 2000 }) as unknown as ItemData }));

/** Its overlay canvas, if any. */
export const overlayOf = (f: Pick<ProgFile, "refs"> | undefined): string | null => f?.refs?.find((r) => r.kind === "overlay")?.to ?? null;

/** A canvas's frame ids in their order (what a zoom block runs through). */
export function frameIdsOf(files: Files, id: string): string[] {
  const f = files.get(id);
  return f?.type === "canvas" ? ((f.body as unknown as CanvasBody | undefined)?.frames ?? []).map((x) => x.id) : [];
}

/** How long each item holds, the timing applied (a zoom in steps counts once per frame when one length is split). */
export function timesOf(p: Progression, items: readonly Pick<Item, "to" | "data">[], files: Files): number[] {
  return itemTimes(p.timing, items.map((i) => ({ ms: i.data.ms, units: itemUnits(i.data, frameIdsOf(files, i.to).length) })));
}

/** What an item shows at `u` (0 to 1 through it): the picture to draw and how far a move is. */
export function pictureOf(it: Pick<Item, "to" | "data">, files: Files, u = 0): { ref: PicRef; u: number } {
  const a = itemAt(it.data, frameIdsOf(files, it.to), u);
  return { ref: { to: it.to, frame: a.frame, move: a.move }, u: a.u };
}

/** The progressions of a shot: the live progression files its content lists, in that order. */
export function progressionsOf(shot: Pick<FileRec, "refs">, files: ReadonlyMap<string, FileRec>): FileRec[] {
  return (shot.refs ?? []).filter((r) => r.kind === "content").map((r) => files.get(r.to)).filter((x): x is FileRec => !!x && x.type === "progression" && !x.deleted_at);
}

/**
 * The picture a shot, set or location is shown by: the first photo, canvas or progression of its content (a
 * progression through its first item and its default frame). Null when it has none.
 */
export function coverOf(f: Pick<ProgFile, "type" | "refs">, files: Files): { ref: PicRef; def: Progression["frame"]; progression: string | null } | null {
  if (f.type !== "shot" && f.type !== "set" && f.type !== "location") return null;
  const live = (id: string) => { const x = files.get(id); return x && !x.deleted_at ? x : undefined; };
  const c = shotCover((f.refs ?? []) as Parameters<typeof shotCover>[0], (id) => live(id)?.type ?? null, (id) => (live(id)?.refs ?? []) as Parameters<typeof shotCover>[0]);
  if (!c) return null;
  if (!c.progression) return { ref: { to: c.to }, def: null, progression: null };
  const { ref } = pictureOf({ to: c.to, data: c.data ?? { ms: 1000 } }, files, 0);
  return { ref, def: progressionBody(files.get(c.progression)).frame, progression: c.progression };
}
