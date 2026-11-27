// Editing a flow (docs/features/flows.md): the changes both editors make, as pure functions on the body, so the
// Studio's and the phone's editors follow the same rules. Ids come from the caller (each client has its own UUIDs).
import { fixtureKind, modelOf } from "@openclapper/ext-hardware";
import { sampleTrack, START_KEYFRAME, startKeyframe, TRACK_COLORS, type FlowMarker, type FlowTrack, type Keyframe } from "./flow.ts";
import type { FlowBody } from "./index.ts";

/** Times snap to whole seconds (#426): keyframes, markers, the length. Older sub-second times stay until moved. */
export const SNAP_MS = 1000;
export const snap = (ms: number) => Math.round(ms / SNAP_MS) * SNAP_MS;
/** A time in whole seconds; one that is not (kept from before #426) shows its tenths. */
export const fmtSeconds = (ms: number) => `${ms % 1000 === 0 ? ms / 1000 : (ms / 1000).toFixed(1)} s`;
/** The playhead's time: tenths, since it runs between the seconds while playing. */
export const fmtClock = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** The intensity snaps a drag offers (#426), in percent: a setting of the device's view, not a rule on stored values. */
export const LEVEL_STEPS = [1, 5, 10] as const;
export type LevelStep = (typeof LEVEL_STEPS)[number];

/**
 * An intensity dragged from `from` towards `to` (0..1), snapped to every `step` percent. From a level off that grid
 * (set exactly in the inspector) the first stop is the next grid line in the drag's direction, never one behind it:
 * from 3 % with steps of 5, up gives 5 and down 0.
 */
export function snapLevel(from: number, to: number, step: number): number {
  const f = from * 100, t = Math.min(100, Math.max(0, to * 100));
  let n = Math.round(t / step) * step;
  const off = Math.abs(f / step - Math.round(f / step)) > 1e-6;
  if (off && t > f) n = Math.max(n, Math.ceil(f / step) * step);
  if (off && t < f) n = Math.min(n, Math.floor(f / step) * step);
  return Math.min(100, Math.max(0, n)) / 100;
}

/** A new track for a light or camera model: named after it, a colour no track uses yet, its start keyframe. */
export function addTrack(b: FlowBody, modelId: string, id: string): FlowBody {
  const m = modelOf(modelId);
  if (!m) return b;
  const n = b.tracks.filter((t) => t.model === modelId).length + 1;
  const used = new Set(b.tracks.map((t) => t.color));
  const color = Array.from({ length: TRACK_COLORS }, (_, i) => i).find((i) => !used.has(i)) ?? b.tracks.length % TRACK_COLORS;
  return { ...b, tracks: [...b.tracks, { id, name: `${m.model} ${n}`, model: modelId, device: null, color, keyframes: [startKeyframe(fixtureKind(modelId))] }] };
}

export const patchTrack = (b: FlowBody, trackId: string, fn: (t: FlowTrack) => FlowTrack): FlowBody => ({ ...b, tracks: b.tracks.map((t) => (t.id === trackId ? fn(t) : t)) });
export const removeTrack = (b: FlowBody, trackId: string): FlowBody => ({ ...b, tracks: b.tracks.filter((t) => t.id !== trackId), markers: (b.markers ?? []).filter((m) => m.trackId !== trackId) });

/**
 * A keyframe at a time on a track (snapped; none when one is there already): a light's carries the intensity the
 * track has there, so adding one changes nothing until it is edited; a camera's sets nothing yet.
 */
export function addKeyframe(b: FlowBody, trackId: string, at: number, id: string): { body: FlowBody; keyframe: Keyframe | null } {
  const tr = b.tracks.find((t) => t.id === trackId);
  const t = Math.min(b.durationMs, Math.max(SNAP_MS, snap(at)));
  if (!tr || tr.keyframes.some((k) => k.at === t)) return { body: b, keyframe: null };
  const camera = modelOf(tr.model)?.type === "camera";
  const k: Keyframe = camera ? { id, at: t, controls: {} } : { id, at: t, intensity: sampleTrack(tr.keyframes, t).intensity ?? 0.5 };
  return { body: patchTrack(b, trackId, (x) => ({ ...x, keyframes: [...x.keyframes, k] })), keyframe: k };
}

/**
 * A keyframe replaced (the start keyframe stays at 0); a changed time snapped within the flow and kept off another's.
 * An unchanged time stays as stored, so editing a value never moves a keyframe set before whole seconds.
 */
export function setKeyframe(b: FlowBody, trackId: string, k: Keyframe): FlowBody {
  return patchTrack(b, trackId, (t) => {
    const was = t.keyframes.find((x) => x.id === k.id);
    const at = k.id === START_KEYFRAME ? 0 : was && was.at === k.at ? k.at : Math.min(b.durationMs, Math.max(SNAP_MS, snap(k.at)));
    if (t.keyframes.some((x) => x.id !== k.id && x.at === at)) return t;
    return { ...t, keyframes: t.keyframes.map((x) => (x.id === k.id ? { ...k, at } : x)) };
  });
}

/** Keyframes ("track/keyframe") and markers ("@m/id") removed; a start keyframe never is. */
export function removeKeys(b: FlowBody, keys: ReadonlySet<string>): FlowBody {
  return {
    ...b,
    markers: (b.markers ?? []).filter((m) => !keys.has(`@m/${m.id}`)),
    tracks: b.tracks.map((t) => ({ ...t, keyframes: t.keyframes.filter((k) => k.id === START_KEYFRAME || !keys.has(`${t.id}/${k.id}`)) })),
  };
}

/** A marker at a time (a range with `end`), across the flow or on one track; named in order. */
export function addMarker(b: FlowBody, at: number, id: string, opts: { end?: number; trackId?: string } = {}): { body: FlowBody; marker: FlowMarker } {
  const n = (b.markers ?? []).length + 1;
  const from = Math.min(b.durationMs, Math.max(0, snap(at)));
  const end = opts.end !== undefined && snap(opts.end) > from ? Math.min(b.durationMs, snap(opts.end)) : undefined;
  const m: FlowMarker = { id, at: from, name: end !== undefined ? `Section ${n}` : `Marker ${n}`, ...(end !== undefined ? { end } : {}), ...(opts.trackId ? { trackId: opts.trackId } : {}) };
  return { body: { ...b, markers: [...(b.markers ?? []), m] }, marker: m };
}
export const patchMarker = (b: FlowBody, id: string, fn: (m: FlowMarker) => FlowMarker): FlowBody => ({ ...b, markers: (b.markers ?? []).map((m) => (m.id === id ? fn(m) : m)) });

/** The flow's length changed: keyframes and markers past the end come in to it. */
export function setDuration(b: FlowBody, ms: number): FlowBody {
  const d = Math.max(1000, snap(ms));
  return {
    ...b, durationMs: d,
    tracks: b.tracks.map((t) => ({ ...t, keyframes: t.keyframes.filter((k) => k.at <= d) })),
    markers: (b.markers ?? []).filter((m) => m.at <= d).map((m) => (m.end !== undefined && m.end > d ? { ...m, end: d } : m)),
  };
}
