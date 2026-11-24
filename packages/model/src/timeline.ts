/**
 * The timeline (docs/rewrite/06-timeline.md, ux-4-timeline.md): a rough cut, one track of clips in order,
 * for deciding. A clip is a reference (a photo, a canvas or one of its frames, a shot) and a hold time, or
 * a placeholder with a title; a chapter marker sits at the start of a clip. The clips live in the body (a
 * placeholder points at nothing); each clip with a file also keeps a "clip" reference, so "where is this
 * used", missing files and copies work as for every reference.
 */
import type { Ref } from "./files.ts";
import type { Colour } from "./properties.ts";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOCAL_ID = /^[a-z0-9_-]{1,40}$/i;
const HEX = /^#[0-9a-f]{6}$/i;
const colourOk = (c: unknown) => (typeof c === "number" && Number.isInteger(c) && c >= 0 && c <= 8) || (typeof c === "string" && HEX.test(c));
const int = (v: unknown, min: number, max: number) => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

export const MAX_CLIPS = 500;
/** A clip holds between a tenth of a second and an hour. */
export const HOLD_MS = { min: 100, max: 3_600_000 } as const;
/** How long a new clip holds when neither the account nor the timeline says otherwise. */
export const DEFAULT_HOLD_MS = 2000;
/** The types a clip may show (pictures, and shots); the Worker checks them. */
export const CLIP_TYPES = ["photo", "canvas", "shot"] as const;

export interface Chapter { title: string; color: Colour }
export interface Clip {
  id: string;
  /** The file it shows; null: a placeholder. */
  file: string | null;
  /** One frame of a canvas. */
  frame?: string;
  /** Its hold time; a shot with a progression plays the progression's length instead. */
  ms: number;
  /** A placeholder's title. */
  title?: string;
  /** A chapter starts at this clip. */
  chapter?: Chapter;
}
export interface TimelineBody {
  clips: Clip[];
  /** How long a new clip holds in this timeline; null: the account's setting. */
  holdMs: number | null;
}

export const emptyTimeline = (): TimelineBody => ({ clips: [], holdMs: null });

function clipError(c: unknown, ids: Set<string>): string | null {
  if (!isObj(c)) return "a clip is an object";
  for (const k of Object.keys(c)) if (!["id", "file", "frame", "ms", "title", "chapter"].includes(k)) return `a clip has no "${k}"`;
  if (typeof c.id !== "string" || !LOCAL_ID.test(c.id) || ids.has(c.id)) return "each clip has its own id";
  ids.add(c.id);
  if (!(c.file === null || (typeof c.file === "string" && UUID.test(c.file)))) return "a clip shows a file, or none (a placeholder)";
  if (c.frame !== undefined && (c.file === null || typeof c.frame !== "string" || !LOCAL_ID.test(c.frame))) return "a clip's frame is one of its canvas's frames";
  if (!int(c.ms, HOLD_MS.min, HOLD_MS.max)) return `a clip holds between ${HOLD_MS.min} ms and an hour`;
  if (c.title !== undefined && (typeof c.title !== "string" || c.title.length > 200)) return "a placeholder's title is at most 200 characters";
  if (c.chapter !== undefined) {
    const m = c.chapter;
    if (!isObj(m) || typeof m.title !== "string" || m.title.length > 120 || !colourOk(m.color) || Object.keys(m).length !== 2) return "a chapter has a title (at most 120 characters) and a colour";
  }
  return null;
}

/** Null when a timeline's body and references are valid: every clip with a file has its "clip" reference, in order. */
export function timelineError(b: Record<string, unknown>, refs: readonly Ref[]): string | null {
  for (const k of Object.keys(b)) if (!["clips", "holdMs"].includes(k)) return `a timeline has no "${k}"`;
  if (!Array.isArray(b.clips) || b.clips.length > MAX_CLIPS) return `at most ${MAX_CLIPS} clips`;
  const ids = new Set<string>();
  for (const c of b.clips) { const e = clipError(c, ids); if (e) return e; }
  if (!(b.holdMs === null || int(b.holdMs, HOLD_MS.min, HOLD_MS.max))) return "a timeline's hold time for new clips is between 100 ms and an hour, or the account's";
  const want = timelineRefs(b as unknown as TimelineBody);
  if (refs.length !== want.length || refs.some((r, i) => r.kind !== "clip" || r.to !== want[i].to || (r.data as { clip?: unknown } | null)?.clip !== want[i].data!.clip)) return "the references are the clips' files, in order";
  return null;
}

/** The references a timeline body implies: one "clip" reference per clip with a file, naming the clip. */
export const timelineRefs = (b: TimelineBody): Ref[] => b.clips.filter((c) => c.file).map((c) => ({ kind: "clip" as const, to: c.file!.toLowerCase(), data: { clip: c.id } }));

/** A copy's body: clips that showed files copied along show the copies. */
export function remapTimeline(b: Record<string, unknown>, ids: ReadonlyMap<string, string>): Record<string, unknown> {
  const clips = (b.clips as Clip[] | undefined)?.map((c) => (c.file && ids.has(c.file) ? { ...c, file: ids.get(c.file)! } : c));
  return clips ? { ...b, clips } : b;
}

/** Null when a master timeline (a project's order of timelines) is valid. */
export function masterError(v: unknown): string | null {
  if (!Array.isArray(v) || v.length > MAX_CLIPS) return `the master timeline is a list of at most ${MAX_CLIPS} timelines`;
  if (!v.every((x) => typeof x === "string" && UUID.test(x))) return "the master timeline lists timelines by id";
  if (new Set(v.map((x: string) => x.toLowerCase())).size !== v.length) return "a timeline is in the master timeline once";
  return null;
}
