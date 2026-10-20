import type { ComponentChildren, JSX, RefObject } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { CLIP_MAX_MS, EDGE_WEIGHT, GROUP_MAX_MS, PRESENTATION_MODES, splitDuration, type GroupMode, type Presentation } from "@openclapper/vocab";
import { type ClipGroup, copyOverlay, copySketch, deleteTimeline, patchShot, patchShots, putTimeline, type Overlay, type Photo, type Shot, type ShotState, type Sketch, type Timeline, type TimelineClip } from "./api";
import { binned } from "./apps/trashOps";
import * as data from "./data";
import { frameModeLabel, shotTitle } from "./format";
import { Framed, type MaskMode } from "./Framed";
import { invalidateTimelines } from "./Inspector";
import { FramingSelect, presentationFrame, rootPresentation } from "./FramingSelect";
import { Button, ContextMenu, cx, EmptyNote, Field, Icon, IconButton, Input, Kbd, MenuItem, Panel, PanelBody, PanelHead, type SaveState, Seg, Select, SeqBadge, Spinner, StateMarker, toast, withViewTransition } from "@openclapper/ui";
import type { EditKind } from "./ClipEditing";
import { useSettings } from "./settings";
import type { CutPosition } from "./router";

/**
 * The pieces a timeline is edited with, shared by the Timeline page and the Review workspace
 * (issue #31): resolving clips, playback, the strip (with drag and drop), the preview and the
 * clip panel. A clip without a photo is a placeholder holding the spot for a shot to come.
 */

export const DEFAULT_MS = 3000;
/** The right drawer (clip panel, shot browser) shares one remembered width. */
export const DRAWER_RESIZE = { key: "timelineDrawer", min: 300, max: 720 };
export const STEP_MS = 500;
/** Strip zoom (px per second) and clip thumbnail height: defaults, limits, remembered per browser. */
const ZOOM = { def: 44, min: 6, max: 480 };
const THUMB = { def: 54, min: 28, max: 220 };
const CLIP_GAP = 2;
function stored(key: string, lim: { def: number; min: number; max: number }): number {
  try { const v = Number(localStorage.getItem(key)); return v >= lim.min && v <= lim.max ? v : lim.def; } catch { return lim.def; }
}
const store = (key: string, v: number) => { try { localStorage.setItem(key, String(v)); } catch { /* a preference */ } };
/** "1:02.5" */
export const clock = (ms: number) => { const s = ms / 1000; const m = Math.floor(s / 60); const r = s - m * 60; return `${m}:${r < 10 ? "0" : ""}${r.toFixed(1)}`; };
export const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/**
 * A clip with what it points at; photo clips of deleted shots/photos are skipped (the server drops
 * them on the next save). `ownOverlays` / `ownSketch` are what the clip made inline (issue #31).
 */
export type ResolvedClip =
  | { kind: "photo"; clip: TimelineClip; pres: Presentation; shot: Shot; photo: Photo; overlay: Overlay | null; ownOverlays: Overlay[]; ownSketch: Sketch | null; index: number; startMs: number; /** Its sequence block (issue #37): settings, and its place among the block's clips. */ group: ClipGroup | null; seq: { i: number; n: number } | null }
  | { kind: "sketch"; clip: TimelineClip; sketch: Sketch; index: number; startMs: number }
  | { kind: "placeholder"; clip: TimelineClip; index: number; startMs: number };

export function resolveClips(t: Timeline, byId: Map<string, Shot>): ResolvedClip[] {
  const out: ResolvedClip[] = [];
  const own = (clipId: string) => t.overlays.filter((o) => o.clip_id === clipId);
  const sketches = new Map<string, Sketch>([...[...byId.values()].flatMap((s) => s.sketches), ...t.sketches].map((k) => [k.id, k]));
  let at = 0;
  t.clips.forEach((clip, index) => {
    if (clip.photo_id === null) {
      const sketch = clip.sketch_id ? sketches.get(clip.sketch_id) : undefined;
      out.push(sketch ? { kind: "sketch", clip, sketch, index, startMs: at } : { kind: "placeholder", clip, index, startMs: at });
      at += clip.duration_ms;
      return;
    }
    const shot = clip.shot_id ? byId.get(clip.shot_id) : undefined;
    const photo = shot?.photos.find((p) => p.id === clip.photo_id);
    if (!shot || !photo || !clip.presentation) return;
    const ownOverlays = own(clip.id);
    const overlay = shot.overlays.find((o) => o.id === clip.overlay_id) ?? ownOverlays.find((o) => o.id === clip.overlay_id) ?? null;
    out.push({ kind: "photo", clip, pres: clip.presentation, shot, photo, overlay, ownOverlays, ownSketch: t.sketches.find((k) => k.clip_id === clip.id) ?? null, index, startMs: at, group: null, seq: null });
    at += clip.duration_ms;
  });
  // Blocks, counted over the clips that render (a clip of a deleted photo is skipped).
  const groups = new Map(t.groups.map((g) => [g.id, g]));
  for (let i = 0; i < out.length; i++) {
    const c = out[i];
    const g = c.kind === "photo" && c.clip.group_id ? groups.get(c.clip.group_id) : undefined;
    if (!g) continue;
    let j = i;
    while (j < out.length && out[j].clip.group_id === g.id) j++;
    for (let k = i; k < j; k++) { const m = out[k]; if (m.kind === "photo") { m.group = g; m.seq = { i: k - i, n: j - i }; } }
    i = j - 1;
  }
  return out;
}
/** A clip's own re-frame (issue #31): no saved framing, but a placed frame (re-framed inline). */
export const ownReframe = (pres: Presentation) => !pres.framing_id && pres.frame?.x !== undefined;
/** Default presentation of a photo: the view's frame mode and the rig it was shot with. */
export const defaultPresentation = (photo: Photo, mode: MaskMode): Presentation => ({ mode, ...rootPresentation(photo) });
export const newPlaceholder = (title: string): TimelineClip =>
  ({ id: crypto.randomUUID(), photo_id: null, shot_id: null, overlay_id: null, presentation: null, duration_ms: DEFAULT_MS, notes: null, title, sketch_id: null, group_id: null });

// ---------- Sequence blocks (issue #37): a sequence's clips stay together, in photo order ----------

export const newGroup = (totalMs: number, mode: GroupMode = "each"): ClipGroup => ({ id: crypto.randomUUID(), mode, total_ms: totalMs, split: "even", edge_weight: EDGE_WEIGHT.def });

const photoClip = (s: Shot, p: Photo, mode: MaskMode, groupId: string | null): TimelineClip =>
  ({ id: crypto.randomUUID(), photo_id: p.id, shot_id: s.id, overlay_id: null, presentation: defaultPresentation(p, mode), duration_ms: DEFAULT_MS, notes: null, title: null, sketch_id: null, group_id: groupId });

/** The clips a shot contributes when added: one per photo at the default hold time; a sequence's form a block. */
export function clipsOfShot(s: Shot, mode: MaskMode): { clips: TimelineClip[]; group: ClipGroup | null } {
  const group = s.photos.length > 1 ? newGroup(s.photos.length * DEFAULT_MS) : null;
  return { group, clips: s.photos.map((p) => photoClip(s, p, mode, group?.id ?? null)) };
}

/**
 * Keeps blocks consistent after any edit: blocks without clips go, a "total" block's clips share its
 * length (`splitDuration`, the same the server applies on save).
 */
export function normalizeGroups(t: Timeline): Timeline {
  if (t.groups.length === 0) return t;
  const used = t.groups.filter((g) => t.clips.some((c) => c.group_id === g.id));
  let clips = t.clips;
  for (const g of used) {
    if (g.mode !== "total") continue;
    const ids = clips.filter((c) => c.group_id === g.id).map((c) => c.id);
    const parts = new Map(splitDuration(g.total_ms, ids.length, g.split, g.edge_weight).map((ms, i) => [ids[i], ms]));
    if (clips.every((c) => !parts.has(c.id) || c.duration_ms === parts.get(c.id))) continue;
    clips = clips.map((c) => (parts.has(c.id) ? { ...c, duration_ms: parts.get(c.id)! } : c));
  }
  return used.length === t.groups.length && clips === t.clips ? t : { ...t, groups: used, clips };
}

/** The [start, end) range of the unit at index i: its whole block, or the clip alone. */
export function unitAt(list: { group_id: string | null }[], i: number): [number, number] {
  const g = list[i]?.group_id;
  if (!g) return [i, i + 1];
  let a = i, b = i + 1;
  while (a > 0 && list[a - 1].group_id === g) a--;
  while (b < list.length && list[b].group_id === g) b++;
  return [a, b];
}

/** An insertion index never splits a block: inside one it moves to the nearer edge. */
export function snapIndex(list: { group_id: string | null }[], i: number): number {
  if (i <= 0 || i >= list.length) return i;
  const g = list[i].group_id;
  if (!g || list[i - 1].group_id !== g) return i;
  const [a, b] = unitAt(list, i);
  return i - a <= b - i ? a : b;
}

/** Moves the unit holding `clipId` (its block, or the clip) to insertion index `to` (counted before the move). */
export function moveUnitTo(list: TimelineClip[], clipId: string, to: number): TimelineClip[] {
  const i = list.findIndex((c) => c.id === clipId);
  if (i < 0) return list;
  const [a, b] = unitAt(list, i);
  const at = snapIndex(list, to);
  if (at >= a && at <= b) return list;
  const rest = [...list.slice(0, a), ...list.slice(b)];
  rest.splice(at > a ? at - (b - a) : at, 0, ...list.slice(a, b));
  return rest;
}

/** Alt+←/→: the unit swaps places with its neighbouring unit. */
export function stepUnit(list: TimelineClip[], clipId: string, d: number): TimelineClip[] {
  const i = list.findIndex((c) => c.id === clipId);
  if (i < 0) return list;
  const [a, b] = unitAt(list, i);
  if (d < 0) return a === 0 ? list : moveUnitTo(list, clipId, unitAt(list, a - 1)[0]);
  return b >= list.length ? list : moveUnitTo(list, clipId, unitAt(list, b)[1]);
}

/** The list without a clip, or with `whole` without the block it is in. */
export function withoutClip(list: TimelineClip[], clipId: string, whole: boolean): TimelineClip[] {
  const i = list.findIndex((c) => c.id === clipId);
  if (i < 0) return list;
  const [a, b] = whole ? unitAt(list, i) : [i, i + 1];
  return [...list.slice(0, a), ...list.slice(b)];
}

/** Inserts a shot (a block for a sequence) at a stored index, never inside a block. */
export function insertShot(t: Timeline, s: Shot, mode: MaskMode, index?: number): { t: Timeline; first: string } {
  const { clips, group } = clipsOfShot(s, mode);
  const l = [...t.clips];
  l.splice(index === undefined ? l.length : snapIndex(l, index), 0, ...clips);
  return { t: { ...t, clips: l, groups: group ? [...t.groups, group] : t.groups }, first: clips[0].id };
}

/**
 * Fills a placeholder (or sketch clip) with a shot. A single photo takes the spot; a sequence becomes
 * a block in "total" mode at the spot's hold time. The first clip keeps the spot's id and notes, so
 * a sketch the spot owns stays with it.
 */
export function fillSpot(t: Timeline, spotId: string, s: Shot, mode: MaskMode): Timeline {
  const i = t.clips.findIndex((c) => c.id === spotId);
  if (i < 0) return t;
  const spot = t.clips[i];
  const group = s.photos.length > 1 ? newGroup(Math.max(spot.duration_ms, s.photos.length * 100), "total") : null;
  const fresh = s.photos.map((p, k) => (k === 0
    ? { ...photoClip(s, p, mode, group?.id ?? null), id: spot.id, notes: spot.notes, duration_ms: spot.duration_ms }
    : photoClip(s, p, mode, group!.id)));
  const l = [...t.clips];
  l.splice(i, 1, ...fresh);
  return normalizeGroups({ ...t, clips: l, groups: group ? [...t.groups, group] : t.groups });
}

/** Copies a clip's unit for Duplicate: a block's clip duplicates the whole block (a new block, same settings). */
export async function duplicateUnit(t: Timeline, clipId: string): Promise<{ copies: TimelineClip[]; group: ClipGroup | null }> {
  const i = t.clips.findIndex((c) => c.id === clipId);
  const [a, b] = unitAt(t.clips, i);
  const src = t.clips.slice(a, b);
  const g0 = src[0].group_id ? t.groups.find((g) => g.id === src[0].group_id) : undefined;
  const group = g0 ? { ...g0, id: crypto.randomUUID() } : null;
  const copies = await Promise.all(src.map((c) => copyClip(t, c)));
  return { copies: copies.map((c) => ({ ...c, group_id: group?.id ?? null })), group };
}

/** Puts copies right after the unit of `clipId` (the latest timeline: the copy was async). */
export function insertAfterUnit(t: Timeline, clipId: string, copies: TimelineClip[], group: ClipGroup | null): Timeline {
  const i = t.clips.findIndex((c) => c.id === clipId);
  const at = i < 0 ? t.clips.length : unitAt(t.clips, i)[1];
  const l = [...t.clips];
  l.splice(at, 0, ...copies);
  return { ...t, clips: l, groups: group ? [...t.groups, group] : t.groups };
}

/** Ungroup: the block's clips become loose clips, each keeping its current hold time. */
export const ungroup = (t: Timeline, groupId: string): Timeline =>
  ({ ...t, groups: t.groups.filter((g) => g.id !== groupId), clips: t.clips.map((c) => (c.group_id === groupId ? { ...c, group_id: null } : c)) });

/** Brings a block's removed photos back, in photo order, at the default hold time. */
export function restorePhotos(t: Timeline, groupId: string, s: Shot, mode: MaskMode): Timeline {
  const i = t.clips.findIndex((c) => c.group_id === groupId);
  if (i < 0) return t;
  const [a, b] = unitAt(t.clips, i);
  const have = new Map(t.clips.slice(a, b).map((c) => [c.photo_id, c]));
  const next = s.photos.map((p) => have.get(p.id) ?? photoClip(s, p, mode, groupId));
  const l = [...t.clips];
  l.splice(a, b - a, ...next);
  return normalizeGroups({ ...t, clips: l });
}

/** A block's settings changed: the clips follow. A switch to "total" starts from the block's current length, so nothing jumps. */
export function setGroup(t: Timeline, g: ClipGroup): Timeline {
  const prev = t.groups.find((x) => x.id === g.id);
  const next = prev?.mode === "each" && g.mode === "total"
    ? { ...g, total_ms: t.clips.filter((c) => c.group_id === g.id).reduce((a, c) => a + c.duration_ms, 0) }
    : g;
  return normalizeGroups({ ...t, groups: t.groups.map((x) => (x.id === g.id ? next : x)) });
}

export const clipLabel = (c: ResolvedClip): string => (c.kind === "photo" ? shotTitle(c.shot) : c.kind === "sketch" ? c.sketch.name : c.clip.title ?? "Placeholder");

/**
 * The clips that use each shot (issue #35): a clip of any of its photos (an overlay hangs off the
 * photo, so it counts too) or a sketch clip showing one of its sketches. One clip is enough; a
 * sequence block counts once (issue #37).
 */
export function shotUsage(clips: ResolvedClip[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  const add = (shotId: string, clipId: string) => m.set(shotId, [...(m.get(shotId) ?? []), clipId]);
  for (const c of clips) {
    // A block counts once: its first clip.
    if (c.kind === "photo") { if (!c.seq || c.seq.i === 0) add(c.shot.id, c.clip.id); }
    else if (c.kind === "sketch" && c.sketch.shot_id) add(c.sketch.shot_id, c.clip.id);
  }
  return m;
}

/** A review decision taken in a timeline (browser card or clip), with Undo in the toast like the inspector. */
export async function setShotState(s: Shot, to: ShotState, onUpdated: (s: Shot) => void) {
  if (s.state === to) return;
  const before = s.state;
  try {
    onUpdated(await patchShot(s.id, { state: to }));
    toast(`${to === "unreviewed" ? "Back to review" : to === "approved" ? "Approved" : "Archived"} · ${shotTitle(s)}`, "ok", { label: "Undo", run: () => void patchShot(s.id, { state: before }).then(onUpdated).catch((e: Error) => toast(`Undo failed: ${e.message}`, "danger")) });
  } catch (e) { toast(`Update failed: ${(e as Error).message}`, "danger"); }
}

/** The decisions a shot can still take: the two states it is not in. */
export const DECISIONS: { to: ShotState; label: string; icon: string }[] = [
  { to: "approved", label: "Approve", icon: "check" },
  { to: "archived", label: "Archive", icon: "archive-arrow-down-outline" },
  { to: "unreviewed", label: "Back to review", icon: "undo-variant" },
];

/**
 * One decision for the whole cut, next to the presentation lock: while any shot in it is still
 * unreviewed, "Approve all" approves those; once none is, "Back to review" returns the approved ones.
 * Archived shots are left alone. One bulk request, with Undo in the toast.
 */
export function CutDecision({ clips, onUpdated }: { clips: ResolvedClip[]; onUpdated: (s: Shot[]) => void }) {
  const [busy, setBusy] = useState(false);
  const shots = [...new Map(clips.flatMap((c) => (c.kind === "photo" ? [[c.shot.id, c.shot] as const] : []))).values()];
  const unreviewed = shots.filter((s) => s.state === "unreviewed");
  const approved = shots.filter((s) => s.state === "approved");
  const [list, from, to] = unreviewed.length ? [unreviewed, "unreviewed", "approved"] as const : [approved, "approved", "unreviewed"] as const;
  if (list.length === 0) return null;
  const n = list.length, ids = list.map((s) => s.id);
  async function run() {
    setBusy(true);
    try {
      onUpdated(await patchShots(ids, { state: to }));
      toast(`${to === "approved" ? "Approved" : "Back to review"} · ${n} shot${n === 1 ? "" : "s"} in this timeline`, "ok", { label: "Undo", run: () => void patchShots(ids, { state: from }).then(onUpdated).catch((e: Error) => toast(`Undo failed: ${e.message}`, "danger")) });
    } catch (e) { toast(`Update failed: ${(e as Error).message}`, "danger"); }
    finally { setBusy(false); }
  }
  return (
    <Field label="Review" as="div">
      {to === "approved"
        ? <Button kind="approve" icon="check-all" disabled={busy} title={`Approve the ${n} unreviewed shot${n === 1 ? "" : "s"} in this timeline`} onClick={() => void run()}>Approve all · {n}</Button>
        : <Button kind="archive" icon="undo-variant" disabled={busy} title={`Every shot in this timeline is decided: send the ${n} approved back to review`} onClick={() => void run()}>Back to review · {n}</Button>}
    </Field>
  );
}

export interface ClipMenuProps {
  menu: { x: number; y: number; ctx: ResolvedClip };
  onClose: () => void;
  onEdit: (kind: EditKind, c: ResolvedClip) => void;
  onOpen: (c: ResolvedClip) => void;
  onDuplicate: (c: ResolvedClip) => void;
  onRemove: (c: ResolvedClip) => void;
  /** Approve / archive the clip's shot (photo clips only). */
  onState: (s: Shot, to: ShotState) => void;
}

/** A clip's right-click menu, the same in Review and Timeline. */
export function ClipMenu({ menu, onClose, onEdit, onOpen, onDuplicate, onRemove, onState }: ClipMenuProps) {
  const c = menu.ctx;
  return (
    <ContextMenu x={menu.x} y={menu.y} label="Clip" onClose={onClose}>
      {c.kind === "photo" && c.photo.source === "camera" && <MenuItem icon="crop" onClick={() => onEdit("reframe", c)}>Re-frame</MenuItem>}
      {c.kind === "photo" && <MenuItem icon="layers-outline" onClick={() => onEdit("overlay", c)}>Overlay</MenuItem>}
      {c.kind !== "photo" && <MenuItem icon="draw" onClick={() => onEdit("sketch", c)}>{c.kind === "sketch" ? "Edit the sketch" : "Sketch it"}</MenuItem>}
      {c.kind === "photo" && DECISIONS.filter((d) => d.to !== c.shot.state).map((d) => <MenuItem key={d.to} icon={d.icon} onClick={() => onState(c.shot, d.to)}>{d.label}</MenuItem>)}
      {c.kind === "photo" && <MenuItem icon="image-outline" onClick={() => onOpen(c)}>Open shot</MenuItem>}
      <MenuItem icon="content-duplicate" onClick={() => onDuplicate(c)}>Duplicate</MenuItem>
      <MenuItem icon="delete-outline" danger onClick={() => onRemove(c)}>Remove</MenuItem>
    </ContextMenu>
  );
}

/**
 * Copy a clip for Duplicate: a new id, and its own overlay or sketch copied server-side so the two
 * clips do not share a drawing. Shot overlays and sketches are shared (they are references).
 */
export async function copyClip(t: Timeline, clip: TimelineClip): Promise<TimelineClip> {
  const copy: TimelineClip = { ...clip, id: crypto.randomUUID() };
  const owner = { timeline_id: t.id, clip_id: copy.id };
  if (clip.overlay_id && t.overlays.some((o) => o.id === clip.overlay_id)) copy.overlay_id = (await copyOverlay(clip.overlay_id, crypto.randomUUID(), owner)).id;
  if (clip.sketch_id && t.sketches.some((k) => k.id === clip.sketch_id)) copy.sketch_id = (await copySketch(clip.sketch_id, crypto.randomUUID(), owner)).id;
  return copy;
}

/**
 * Duplicate a timeline with its clips' own overlays and sketches: the copy is saved first (its clips
 * can only own drawings once it exists), then the drawings are copied, then the clips point at them.
 */
export async function duplicateTimeline(t: Timeline): Promise<Timeline> {
  const ids = new Map(t.clips.map((c) => [c.id, crypto.randomUUID()]));
  const gids = new Map(t.groups.map((g) => [g.id, crypto.randomUUID()]));
  const ownOverlay = new Set(t.overlays.map((o) => o.id)), ownSketch = new Set(t.sketches.map((k) => k.id));
  const base: Timeline = { ...t, id: crypto.randomUUID(), name: `${t.name} (copy)`, groups: t.groups.map((g) => ({ ...g, id: gids.get(g.id)! })), overlays: [], sketches: [], created_at: "", updated_at: null, clips: [] };
  const stripped = t.clips.map((c) => ({ ...c, id: ids.get(c.id)!, group_id: c.group_id ? gids.get(c.group_id) ?? null : null, overlay_id: c.overlay_id && ownOverlay.has(c.overlay_id) ? null : c.overlay_id, sketch_id: c.sketch_id && ownSketch.has(c.sketch_id) ? null : c.sketch_id }));
  await putTimeline({ ...base, clips: stripped });
  const clips = await Promise.all(t.clips.map(async (c, i) => {
    const owner = { timeline_id: base.id, clip_id: ids.get(c.id)! };
    const next = { ...stripped[i] };
    if (c.overlay_id && ownOverlay.has(c.overlay_id)) next.overlay_id = (await copyOverlay(c.overlay_id, crypto.randomUUID(), owner)).id;
    if (c.sketch_id && ownSketch.has(c.sketch_id)) next.sketch_id = (await copySketch(c.sketch_id, crypto.randomUUID(), owner)).id;
    return next;
  }));
  return putTimeline({ ...base, clips });
}

// ---------- The project's timelines with autosave (600 ms debounce, flush on leave) ----------

export interface TimelineStore {
  list: Timeline[] | null;
  setList: (f: (cur: Timeline[] | null) => Timeline[] | null) => void;
  error: string | null;
  save: SaveState;
  change: (t: Timeline) => void;
  create: (projectId: string) => Promise<Timeline | null>;
  remove: (t: Timeline) => Promise<boolean>;
  retry: () => void;
  /** Send a pending change now (a promotion needs the clip on the server). */
  saveNow: (id: string) => Promise<void>;
  /** Take the server's copy (after a promotion changed it there). */
  replace: (t: Timeline) => void;
}

/** The server's list, with this window's copy of every item it already holds. */
export function keepLocal<T extends { id: string }>(cur: T[] | null, fresh: T[]): T[] {
  const mine = new Map((cur ?? []).map((x) => [x.id, x]));
  return fresh.map((x) => mine.get(x.id) ?? x);
}

export function useTimelineStore(load: (set: (t: Timeline[]) => void, fail: (e: Error) => void) => void, deps: unknown[]): TimelineStore {
  const [list, setListState] = useState<Timeline[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [save, setSave] = useState<SaveState>("idle");
  const pending = useRef(new Map<string, { timer: ReturnType<typeof setTimeout>; t: Timeline }>());
  useEffect(() => { setListState(null); load(setListState, (e) => setError(e.message)); }, deps);
  // A timeline binned or restored elsewhere (Files, the bin, Undo): re-read the list, keeping this
  // window's copies of the ones it still has (they may hold edits not saved yet).
  useEffect(() => data.onTrash((e) => {
    if (e.type !== "timeline" && e.type !== "folder") return;
    if (e.kind === "binned") { const p = pending.current.get(e.id); if (p) { clearTimeout(p.timer); pending.current.delete(e.id); } }
    load((fresh) => setListState((cur) => keepLocal(cur, fresh)), () => {});
  }), deps);
  const setList = (f: (cur: Timeline[] | null) => Timeline[] | null) => setListState(f);
  const flush = (t: Timeline): Promise<void> => {
    pending.current.delete(t.id);
    setSave("saving");
    return putTimeline(t).then((saved) => {
      invalidateTimelines(t.project_id);
      // The server may have dropped clips of deleted photos; take its list.
      setListState((cur) => (cur ?? []).map((x) => (x.id === saved.id && !pending.current.has(saved.id) ? saved : x)));
      if (pending.current.size === 0) setSave("saved");
    }).catch((e: Error) => { setSave("error"); setError(e.message); pending.current.set(t.id, { t, timer: setTimeout(() => {}, 0) }); });
  };
  useEffect(() => () => { for (const { timer, t } of pending.current.values()) { clearTimeout(timer); void putTimeline(t).catch(() => {}); } pending.current.clear(); }, []);
  const retry = () => { for (const { t } of [...pending.current.values()]) flush(t); };
  const change = (t: Timeline) => {
    setListState((cur) => (cur ?? []).map((x) => (x.id === t.id ? t : x)));
    setSave("dirty");
    const prev = pending.current.get(t.id);
    if (prev) clearTimeout(prev.timer);
    pending.current.set(t.id, { t, timer: setTimeout(() => flush(t), 600) });
  };
  const create = async (projectId: string): Promise<Timeline | null> => {
    const n = (list?.length ?? 0) + 1;
    const t: Timeline = { id: crypto.randomUUID(), project_id: projectId, name: `Cut ${n}`, notes: null, lock_mode: null, clips: [], groups: [], overlays: [], sketches: [], created_at: "", updated_at: null };
    try { const saved = await putTimeline(t); invalidateTimelines(projectId); setListState((cur) => [...(cur ?? []), saved]); return saved; } catch (e) { toast(`Could not create the timeline: ${(e as Error).message}`, "danger"); return null; }
  };
  /** To the recycle bin with Undo; a pending edit is sent first so the restored copy has it. */
  const remove = async (t: Timeline): Promise<boolean> => {
    try {
      const p = pending.current.get(t.id);
      if (p) { clearTimeout(p.timer); await flush(p.t); }
      await deleteTimeline(t.id); invalidateTimelines(t.project_id); setListState((cur) => (cur ?? []).filter((x) => x.id !== t.id));
      binned([{ type: "timeline", id: t.id }], t.project_id, `“${t.name}”`);
      return true;
    } catch (e) { toast(`Delete failed: ${(e as Error).message}`, "danger"); return false; }
  };
  const saveNow = async (id: string) => { const p = pending.current.get(id); if (!p) return; clearTimeout(p.timer); await flush(p.t); };
  const replace = (t: Timeline) => setListState((cur) => (cur ?? []).map((x) => (x.id === t.id ? t : x)));
  return { list, setList, error, save, change, create, remove, retry, saveNow, replace };
}

// ---------- Playback: 100 ms ticks; the next clip starts when the hold time is up, the end stops ----------

export interface Cut {
  cur: ResolvedClip | null;
  sel: string | null;
  select: (id: string | null) => void;
  /** Scrubbing: jump into a clip at `ms`; playback (if running) continues from there. */
  seek: (id: string, ms: number) => void;
  step: (d: number) => void;
  toggle: () => void;
  playing: boolean;
  elapsed: number;
  playheadMs: number;
}

export function useCut(clips: ResolvedClip[]): Cut {
  const [sel, setSel] = useState<string | null>(clips[0]?.clip.id ?? null);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0); // within the selected clip
  const selIdx = clips.findIndex((c) => c.clip.id === sel);
  const cur = selIdx >= 0 ? clips[selIdx] : clips[0] ?? null;
  useEffect(() => { if (cur && cur.clip.id !== sel) setSel(cur.clip.id); }, [cur?.clip.id]);
  useEffect(() => {
    if (!playing || !cur) return;
    const id = setInterval(() => setElapsed((e) => e + 100), 100);
    return () => clearInterval(id);
  }, [playing, cur?.clip.id]);
  useEffect(() => {
    if (!playing || !cur) return;
    if (elapsed >= cur.clip.duration_ms) {
      const next = clips[clips.indexOf(cur) + 1];
      if (next) { setSel(next.clip.id); setElapsed(0); } else { setPlaying(false); setElapsed(cur.clip.duration_ms); }
    }
  }, [elapsed]);
  const select = (id: string | null) => { setSel(id); setElapsed(0); };
  const seek = (id: string, ms: number) => { setSel(id); setElapsed(Math.max(0, ms)); };
  const step = (d: number) => { if (!cur) return; const n = clips[Math.max(0, Math.min(clips.length - 1, clips.indexOf(cur) + d))]; if (n) select(n.clip.id); };
  const toggle = () => { if (!cur) return; if (!playing && cur === clips.at(-1) && elapsed >= cur.clip.duration_ms) { select(clips[0].clip.id); } setPlaying(!playing); };
  const playheadMs = cur ? cur.startMs + Math.min(elapsed, cur.clip.duration_ms) : 0;
  return { cur, sel, select, seek, step, toggle, playing, elapsed, playheadMs };
}

/** A sketch clip on stage: its render on the white canvas, letterboxed like a photo. */
export function SketchView({ sketch }: { sketch: Sketch }) {
  return (
    <div class="tl-sketch-view" style={{ aspectRatio: String(sketch.aspect), width: `min(100%, calc(${STAGE_H} * ${sketch.aspect}))` }}>
      {sketch.render_url ? <img src={sketch.render_url} alt="" /> : <span class="meta"><Icon name="floor-plan" /> Empty sketch</span>}
    </div>
  );
}

/** The timeline's presentation lock: per clip, or one mode forced on every clip. */
export function LockSelect({ value, onChange }: { value: MaskMode | null; onChange: (m: MaskMode | null) => void }) {
  return (
    <Select label="Presentation" icon={value ? "lock-outline" : "lock-open-variant-outline"} width="190px"
      value={value ?? ""} onChange={(v) => onChange((v || null) as MaskMode | null)}
      options={[{ value: "", label: "Per clip" }, ...PRESENTATION_MODES.map((m) => ({ value: m, label: `Lock: ${frameModeLabel(m)}`, group: "Locked for all clips" }))]} />
  );
}

// ---------- Preview + transport ----------

/** The stage keeps one height whatever is on it (shot, placeholder, an inline editor): clips letterbox into it. */
export const STAGE_H = "var(--tl-stage-h)";

const STAGE_MIN = 200;
const loadStageH = (): number | null => { try { const v = Number(localStorage.getItem("timelineStageH")); return v >= STAGE_MIN ? v : null; } catch { return null; } };

/**
 * The stage height: the default fills the window (`--tl-stage-h` in CSS); dragging the grip under
 * the stage sets a height of its own, remembered per browser; double-click goes back to the default.
 */
function useStageHeight() {
  const [px, setPx] = useState<number | null>(loadStageH);
  const drag = useRef<{ y: number; h: number } | null>(null);
  const save = (v: number | null) => { try { if (v === null) localStorage.removeItem("timelineStageH"); else localStorage.setItem("timelineStageH", String(v)); } catch { /* a preference */ } };
  const grip = (
    <div class="tl-stage__grip" role="separator" aria-orientation="horizontal" aria-label="Resize the stage" title="Drag to resize the stage · double-click resets"
      onPointerDown={(e) => { const stage = (e.currentTarget as HTMLElement).previousElementSibling as HTMLElement | null; drag.current = { y: e.clientY, h: stage?.getBoundingClientRect().height ?? 400 }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); e.preventDefault(); }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        // Clamped to the window the timeline lives in (the desktop), else the browser window.
        const room = (e.currentTarget as HTMLElement).closest(".wm-window__content")?.clientHeight ?? window.innerHeight;
        setPx(Math.round(Math.max(STAGE_MIN, Math.min(room - 160, d.h + e.clientY - d.y))));
      }}
      onPointerUp={() => { if (drag.current) { drag.current = null; setPx((v) => { save(v); return v; }); } }}
      onPointerCancel={() => { drag.current = null; }}
      onDblClick={() => { setPx(null); save(null); }}><span /></div>
  );
  return { style: px !== null ? { "--tl-stage-h": `${px}px` } : undefined, grip };
}

export function CutPreview({ cut, clips, total, lock, stage, editing, children }: { cut: Cut; clips: ResolvedClip[]; total: number; lock?: MaskMode | null; /** Replaces the clip on stage (an inline editor). */ stage?: ComponentChildren; editing?: boolean; children?: ComponentChildren }) {
  const { cur } = cut;
  const height = useStageHeight();
  return (
    <div class="tl-preview" style={height.style as JSX.CSSProperties | undefined}>
      <div class={cx("tl-stage", editing && "tl-stage--edit")}>
        {stage ?? (!cur ? <div class="tl-preview__empty"><Icon name="filmstrip" /><span>Add shots to start the cut</span></div>
          : cur.kind === "photo" ? <Framed photo={cur.photo} mode={lock ?? cur.pres.mode} frame={presentationFrame(cur.photo, cur.pres)} src={cur.overlay?.render_url ?? undefined} maxHeight={STAGE_H} />
          : cur.kind === "sketch" ? <SketchView sketch={cur.sketch} />
          : (
            <div class="tl-ph-view">
              <Icon name="image-off-outline" />
              <strong>{cur.clip.title}</strong>
              {cur.clip.notes && <span class="tl-ph-view__notes">{cur.clip.notes}</span>}
              <span class="meta" style={{ color: "inherit" }}>Placeholder · drop a shot here when you have it</span>
            </div>
          ))}
      </div>
      {height.grip}
      <div class="tl-transport">
        <IconButton kind="secondary" icon="skip-previous" label="First clip (Home)" disabled={!cur} onClick={() => clips[0] && cut.select(clips[0].clip.id)} />
        <IconButton kind="secondary" icon="chevron-left" label="Previous clip (←)" disabled={!cur || clips.indexOf(cur) === 0} onClick={() => cut.step(-1)} />
        <Button icon={cut.playing ? "pause" : "play"} kbd="Space" disabled={!cur} onClick={cut.toggle} style={{ minWidth: "110px" }}>{cut.playing ? "Pause" : "Play"}</Button>
        <IconButton kind="secondary" icon="chevron-right" label="Next clip (→)" disabled={!cur || clips.indexOf(cur) === clips.length - 1} onClick={() => cut.step(1)} />
        <IconButton kind="secondary" icon="skip-next" label="Last clip (End)" disabled={!cur} onClick={() => clips.at(-1) && cut.select(clips.at(-1)!.clip.id)} />
        <span class="num tl-clock"><strong>{clock(cut.playheadMs)}</strong> / {clock(total)}</span>
        {cur && <span class="meta num">clip {clips.indexOf(cur) + 1} of {clips.length} · {secs(cur.clip.duration_ms)}</span>}
        <span class="grow" />
        {children}
      </div>
    </div>
  );
}

// ---------- The strip: proportional blocks, drag to reorder, drop shots in (issue #31) ----------

const SHOT_TYPE = "application/x-openclapper-shot";
const CLIP_TYPE = "application/x-openclapper-clip";
/** Mark a shot card as a drag source for the strip. */
export function shotDrag(shotId: string) {
  return { draggable: true, onDragStart: (e: DragEvent) => { e.dataTransfer?.setData(SHOT_TYPE, shotId); if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy"; } };
}
/** Where a drag over the strip would land: between clips, or filling a placeholder. */
type DropAt = { index: number } | { fill: string };

export interface StripProps {
  clips: ResolvedClip[];
  cut: Cut;
  stripRef: RefObject<HTMLDivElement>;
  lock?: MaskMode | null;
  /** The clip edited inline, marked in the strip. */
  editingId?: string | null;
  onOpen: (c: ResolvedClip) => void;
  onReorder: (clipId: string, index: number) => void;
  /** A shot dropped from the browser; absent = the strip accepts no shots (no browser beside it). */
  onDropShot?: (shotId: string, at: DropAt) => void;
  onContext?: (c: ResolvedClip, e: MouseEvent) => void;
}

export function Strip({ clips, cut, stripRef, lock, editingId, onOpen, onReorder, onDropShot, onContext }: StripProps) {
  const { sel } = cut;
  const [drop, setDrop] = useState<DropAt | null>(null);
  const [zoom, setZoomState] = useState(() => stored("timelineZoom", ZOOM));
  const [thumbH, setThumbH] = useState(() => stored("timelineStripH", THUMB));
  const setZoom = (z: number) => { const v = Math.round(Math.max(ZOOM.min, Math.min(ZOOM.max, z)) * 10) / 10; setZoomState(v); store("timelineZoom", v); };
  useEffect(() => { stripRef.current?.querySelector(".is-sel")?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" }); }, [sel]);
  const total = clips.reduce((a, c) => a + c.clip.duration_ms, 0);
  // Zoomed out, short clips may shrink further so the strip stays proportional.
  const minPx = Math.max(20, Math.min(64, zoom * 1.5));
  const widthPx = (ms: number) => Math.max(minPx, (ms / 1000) * zoom);
  const totalPx = clips.reduce((a, c) => a + widthPx(c.clip.duration_ms) + CLIP_GAP, 0);
  /** Where a moment of the cut sits on the strip (clips have a minimum width and gaps, so it is per clip). */
  const xOf = (ms: number) => {
    let x = 0;
    for (const c of clips) {
      const w = widthPx(c.clip.duration_ms);
      if (ms < c.startMs + c.clip.duration_ms) return x + w * Math.max(0, (ms - c.startMs) / c.clip.duration_ms);
      x += w + CLIP_GAP;
    }
    return Math.max(0, x - CLIP_GAP);
  };
  // Tick spacing that keeps labels apart at every zoom.
  const step = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find((s) => s * zoom >= 60) ?? 600;
  const ticks = Array.from({ length: Math.floor(total / 1000 / step) + 1 }, (_, i) => i * step * 1000);

  // Ctrl/⌘ + wheel zooms around the pointer (non-passive, so the page does not zoom instead).
  const zoomRef = useRef(zoom); zoomRef.current = zoom;
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const on = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const z = zoomRef.current;
      const next = Math.max(ZOOM.min, Math.min(ZOOM.max, z * Math.exp(-e.deltaY * 0.0015)));
      const px = e.clientX - el.getBoundingClientRect().left;
      const anchor = el.scrollLeft + px;
      setZoom(next);
      requestAnimationFrame(() => { el.scrollLeft = anchor * (next / z) - px; });
    };
    el.addEventListener("wheel", on, { passive: false });
    return () => el.removeEventListener("wheel", on);
  }, [stripRef.current]);
  const fit = () => { const w = (stripRef.current?.clientWidth ?? 800) - 24; if (total > 0) setZoom((w - clips.length * CLIP_GAP) / (total / 1000)); };

  // Strip height: the grip under it sets the thumbnail height.
  const hDrag = useRef<{ y: number; h: number } | null>(null);
  const heightGrip = (
    <div class="tl-stage__grip tl-strip__grip" role="separator" aria-orientation="horizontal" aria-label="Resize the strip" title="Drag to resize the strip · double-click resets"
      onPointerDown={(e) => { hDrag.current = { y: e.clientY, h: thumbH }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); e.preventDefault(); }}
      onPointerMove={(e) => { const d = hDrag.current; if (d) setThumbH(Math.round(Math.max(THUMB.min, Math.min(THUMB.max, d.h + e.clientY - d.y)))); }}
      onPointerUp={() => { if (hDrag.current) { hDrag.current = null; setThumbH((v) => { store("timelineStripH", v); return v; }); } }}
      onPointerCancel={() => { hDrag.current = null; }}
      onDblClick={() => { setThumbH(THUMB.def); store("timelineStripH", THUMB.def); }}><span /></div>
  );

  const kinds = (e: DragEvent) => {
    const t = e.dataTransfer?.types ?? [];
    return { shot: !!onDropShot && t.includes(SHOT_TYPE), clip: t.includes(CLIP_TYPE) };
  };
  /** Insertion index from the pointer; a shot over a placeholder fills it instead. */
  function target(e: DragEvent, allowFill: boolean): DropAt {
    const els = [...(stripRef.current?.querySelectorAll<HTMLElement>(".tl-clip") ?? [])];
    if (allowFill) {
      const over = (e.target as HTMLElement | null)?.closest<HTMLElement>(".tl-clip");
      if (over?.dataset.ph) return { fill: over.dataset.ph };
    }
    let index = els.length;
    for (let i = 0; i < els.length; i++) { const r = els[i].getBoundingClientRect(); if (e.clientX < r.left + r.width / 2) { index = i; break; } }
    // Never into a sequence block: the drop moves to its nearer edge.
    return { index: snapIndex(clips.map((c) => c.clip), index) };
  }
  const onDragOver = (e: DragEvent) => {
    const k = kinds(e);
    if (!k.shot && !k.clip) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = k.clip ? "move" : "copy";
    const at = target(e, k.shot);
    setDrop((cur) => (JSON.stringify(cur) === JSON.stringify(at) ? cur : at));
  };
  const onDrop = (e: DragEvent) => {
    const k = kinds(e);
    setDrop(null);
    if (!k.shot && !k.clip) return;
    e.preventDefault();
    const at = target(e, k.shot);
    const clipId = e.dataTransfer?.getData(CLIP_TYPE);
    if (k.clip && clipId) { if ("index" in at) onReorder(clipId, at.index); return; }
    const shotId = e.dataTransfer?.getData(SHOT_TYPE);
    if (shotId && onDropShot) onDropShot(shotId, at);
  };
  const dropX = drop && "index" in drop ? clips.slice(0, drop.index).reduce((a, c) => a + widthPx(c.clip.duration_ms) + CLIP_GAP, 0) : null;

  // Scrubbing: drag along the ruler; the preview follows (playback, if running, continues from there).
  const scrubbing = useRef(false);
  function seekFromX(clientX: number) {
    const els = [...(stripRef.current?.querySelectorAll<HTMLElement>(".tl-clip") ?? [])];
    for (let i = 0; i < els.length && i < clips.length; i++) {
      const r = els[i].getBoundingClientRect();
      if (clientX < r.right || i === els.length - 1) {
        const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
        cut.seek(clips[i].clip.id, Math.min(Math.round(f * clips[i].clip.duration_ms), clips[i].clip.duration_ms - 1));
        return;
      }
    }
  }
  const scrubDown = (e: PointerEvent) => { if (clips.length === 0) return; e.preventDefault(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); scrubbing.current = true; seekFromX(e.clientX); };
  const scrubMove = (e: PointerEvent) => { if (scrubbing.current) seekFromX(e.clientX); };
  const scrubUp = () => { scrubbing.current = false; };
  const scrub = { onPointerDown: scrubDown, onPointerMove: scrubMove, onPointerUp: scrubUp, onPointerCancel: scrubUp };
  const headX = cut.cur ? xOf(cut.playheadMs) : null;
  // Sequence blocks (issue #37): one band over each block's clips.
  const blocks = clips.flatMap((c) => {
    if (c.kind !== "photo" || !c.seq || c.seq.i !== 0) return [];
    const members = clips.slice(clips.indexOf(c), clips.indexOf(c) + c.seq.n);
    const ms = members.reduce((a, m) => a + m.clip.duration_ms, 0);
    const w = members.reduce((a, m) => a + widthPx(m.clip.duration_ms) + CLIP_GAP, 0) - CLIP_GAP;
    return [{ c, x: xOf(c.startMs), w, ms, sel: members.some((m) => m.clip.id === sel) }];
  });

  return (
    <div class="tl-strip-box">
    <div class="tl-strip-bar">
      <span class="meta">Zoom</span>
      <IconButton icon="magnify-minus-outline" label="Zoom out" title="Zoom out (Ctrl/⌘ + scroll)" disabled={zoom <= ZOOM.min} onClick={() => setZoom(zoom / 1.5)} />
      <input type="range" class="tl-zoom" min={Math.log(ZOOM.min)} max={Math.log(ZOOM.max)} step={0.01} value={Math.log(zoom)} aria-label="Zoom" onInput={(e) => setZoom(Math.exp(Number((e.target as HTMLInputElement).value)))} onDblClick={() => setZoom(ZOOM.def)} />
      <IconButton icon="magnify-plus-outline" label="Zoom in" title="Zoom in (Ctrl/⌘ + scroll)" disabled={zoom >= ZOOM.max} onClick={() => setZoom(zoom * 1.5)} />
      <Button kind="ghost" size="sm" icon="arrow-expand-horizontal" title="Fit the whole cut into the width" disabled={!total} onClick={fit}>Fit</Button>
      <span class="meta num">{zoom >= 10 ? `${Math.round(zoom)} px/s` : `${zoom.toFixed(1)} px/s`}</span>
    </div>
    <div class="tl-strip-wrap" ref={stripRef} style={{ "--tl-thumb-h": `${thumbH}px` } as JSX.CSSProperties} onDragOver={onDragOver} onDrop={onDrop} onDragLeave={(e) => { if (!stripRef.current?.contains(e.relatedTarget as Node)) setDrop(null); }}>
      {clips.length === 0 ? (
        <div class={cx("tl-empty", drop && "is-drop")}>
          <span class="meta">No clips yet. {onDropShot ? "Drag shots here, or add them from the panel." : "Add shots from the panel."} A sequence comes in as one block, a clip per photo.</span>
        </div>
      ) : (
        <div class="tl-strip" style={{ width: `${totalPx}px` }} role="listbox" aria-label="Clips">
          <div class="tl-ruler" title="Drag to scrub" {...scrub}>{ticks.map((ms) => <span key={ms} style={{ left: `${xOf(ms)}px` }}>{clock(ms).replace(/\.0$/, "")}</span>)}</div>
          {headX !== null && (
            <div class="tl-playhead" style={{ left: `${headX}px` }}>
              <div class="tl-playhead__knob" title="Drag to scrub" {...scrub} />
            </div>
          )}
          {blocks.length > 0 && (
            <div class="tl-seqs">
              {blocks.map(({ c, x, w, ms, sel: on }) => c.kind === "photo" && (
                <div key={c.clip.id} class={cx("tl-seq", on && "is-sel")} style={{ left: `${x}px`, width: `${w}px` }}
                  title={`Sequence · ${shotTitle(c.shot)} · ${c.seq!.n} photos · ${secs(ms)}${c.group?.mode === "total" ? ` total, split ${c.group.split === "edges" ? "with longer edges" : "evenly"}` : " (per photo)"} · drag to move the block`}
                  draggable onDragStart={(e) => { e.dataTransfer?.setData(CLIP_TYPE, c.clip.id); if (e.dataTransfer) e.dataTransfer.effectAllowed = "move"; }}
                  onClick={() => cut.select(c.clip.id)} onDblClick={() => onOpen(c)}
                  onContextMenu={onContext && ((e) => { e.preventDefault(); cut.select(c.clip.id); onContext(c, e); })}>
                  <Icon name={c.group?.mode === "total" ? "timer-outline" : "layers-triple-outline"} size={13} />
                  <span class="ellipsis">SEQ · {c.seq!.n} · {shotTitle(c.shot)}</span>
                  <span class="tl-seq__len num">{secs(ms)}</span>
                </div>
              ))}
            </div>
          )}
          <div class="tl-clips">
            {dropX !== null && <span class="tl-dropline" style={{ left: `${dropX - 2}px` }} />}
            {clips.map((c) => (
              <button key={c.clip.id} type="button" role="option" aria-selected={c.clip.id === sel} data-ph={c.kind !== "photo" ? c.clip.id : undefined}
                class={cx("tl-clip", c.kind !== "photo" && "tl-clip--ph", c.kind === "photo" && c.seq && "tl-clip--seq", c.kind === "sketch" && "tl-clip--sk", c.clip.id === sel && "is-sel", c.clip.id === editingId && "is-editing", drop && "fill" in drop && drop.fill === c.clip.id && "is-fill")}
                style={{ width: `${widthPx(c.clip.duration_ms)}px` }}
                title={`${clipLabel(c)}${c.kind === "photo" && c.overlay ? ` · ${c.overlay.name}` : ""} · ${secs(c.clip.duration_ms)}`}
                draggable onDragStart={(e) => { e.dataTransfer?.setData(CLIP_TYPE, c.clip.id); if (e.dataTransfer) e.dataTransfer.effectAllowed = "move"; }}
                onClick={() => cut.select(c.clip.id)} onDblClick={() => onOpen(c)}
                onContextMenu={onContext && ((e) => { e.preventDefault(); cut.select(c.clip.id); onContext(c, e); })}>
                {c.kind === "photo"
                  ? <div class="tl-clip__thumb"><Framed photo={c.photo} mode={(lock ?? c.pres.mode) === "off" ? "off" : "fit"} frame={presentationFrame(c.photo, c.pres)} src={c.overlay?.render_url ?? undefined} /><span class="tl-clip__state"><StateMarker state={c.shot.state} iconOnly /></span></div>
                  : c.kind === "sketch" ? <div class="tl-clip__thumb tl-clip__thumb--sk">{c.sketch.render_url ? <img src={c.sketch.render_url} alt="" /> : <Icon name="floor-plan" />}</div>
                  : <div class="tl-clip__thumb tl-clip__thumb--ph"><Icon name="image-off-outline" /></div>}
                <span class="tl-clip__name ellipsis">{c.kind === "photo" && c.overlay ? <Icon name="layers-outline" size={12} /> : null}{c.kind === "photo" && c.seq ? `${c.photo.ordinal + 1} / ${c.shot.photos.length}` : clipLabel(c)}{c.kind === "photo" && !c.seq && c.shot.photos.length > 1 ? ` · ${c.photo.ordinal + 1}` : ""}</span>
                <span class="tl-clip__dur num">{secs(c.clip.duration_ms)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
    {clips.length > 0 && heightGrip}
    </div>
  );
}

// ---------- Clip panel: hold time, presentation, notes — or the placeholder's title ----------

export interface ClipPanelProps {
  c: ResolvedClip;
  count: number;
  /** The timeline's locked mode: the clip's presentation controls are inert then. */
  lock?: MaskMode | null;
  durRef: RefObject<HTMLInputElement>;
  onUpdate: (p: Partial<TimelineClip>) => void;
  onMove: (d: number) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onOpen: () => void;
  /** Inline editing (issue #31): re-frame the clip, draw its overlay, draw a sketch for a placeholder or a sketch clip. */
  onReframe?: () => void;
  onOverlay?: () => void;
  onSketch?: () => void;
  /** A photo clip that replaced a sketch clip still owns that sketch: attach it to the clip's shot. */
  onAttachSketch?: () => void;
  /** Approve / archive the clip's shot from the timeline (issue #35). */
  onState?: (to: ShotState) => void;
  /** Its sequence block (issue #37): new settings, Ungroup, bring removed photos back. */
  onGroup?: (g: ClipGroup) => void;
  onUngroup?: () => void;
  onRestore?: () => void;
  head?: ComponentChildren;
}

/** Seconds with one decimal, ±0.5 s buttons; commits on Enter or leaving, Esc reverts. */
function SecondsField({ label, ms, max, onCommit, disabled, inputRef, kbd, help }: { label: string; ms: number; max: number; onCommit: (ms: number) => void; disabled?: boolean; inputRef?: RefObject<HTMLInputElement>; kbd?: string; help?: ComponentChildren }) {
  const fmt = (v: number) => (v / 1000).toFixed(1);
  const [text, setText] = useState(fmt(ms));
  useEffect(() => setText(fmt(ms)), [ms]);
  const clamp = (v: number) => Math.max(STEP_MS / 5, Math.min(max, v));
  const commit = (v: string) => { const n = Math.round(parseFloat(v.replace(",", ".")) * 10) * 100; if (Number.isFinite(n) && n >= 100 && n <= max) onCommit(n); else setText(fmt(ms)); };
  return (
    <Field label={label} as="div">
      <div class="btn-row" style={{ flexWrap: "nowrap", gap: "4px" }}>
        <IconButton kind="secondary" icon="minus" label="Shorter by 0.5 s" disabled={disabled} onClick={() => onCommit(clamp(ms - STEP_MS))} />
        <Input inputRef={inputRef} sm class="num" style={{ width: "72px", textAlign: "right", fontWeight: 700 }} value={text} unit="s" inputMode="decimal" aria-label={`${label} in seconds`} disabled={disabled}
          onInput={(e) => setText((e.target as HTMLInputElement).value)} onBlur={() => commit(text)}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setText(fmt(ms)); (e.target as HTMLInputElement).blur(); } }} />
        <IconButton kind="secondary" icon="plus" label="Longer by 0.5 s" disabled={disabled} onClick={() => onCommit(clamp(ms + STEP_MS))} />
        {kbd && <span class="meta"><Kbd>{kbd}</Kbd></span>}
      </div>
      {help && <span class="f-field__help">{help}</span>}
    </Field>
  );
}

/** A sequence block's settings in the clip panel: how its length is made, Restore and Ungroup. */
function SequenceSection({ c, onGroup, onUngroup, onRestore }: { c: Extract<ResolvedClip, { kind: "photo" }>; onGroup: (g: ClipGroup) => void; onUngroup?: () => void; onRestore?: () => void }) {
  const g = c.group!, seq = c.seq!;
  const missing = c.shot.photos.length - seq.n;
  const [weight, setWeight] = useState(g.edge_weight);
  useEffect(() => setWeight(g.edge_weight), [g.edge_weight]);
  return (
    <div class="tl-seqbox" role="group" aria-label="Sequence">
      <div class="tl-seqbox__head"><SeqBadge count={c.shot.photos.length} small /><span class="meta">Photo {seq.i + 1} of {seq.n} in this block{missing > 0 ? ` · ${missing} removed` : ""}</span></div>
      <Field label="Length" as="div">
        <Seg label="How the block's length is made" value={g.mode} onChange={(mode) => onGroup({ ...g, mode })}
          options={[{ id: "each", label: "Per photo" }, { id: "total", label: "Total" }]} />
        <span class="f-field__help">{g.mode === "each" ? "Each photo has its own hold time; the block is their sum." : "One length for the block, split across its photos."}</span>
      </Field>
      {g.mode === "total" && (
        <>
          <SecondsField label="Total" ms={g.total_ms} max={GROUP_MAX_MS} onCommit={(ms) => onGroup({ ...g, total_ms: Math.max(ms, seq.n * 100) })} />
          <Field label="Split" as="div">
            <Seg label="Split" value={g.split} onChange={(split) => onGroup({ ...g, split })} options={[{ id: "even", label: "Even" }, { id: "edges", label: "Edges" }]} />
          </Field>
          {g.split === "edges" && (
            <Field label={`Edge weight · ${weight.toFixed(1)}×`} as="div">
              <input type="range" class="tl-zoom" style={{ width: "100%" }} min={EDGE_WEIGHT.min} max={EDGE_WEIGHT.max} step={0.1} value={weight} aria-label="Edge weight"
                onInput={(e) => setWeight(Number((e.target as HTMLInputElement).value))} onChange={(e) => onGroup({ ...g, edge_weight: Number((e.target as HTMLInputElement).value) })}
                onDblClick={() => onGroup({ ...g, edge_weight: EDGE_WEIGHT.def })} />
              <span class="f-field__help">The first and last photo get {weight.toFixed(1)} shares, the others one (double-click: {EDGE_WEIGHT.def}×).</span>
            </Field>
          )}
        </>
      )}
      <div class="btn-row" style={{ gap: "6px" }}>
        {missing > 0 && onRestore && <Button kind="secondary" size="sm" icon="restore" onClick={onRestore}>Restore all photos</Button>}
        {onUngroup && <Button kind="ghost" size="sm" icon="link-variant-off" title="Make the block's clips loose clips; each keeps its hold time" onClick={onUngroup}>Ungroup</Button>}
      </div>
    </div>
  );
}

export function ClipPanel({ c, count, lock, durRef, onUpdate, onMove, onRemove, onDuplicate, onOpen, onReframe, onOverlay, onSketch, onAttachSketch, onState, onGroup, onUngroup, onRestore, head }: ClipPanelProps) {
  const i = c.index;
  const seq = c.kind === "photo" ? c.seq : null;
  const inTotal = c.kind === "photo" && c.group?.mode === "total";
  const settings = useSettings();
  const holdTime = (
    <SecondsField label="Hold time" ms={c.clip.duration_ms} max={CLIP_MAX_MS} inputRef={durRef} kbd="D" disabled={inTotal}
      onCommit={(ms) => onUpdate({ duration_ms: ms })} help={inTotal ? "Set by the block's total and split." : undefined} />
  );
  const notes = <Field label="Notes"><textarea class="f-textarea" rows={3} placeholder={c.kind === "photo" ? "Why this shot here, what it needs…" : "What the wanted shot looks like…"} value={c.clip.notes ?? ""} onInput={(e) => onUpdate({ notes: (e.target as HTMLTextAreaElement).value || null })} /></Field>;
  const foot = (extra?: ComponentChildren) => (
    <div class="btn-row" style={{ gap: "6px" }}>
      <IconButton kind="secondary" icon="arrow-left" label="Move earlier (Alt+←)" title="Move earlier (Alt+←)" disabled={i - (seq?.i ?? 0) === 0} onClick={() => onMove(-1)} />
      <IconButton kind="secondary" icon="arrow-right" label="Move later (Alt+→)" title="Move later (Alt+→)" disabled={i + (seq ? seq.n - seq.i - 1 : 0) >= count - 1} onClick={() => onMove(1)} />
      <Button kind="secondary" size="sm" icon="content-duplicate" onClick={onDuplicate}>{seq ? "Duplicate block" : "Duplicate"}</Button>
      {extra}
      <span class="grow" />
      <Button kind="danger" size="sm" icon="delete-outline" kbd="Del" onClick={onRemove}>{seq ? (settings.seqRemove === "block" ? "Remove sequence" : "Remove photo") : "Remove"}</Button>
    </div>
  );
  const headMeta = head ?? <span class="meta num">clip {i + 1} of {count}</span>;

  if (c.kind !== "photo") {
    const sketch = c.kind === "sketch" ? c.sketch : null;
    return (
      <Panel label={sketch ? "Sketch clip" : "Placeholder"} width="340px" resize={DRAWER_RESIZE}>
        <PanelHead title={sketch ? "Sketch clip" : "Placeholder"}>{headMeta}</PanelHead>
        <PanelBody>
          {sketch ? (
            <div class="tl-sketch-thumb">{sketch.render_url ? <img src={sketch.render_url} alt="" /> : <Icon name="floor-plan" />}</div>
          ) : <span class="meta">Holds this spot in the cut. Drop a shot from the panel onto it to fill it; the hold time is kept.</span>}
          <Field label="Wanted shot"><Input value={c.clip.title ?? ""} maxLength={120} placeholder="e.g. Wide dusk establisher" onInput={(e) => onUpdate({ title: (e.target as HTMLInputElement).value || "Placeholder" })} /></Field>
          {onSketch && (
            <div class="btn-row">
              <Button kind={sketch ? "secondary" : "primary"} size="sm" icon="draw" kbd="C" onClick={onSketch}>{sketch ? "Edit the sketch" : "Sketch it"}</Button>
              {sketch && !sketch.clip_id && <span class="meta">A shot's sketch: editing makes a copy for this clip.</span>}
            </div>
          )}
          {sketch && <span class="meta">Dropping a shot here replaces the sketch on stage; the clip keeps the sketch, so you can attach it to that shot.</span>}
          {holdTime}
          {notes}
          {foot()}
        </PanelBody>
      </Panel>
    );
  }

  const pres = c.pres;
  const overlays = c.shot.overlays.filter((o) => o.photo_id === c.photo.id);
  const all = [...c.ownOverlays, ...overlays];
  const pickOverlay = (id: string) => {
    const o = all.find((x) => x.id === id) ?? null;
    // An overlay brings the presentation it was drawn in; "Photo" keeps the current one. A clip's own overlay keeps the clip's.
    onUpdate(o ? (o.clip_id ? { overlay_id: o.id } : { overlay_id: o.id, presentation: o.presentation }) : { overlay_id: null });
  };
  const ownFrame = ownReframe(pres);
  return (
    <Panel label="Clip" width="340px" resize={DRAWER_RESIZE}>
      <PanelHead title={shotTitle(c.shot)}>{headMeta}</PanelHead>
      <PanelBody>
        <div class="f-row__thumb" style={{ width: "100%" }}><Framed photo={c.photo} mode={lock ?? pres.mode} frame={presentationFrame(c.photo, pres)} src={c.overlay?.render_url ?? undefined} /></div>
        {c.shot.photos.length > 1 && <span class="meta">Photo {c.photo.ordinal + 1} of {c.shot.photos.length} in this sequence</span>}
        {onState && (
          <div class="tl-decide">
            <StateMarker state={c.shot.state} />
            <span class="grow" />
            {DECISIONS.filter((d) => d.to !== c.shot.state).map((d) => <Button key={d.to} kind={d.to === "approved" ? "approve" : "archive"} size="sm" icon={d.icon} onClick={() => onState(d.to)}>{d.label}</Button>)}
          </div>
        )}
        {(onReframe || onOverlay) && (
          <div class="tl-tools" role="group" aria-label="Clip tools">
            {onReframe && c.photo.source === "camera" && <Button kind="secondary" size="sm" icon="crop" kbd="R" onClick={onReframe}>Re-frame</Button>}
            {onOverlay && <Button kind="secondary" size="sm" icon="layers-outline" kbd="C" onClick={onOverlay}>{c.overlay?.clip_id ? "Edit overlay" : c.overlay ? "Overlay (copy)" : "Overlay"}</Button>}
          </div>
        )}
        {c.group && seq && onGroup && <SequenceSection c={c} onGroup={onGroup} onUngroup={onUngroup} onRestore={onRestore} />}
        {holdTime}
        <Field label="Show as" as="div">
          <Select label="Show as" width="100%" value={c.clip.overlay_id ?? ""} onChange={pickOverlay}
            options={[{ value: "", label: "Photo as is" }, ...c.ownOverlays.map((o) => ({ value: o.id, label: o.name, group: "This clip" })), ...overlays.map((o) => ({ value: o.id, label: o.name, group: "The shot's overlays" }))]} />
        </Field>
        <Field label="Presentation" as="div">
          {lock ? (
            <span class="f-field__help"><Icon name="lock-outline" size={14} /> Locked to <strong>{frameModeLabel(lock)}</strong> for the whole timeline. Unlock it in the head to set this clip's own presentation again.</span>
          ) : (
            <>
              <Seg label="Frame mode" value={pres.mode} onChange={(m) => onUpdate({ presentation: { ...pres, mode: m } })} options={PRESENTATION_MODES.map((m) => ({ id: m, label: frameModeLabel(m) }))} />
              {c.photo.source === "camera" && <div style={{ marginTop: "6px" }}><FramingSelect photo={c.photo} value={pres} onChange={(patch) => onUpdate({ presentation: { ...pres, ...patch } })} /></div>}
            </>
          )}
          <span class="f-field__help">{ownFrame ? <><Icon name="crop" size={14} /> This clip's own re-frame · {pres.label}</> : pres.label ?? "As shot"}</span>
        </Field>
        {c.ownSketch && onAttachSketch && (
          <div class="tl-kept">
            <div class="tl-sketch-thumb tl-sketch-thumb--sm">{c.ownSketch.render_url ? <img src={c.ownSketch.render_url} alt="" /> : <Icon name="floor-plan" />}</div>
            <div class="tl-kept__txt"><strong>{c.ownSketch.name}</strong><span class="meta">The sketch this spot had before the shot.</span></div>
            <Button kind="secondary" size="sm" icon="link-variant" onClick={onAttachSketch}>Attach to shot</Button>
          </div>
        )}
        {notes}
        {foot(<Button kind="secondary" size="sm" icon="image-outline" kbd="↵" onClick={onOpen}>Open shot</Button>)}
      </PanelBody>
    </Panel>
  );
}

// ---------- The project's timelines: a rail that collapses to win width (issue #31) ----------

const RAIL_VT = { viewTransitionName: "tl-rail" };
const loadRail = () => { try { return localStorage.getItem("timelineRail") === "collapsed"; } catch { return false; } };

export function TimelineRail({ list, selectedId, onSelect, onCreate, onContext }: { list: Timeline[] | null; selectedId: string | null; onSelect: (id: string) => void; onCreate: () => void; onContext?: (t: Timeline, e: MouseEvent) => void }) {
  const [collapsed, setCollapsed] = useState(loadRail);
  // The two rails are different trees, so a View Transition morphs one into the other (#169); only
  // the rail takes part (html.vt-part keeps the rest of the page out of it).
  const toggle = () => {
    const v = !collapsed;
    document.documentElement.classList.add("vt-part");
    void withViewTransition(() => setCollapsed(v)).then(() => document.documentElement.classList.remove("vt-part"));
    try { localStorage.setItem("timelineRail", v ? "collapsed" : "full"); } catch { /* a preference */ }
  };
  const total = (t: Timeline) => t.clips.reduce((a, c) => a + c.duration_ms, 0);
  if (collapsed) {
    return (
      <Panel left width="56px" label="Timelines" style={RAIL_VT}>
        <div class="tl-rail">
          <IconButton icon="chevron-double-right" label="Expand the timelines" title="Expand the timelines" onClick={toggle} />
          <IconButton icon="plus" label="New timeline (⇧N)" title="New timeline (⇧N)" onClick={onCreate} />
          <span class="tl-rail__sep" />
          {(list ?? []).map((t, i) => (
            <button key={t.id} type="button" class={cx("tl-rail__it", t.id === selectedId && "is-selected")} title={`${t.name} · ${t.clips.length} clips · ${clock(total(t))}`} aria-label={t.name} aria-pressed={t.id === selectedId}
              onClick={() => onSelect(t.id)} onContextMenu={onContext && ((e) => onContext(t, e))}>{i + 1}</button>
          ))}
        </div>
      </Panel>
    );
  }
  return (
    <Panel left width="240px" label="Timelines" style={RAIL_VT}>
      <PanelHead title="Timelines">
        <Button size="sm" icon="plus" title="New timeline (⇧N)" onClick={onCreate}>New</Button>
        <IconButton icon="chevron-double-left" label="Collapse the timelines" title="Collapse the timelines" onClick={toggle} />
      </PanelHead>
      <PanelBody flush role="listbox" aria-label="Timelines">
        {!list ? <div class="status"><Spinner /></div> : list.length === 0 ? <EmptyNote title="No timelines yet">“New” starts an empty cut.</EmptyNote> : list.map((t) => (
          <div key={t.id} role="option" aria-selected={t.id === selectedId} tabIndex={0} class={cx("f-dayitem", t.id === selectedId && "is-selected")}
            onClick={() => onSelect(t.id)} onKeyDown={(e) => { if (e.key === "Enter") onSelect(t.id); }} onContextMenu={onContext && ((e) => onContext(t, e))}>
            <span class="f-dayitem__date">{t.name}</span>
            <span class="f-dayitem__meta num">{t.clips.length} clip{t.clips.length === 1 ? "" : "s"} · {clock(total(t))}</span>
          </div>
        ))}
      </PanelBody>
    </Panel>
  );
}

// ---------- Deep link: the playhead and the inline tool in the URL (issue #35) ----------

/** Whether an inline tool applies to a clip (re-frame needs a camera photo, a sketch a spot without a photo). */
export const toolFits = (tool: EditKind, c: ResolvedClip) =>
  tool === "sketch" ? c.kind !== "photo" : c.kind === "photo" && (tool === "overlay" || c.photo.source === "camera");

/**
 * Restores the URL's cut position once on mount, then keeps it in the URL 300 ms after the playhead
 * or the tool settles. Playback ticks every 100 ms, so it writes when playback stops, not during it.
 */
export function useCutUrl(timelineId: string, clips: ResolvedClip[], cut: Cut, editing: EditKind | null, onEdit: (kind: EditKind, c: ResolvedClip) => void, at: CutPosition | null | undefined, write: (at: CutPosition) => void) {
  const restored = useRef(false);
  useEffect(() => {
    restored.current = true;
    if (!at || !clips.length) return;
    const c = clips.find((x) => at.ms < x.startMs + x.clip.duration_ms) ?? clips.at(-1)!;
    if (at.tool && toolFits(at.tool, c)) onEdit(at.tool, c);
    // After the edit's select (which rewinds to the clip's start), so the seek wins.
    cut.seek(c.clip.id, Math.min(at.ms - c.startMs, c.clip.duration_ms));
  }, []);
  const ms = cut.playheadMs;
  useEffect(() => {
    if (!restored.current) return;
    const id = setTimeout(() => write({ ms, tool: editing }), 300);
    return () => clearTimeout(id);
  }, [ms, editing]);
}
