// What a cut plays (docs/features/timeline.md): each clip as one or more segments on the clock. A photo, a canvas
// or a placeholder holds the clip's time; a shot plays what its thumbnail is (#426 feedback 4): its thumbnail
// progression at that progression's own timing (one segment per picture, a zoom in steps one per step), or holds
// its thumbnail photo or canvas for the clip's time. Pure, for tests.
import type { Clip, FrameValues } from "@openclapper/model";
import { coverOf, itemsOf, overlayOf, pictureOf, progressionBody, timesOf, frameIdsOf } from "../shots/progression.ts";

/** The files the cut reads: type, references, body; deleted ones count as missing. */
export interface CutFile { id: string; type: string; name: string; deleted_at: string | null; internal_of?: string | null; refs?: { kind: string; to: string; data: Record<string, unknown> | null }[]; body?: Record<string, unknown> }

/** What plays for a stretch of time. `ref` is the picture (with a frame or a move), `def` a progression's default frame. */
export interface Seg {
  ms: number;
  kind: "pic" | "prog" | "placeholder" | "missing" | "empty";
  ref?: { to: string; frame?: string; move?: { to: string; ease: boolean } };
  def?: FrameValues | null;
  /** The overlay canvas drawn over a progression's pictures. */
  overlay?: string | null;
}
/** A clip on the clock: its segments, where it starts, how long it lasts, whether its length is the progression's. */
export interface Block<F extends CutFile = CutFile> { clip: Clip; file?: F; segs: Seg[]; start: number; len: number; fixed: boolean }

/** The segments one clip plays. */
export function segsOf(c: Clip, files: ReadonlyMap<string, CutFile>): Seg[] {
  if (!c.file) return [{ ms: c.ms, kind: "placeholder" }];
  const f = files.get(c.file);
  if (!f || f.deleted_at) return [{ ms: c.ms, kind: "missing", ref: { to: c.file, frame: c.frame } }];
  if (f.type !== "shot") return [{ ms: c.ms, kind: "pic", ref: { to: f.id, frame: c.frame } }];
  const cover = coverOf(f, files);
  if (!cover) return [{ ms: c.ms, kind: "empty" }];
  if (!cover.progression) return [{ ms: c.ms, kind: "pic", ref: cover.ref }];
  // The thumbnail progression plays at its own timing.
  const pf = files.get(cover.progression)!, prog = progressionBody(pf), items = itemsOf(pf), times = timesOf(prog, items, files);
  const overlay = prog.overlayShown ? overlayOf(pf) : null;
  return items.flatMap((it, i) => {
    const steps = it.data.zoom?.mode === "steps" ? frameIdsOf(files, it.to).length : 0;
    if (steps > 1) return Array.from({ length: steps }, (_, k) => ({ ms: times[i] / steps, kind: "prog" as const, ref: pictureOf(it, files, (k + 0.5) / steps).ref, def: prog.frame, overlay }));
    return [{ ms: times[i], kind: "prog" as const, ref: pictureOf(it, files, 0).ref, def: prog.frame, overlay }];
  });
}

/** The clips on the clock, one after the other. */
export function blocksOf<F extends CutFile>(clips: readonly Clip[], files: ReadonlyMap<string, F>): Block<F>[] {
  let at = 0;
  return clips.map((clip) => {
    const segs = segsOf(clip, files), len = segs.reduce((a, s) => a + s.ms, 0), start = at;
    at += len;
    return { clip, file: clip.file ? files.get(clip.file) : undefined, segs, start, len, fixed: segs[0].kind === "prog" };
  });
}

/** Where `t` falls: the block, its segment, and how far into the segment (0 to 1). */
export function at<F extends CutFile>(blocks: readonly Block<F>[], t: number): { block: Block<F>; seg: Seg; segStart: number; u: number } | null {
  if (!blocks.length) return null;
  const total = blocks[blocks.length - 1].start + blocks[blocks.length - 1].len;
  const here = Math.max(0, Math.min(t, total - 0.001));
  const block = blocks.find((b) => here >= b.start && here < b.start + b.len) ?? blocks[blocks.length - 1];
  let s0 = block.start;
  for (const seg of block.segs) {
    if (here < s0 + seg.ms) return { block, seg, segStart: s0, u: seg.ms ? (here - s0) / seg.ms : 0 };
    s0 += seg.ms;
  }
  const last = block.segs[block.segs.length - 1];
  return { block, seg: last, segStart: block.start + block.len - last.ms, u: 1 };
}

/** The chapters: each from its marker's clip to the next marker (or the end). */
export function chaptersOf(blocks: readonly Block[]): { clip: string; title: string; color: number | string; start: number; len: number }[] {
  const total = blocks.length ? blocks[blocks.length - 1].start + blocks[blocks.length - 1].len : 0;
  const marks = blocks.filter((b) => b.clip.chapter);
  return marks.map((b, i) => ({ clip: b.clip.id, title: b.clip.chapter!.title, color: b.clip.chapter!.color, start: b.start, len: (marks[i + 1]?.start ?? total) - b.start }));
}

/** A film strip of `n` segments: the first and the last always, the rest evenly from between. */
export function filmOf<T>(segs: readonly T[], n: number): T[] {
  const k = Math.max(1, Math.min(segs.length, n)), last = segs.length - 1;
  return k === 1 ? [segs[0]] : Array.from({ length: k }, (_, i) => segs[Math.round((i * last) / (k - 1))]);
}

/** The clips moved: those with the given ids taken out and put back, in their order, before the clip now at `to`. */
export function moveClips(clips: readonly Clip[], ids: readonly string[], to: number): Clip[] {
  const moving = clips.filter((c) => ids.includes(c.id));
  const before = clips.slice(0, to).filter((c) => !ids.includes(c.id)).length;
  const rest = clips.filter((c) => !ids.includes(c.id));
  return [...rest.slice(0, before), ...moving, ...rest.slice(before)];
}
