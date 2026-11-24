/**
 * Shots, sets and locations (docs/rewrite/04-shots.md, 09a-places.md, i1-interjection.md, ux-3-shot.md).
 * A content list is the file's "content" references in order; nothing is stored per entry. A shot's
 * progression is its "item" references in order (each with its time, and for a canvas the frame it
 * shows or the two frames it moves between) plus at most one "overlay" reference; the body keeps
 * only what belongs to the progression as a whole: its timing, its default frame, the overlay's switch.
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
export interface Progression {
  timing: Timing;
  /** Applied, centred, to items that have an angle of view and no frame of their own; null: none. */
  frame: FrameValues | null;
  /** Whether the overlay (the "overlay" reference) is drawn over the items. */
  overlayShown: boolean;
}
export interface ShotBody { progression: Progression | null }

/** What an "item" reference carries: its own time; for a canvas the frame it shows, or a smooth move from that frame to another. */
export interface ItemData { ms: number; frame?: string; move?: { to: string; ease: boolean } }

export const emptyShot = (): ShotBody => ({ progression: null });
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
  for (const k of Object.keys(d)) if (!["ms", "frame", "move"].includes(k)) return `an item has no "${k}"`;
  if (!int(d.ms, ITEM_MS.min, ITEM_MS.max)) return `an item holds between ${ITEM_MS.min} ms and ${ITEM_MS.max / 60_000} minutes`;
  if (d.frame !== undefined && !(typeof d.frame === "string" && LOCAL_ID.test(d.frame))) return "an item's frame is one of its canvas's frames";
  if (d.move !== undefined) {
    const m = d.move;
    if (d.frame === undefined) return "a smooth move starts at a frame";
    if (!isObj(m) || typeof m.to !== "string" || !LOCAL_ID.test(m.to) || m.to === d.frame || typeof m.ease !== "boolean" || Object.keys(m).length !== 2) return "a smooth move goes to another frame of the canvas, eased or not";
  }
  return null;
}

/** Null when a shot's body and references are valid: content in any number, items and the overlay only with a progression. */
export function shotError(b: Record<string, unknown>, refs: readonly Ref[]): string | null {
  for (const k of Object.keys(b)) if (k !== "progression") return `a shot has no "${k}"`;
  const p = b.progression;
  if (p !== null) {
    if (!isObj(p)) return "a progression is an object, or none";
    for (const k of Object.keys(p)) if (!["timing", "frame", "overlayShown"].includes(k)) return `a progression has no "${k}"`;
    const t = timingError(p.timing);
    if (t) return t;
    if (p.frame !== null) { const f = frameValuesError(p.frame); if (f) return `the default frame: ${f}`; }
    if (typeof p.overlayShown !== "boolean") return "overlayShown is yes or no";
  }
  const items = refs.filter((r) => r.kind === "item"), overlays = refs.filter((r) => r.kind === "overlay");
  if (refs.filter((r) => r.kind === "content").length > MAX_CONTENT) return `at most ${MAX_CONTENT} files in the content`;
  if (p === null && (items.length || overlays.length)) return "items and an overlay belong to a progression";
  if (items.length > MAX_ITEMS) return `at most ${MAX_ITEMS} pictures in a progression`;
  if (overlays.length > 1) return "a progression has one overlay";
  for (const r of refs) {
    if (r.kind === "item") { const e = itemDataError(r.data); if (e) return e; }
    else if (r.data != null) return `a ${r.kind} entry stores nothing`;
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

/** The time each item holds, in its order, as the progression's timing says. */
export function itemTimes(timing: Timing, items: readonly { ms: number }[]): number[] {
  if (timing.mode === "each" || !items.length) return items.map((i) => i.ms);
  const weights = items.map((_, i) => (timing.mode === "ends" && items.length > 2 && (i === 0 || i === items.length - 1) ? 2 : 1));
  const sum = weights.reduce((a, w) => a + w, 0);
  return weights.map((w) => Math.round((timing.total * w) / sum));
}

/**
 * The picture a shot is shown by (04-shots.md, "Thumbnail"): the first item of its progression, else
 * the first photo or canvas in its content, else none. `typeOf` says what a referenced file is (null: missing).
 */
export function shotCover(refs: readonly Ref[], typeOf: (id: string) => string | null): { to: string; frame?: string; rule: "progression" | "content" } | null {
  const item = refs.find((r) => r.kind === "item" && typeOf(r.to));
  if (item) return { to: item.to, frame: (item.data as ItemData | null)?.frame, rule: "progression" };
  const c = refs.find((r) => r.kind === "content" && (typeOf(r.to) === "photo" || typeOf(r.to) === "canvas"));
  return c ? { to: c.to, rule: "content" } : null;
}

/** The types a progression item may show and an overlay may be (pictures only, 04-shots.md); the Worker checks them. */
export const PICTURE_TYPES = ["photo", "canvas"] as const;
