/**
 * Shots, sets and locations (docs/rewrite/04-shots.md, 09a-places.md, i1-interjection.md, ux-3-shot.md).
 * A content list is the file's "content" references in order; nothing is stored per entry. A shot keeps
 * its content only (#426 feedback 4): a progression is a file of its own, made inside the shot (an
 * internal file) and listed in its content. A progression's pictures are its "item" references in
 * order (each with its time, and for a canvas the frame it shows, the two frames it moves between, or
 * a generated zoom over all its frames) plus at most one "overlay" reference; its body keeps what
 * belongs to it as a whole: its timing, its default frame, the overlay's switch.
 */
import type { Ref } from "./files.ts";
import { frameValuesError, type FrameValues } from "./canvas.ts";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const LOCAL_ID = /^[a-z0-9_-]{1,40}$/i;
const int = (v: unknown, min: number, max: number) => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

export const MAX_CONTENT = 1000;
export const MAX_ITEMS = 500;
/** An item holds between a tenth of a second and ten minutes; a total length at most an hour. */
export const ITEM_MS = { min: 100, max: 600_000 } as const;
export const TOTAL_MS = { min: 100, max: 3_600_000 } as const;
export const DEFAULT_ITEM_MS = 2000;

/**
 * How the items get their time: each its own (the item's `ms`), or one length split evenly across
 * them, or split with the first and the last held twice as long.
 */
export type Timing = { mode: "each" } | { mode: "even" | "ends"; total: number };
/** The body of a progression file. */
export interface Progression {
  timing: Timing;
  /** Applied, centred, to items that have an angle of view and no frame of their own; null: none. */
  frame: FrameValues | null;
  /** Whether the overlay (the "overlay" reference) is drawn over the items. */
  overlayShown: boolean;
}
/** A shot's body: nothing of its own since its progressions became files (#426 feedback 4). */
export type ShotBody = Record<string, never>;

/**
 * What an "item" reference carries: its own time; for a canvas the frame it shows, or a smooth move from
 * that frame to another, or a generated zoom over every frame of the canvas (`zoom`): in steps, one frame
 * after the other, each holding an equal part of `ms`; or smooth, from the first frame to the last.
 */
export interface ItemData { ms: number; frame?: string; move?: { to: string; ease: boolean }; zoom?: { mode: "steps" | "smooth"; ease: boolean } }

export const emptyShot = (): ShotBody => ({});
export const newProgression = (): Progression => ({ timing: { mode: "each" }, frame: null, overlayShown: true });

function timingError(t: unknown): string | null {
  if (!isObj(t)) return "timing is each item its own, or one length split evenly or to the ends";
  if (t.mode === "each") return Object.keys(t).length === 1 ? null : "timing \"each\" has no length";
  if ((t.mode === "even" || t.mode === "ends") && int(t.total, TOTAL_MS.min, TOTAL_MS.max) && Object.keys(t).length === 2) return null;
  return `one length is between ${TOTAL_MS.min} ms and ${TOTAL_MS.max / 60_000} minutes`;
}

/** Null when an item's data is valid. */
export function itemDataError(d: unknown): string | null {
  if (!isObj(d)) return "an item has its time";
  for (const k of Object.keys(d)) if (!["ms", "frame", "move", "zoom"].includes(k)) return `an item has no "${k}"`;
  if (!int(d.ms, ITEM_MS.min, ITEM_MS.max)) return `an item holds between ${ITEM_MS.min} ms and ${ITEM_MS.max / 60_000} minutes`;
  if (d.frame !== undefined && !(typeof d.frame === "string" && LOCAL_ID.test(d.frame))) return "an item's frame is one of its canvas's frames";
  if (d.move !== undefined) {
    const m = d.move;
    if (d.frame === undefined) return "a smooth move starts at a frame";
    if (!isObj(m) || typeof m.to !== "string" || !LOCAL_ID.test(m.to) || m.to === d.frame || typeof m.ease !== "boolean" || Object.keys(m).length !== 2) return "a smooth move goes to another frame of the canvas, eased or not";
  }
  if (d.zoom !== undefined) {
    const z = d.zoom;
    if (d.frame !== undefined || d.move !== undefined) return "a zoom shows every frame of its canvas, not one";
    if (!isObj(z) || (z.mode !== "steps" && z.mode !== "smooth") || typeof z.ease !== "boolean" || Object.keys(z).length !== 2) return "a zoom goes in steps or smoothly, eased or not";
  }
  return null;
}

/** Null when a shot's body and references are valid: a content list, nothing else. */
export function shotError(b: Record<string, unknown>, refs: readonly Ref[]): string | null {
  const extra = Object.keys(b);
  if (extra.length) return `a shot has no "${extra[0]}"`;
  if (refs.length > MAX_CONTENT) return `at most ${MAX_CONTENT} files in the content`;
  if (refs.some((r) => r.data != null)) return "a content entry stores nothing";
  return null;
}

/** Null when a progression's body and references are valid: its settings, pictures in order, at most one overlay. */
export function progressionError(p: Record<string, unknown>, refs: readonly Ref[]): string | null {
  for (const k of Object.keys(p)) if (!["timing", "frame", "overlayShown"].includes(k)) return `a progression has no "${k}"`;
  const t = timingError(p.timing);
  if (t) return t;
  if (p.frame !== null) { const f = frameValuesError(p.frame); if (f) return `the default frame: ${f}`; }
  if (typeof p.overlayShown !== "boolean") return "overlayShown is yes or no";
  if (refs.filter((r) => r.kind === "item").length > MAX_ITEMS) return `at most ${MAX_ITEMS} pictures in a progression`;
  if (refs.filter((r) => r.kind === "overlay").length > 1) return "a progression has one overlay";
  for (const r of refs) {
    if (r.kind === "item") { const e = itemDataError(r.data); if (e) return e; }
    else if (r.data != null) return `an ${r.kind} entry stores nothing`;
  }
  return null;
}

/** Null when a set's or a location's body and references are valid: a content list, nothing else yet. */
export function placeError(what: string, b: Record<string, unknown>, refs: readonly Ref[]): string | null {
  const extra = Object.keys(b);
  if (extra.length) return `a ${what} has no "${extra[0]}"`;
  if (refs.length > MAX_CONTENT) return `at most ${MAX_CONTENT} files in the content`;
  if (refs.some((r) => r.data != null)) return "a content entry stores nothing";
  return null;
}

/** How many pictures an item counts for when one length is split: a zoom in steps one per frame of its canvas. */
export const itemUnits = (d: Pick<ItemData, "zoom">, frames: number): number => (d.zoom?.mode === "steps" ? Math.max(1, frames) : 1);

/**
 * The time each item holds, in its order, as the progression's timing says. `units` (default 1) is how
 * many pictures an item counts for: a zoom in steps gets a share per step, and with "ends" the first and
 * the last picture (not item) are held twice as long.
 */
export function itemTimes(timing: Timing, items: readonly { ms: number; units?: number }[]): number[] {
  if (timing.mode === "each" || !items.length) return items.map((i) => i.ms);
  const units = items.map((i) => Math.max(1, i.units ?? 1)), n = units.reduce((a, u) => a + u, 0);
  const ends = timing.mode === "ends" && n > 2;
  const sum = n + (ends ? 2 : 0);
  let k = 0;
  return units.map((u) => {
    let w = 0;
    for (let j = 0; j < u; j++, k++) w += ends && (k === 0 || k === n - 1) ? 2 : 1;
    return Math.round((timing.total * w) / sum);
  });
}

/**
 * What an item shows at `u` (0 to 1 through it), given its canvas's frame ids in order: one frame, or a
 * move between two frames at `u`. A zoom in steps shows each frame for an equal part; a smooth zoom
 * moves from the first frame to the last.
 */
export function itemAt(d: ItemData, frameIds: readonly string[], u: number): { frame?: string; move?: { to: string; ease: boolean }; u: number } {
  const v = Math.max(0, Math.min(1, u));
  if (!d.zoom) return { frame: d.frame, move: d.move, u: v };
  if (!frameIds.length) return { u: v };
  if (d.zoom.mode === "steps") return { frame: frameIds[Math.min(frameIds.length - 1, Math.floor(v * frameIds.length))], u: 0 };
  return frameIds.length > 1 ? { frame: frameIds[0], move: { to: frameIds[frameIds.length - 1], ease: d.zoom.ease }, u: v } : { frame: frameIds[0], u: 0 };
}

/** What stands for a shot (`shotCover`): a file, and when it comes from a progression, the progression and its first item's data. */
export interface Cover { to: string; data: ItemData | null; progression: string | null }

const COVER_TYPES: readonly string[] = ["photo", "canvas", "progression"];

/**
 * The picture a shot, set or location is shown by (#426 feedback 4, "Thumbnail"): the first entry of its
 * content that is a photo, a canvas or a progression; a progression shows its first item (none when it is
 * empty). `typeOf` says what a referenced file is (null: missing); `itemsOf` gives a progression's references.
 */
export function shotCover(refs: readonly Ref[], typeOf: (id: string) => string | null, itemsOf: (id: string) => readonly Ref[] = () => []): Cover | null {
  const c = refs.find((r) => r.kind === "content" && COVER_TYPES.includes(typeOf(r.to) ?? ""));
  if (!c) return null;
  if (typeOf(c.to) !== "progression") return { to: c.to, data: null, progression: null };
  const first = itemsOf(c.to).find((r) => r.kind === "item");
  return first ? { to: first.to, data: (first.data as unknown as ItemData | null) ?? null, progression: c.to } : null;
}

/** The types a progression item may show and an overlay may be (pictures only, 04-shots.md); the Worker checks them. */
export const PICTURE_TYPES = ["photo", "canvas"] as const;
