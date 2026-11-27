// Editing a flow (docs/features/flows.md): the changes both editors make, as pure functions on the body, so the
// Studio's and the phone's editors follow the same rules. Ids come from the caller (each client has its own UUIDs).
import { fixtureKind, modelOf } from "@openclapper/ext-hardware";
import { sampleTrack, START_KEYFRAME, startKeyframe, TRACK_COLORS, type FlowMarker, type FlowTrack, type Keyframe } from "./flow.ts";
import type { FlowBody } from "./index.ts";

/** Times snap to half seconds (#426): keyframes, markers, margins, the length. Older times off that grid stay until moved. */
export const SNAP_MS = 500;
export const snap = (ms: number) => Math.round(ms / SNAP_MS) * SNAP_MS;
/** A time in seconds: "12 s" on a whole second, else its tenths ("12.5 s"; older times off the grid "2.3 s"). */
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
  // Inside a neighbour's margin, it pushes like a moved one; where nothing can make room, none is added.
  const body = moveKeyframes(patchTrack(b, trackId, (x) => ({ ...x, keyframes: [...x.keyframes, k] })), [{ trackId, id, at: t }]);
  return body && body.tracks.find((x) => x.id === trackId)?.keyframes.find((x) => x.id === id)?.at === t ? { body, keyframe: k } : { body: b, keyframe: null };
}

/**
 * A keyframe replaced (the start keyframe stays at 0); a changed time snapped within the flow and kept off another's.
 * An unchanged time stays as stored, so editing a value never moves a keyframe set off the grid before #426.
 */
export function setKeyframe(b: FlowBody, trackId: string, k: Keyframe): FlowBody {
  const t = b.tracks.find((x) => x.id === trackId);
  const was = t?.keyframes.find((x) => x.id === k.id);
  if (!t || !was) return b;
  const at = k.id === START_KEYFRAME ? 0 : was.at === k.at ? k.at : Math.min(b.durationMs, Math.max(SNAP_MS, snap(k.at)));
  // Its values and margins first, where it was: a margin that pushes a neighbour off the flow is refused.
  const next: Keyframe = { ...k, at: was.at };
  for (const f of ["marginBeforeMs", "marginAfterMs"] as const) {
    const v = Math.min(b.durationMs, Math.max(0, snap(next[f] ?? 0)));
    if (v > 0 && !(f === "marginBeforeMs" && k.id === START_KEYFRAME)) next[f] = v; else delete next[f];
  }
  const placed = moveKeyframes(patchTrack(b, trackId, (x) => ({ ...x, keyframes: x.keyframes.map((y) => (y.id === k.id ? next : y)) })), [{ trackId, id: k.id, at: was.at }]);
  if (!placed) return b;
  return at === was.at ? placed : moveKeyframes(placed, [{ trackId, id: k.id, at }]) ?? placed;
}

/** A keyframe's margin on one side set (snapped; 0 removes it), pushing neighbours; refused when they cannot fit. */
export function setMargin(b: FlowBody, trackId: string, id: string, side: "before" | "after", ms: number): FlowBody {
  const k = b.tracks.find((x) => x.id === trackId)?.keyframes.find((x) => x.id === id);
  return k ? setKeyframe(b, trackId, { ...k, [side === "before" ? "marginBeforeMs" : "marginAfterMs"]: ms }) : b;
}

/** The least distance between two keyframes next to each other on a track: the larger of the margins facing each other. */
export const gapBetween = (a: Keyframe, b: Keyframe) => Math.max(a.marginAfterMs ?? 0, b.marginBeforeMs ?? 0);

/** A move asked for: a keyframe of a track to a time (snapped by the caller). */
export interface KeyframeMove { trackId: string; id: string; at: number }

/**
 * Keyframes moved, with their margins as "minimum gap, pushes" (#426): a neighbour that would come inside a margin
 * (the larger of the two facing each other) is pushed along, and the push goes on through the next keyframes; those
 * further away stay put. Two keyframes without a margin between them may pass each other but never share a time; a
 * pushed one keeps at least SNAP_MS from the one pushing it. Nothing is pushed off the flow or onto the start
 * keyframe, which never moves: when the moves do not fit, they are cut short a step (SNAP_MS) at a time (all together, so a
 * selection keeps its shape), down to none. Null only when not even that fits (the body was not valid before).
 */
export function moveKeyframes(b: FlowBody, moves: readonly KeyframeMove[]): FlowBody | null {
  const byTrack = new Map<string, Map<string, number>>();
  for (const m of moves) {
    const t = byTrack.get(m.trackId) ?? new Map<string, number>();
    // The start keyframe stays at 0; named here, its margin still pushes.
    t.set(m.id, m.id === START_KEYFRAME ? 0 : m.at);
    byTrack.set(m.trackId, t);
  }
  // The longest way any of them goes, in steps: cut short by one step after another until all tracks fit.
  let steps = 0;
  for (const [tid, ms] of byTrack) {
    const t = b.tracks.find((x) => x.id === tid);
    for (const [id, to] of ms) { const k = t?.keyframes.find((x) => x.id === id); if (k) steps = Math.max(steps, Math.ceil(Math.abs(to - k.at) / SNAP_MS)); }
  }
  for (let s = 0; s <= steps; s++) {
    const placed = new Map<string, Keyframe[]>();
    let fits = true;
    for (const [tid, ms] of byTrack) {
      const t = b.tracks.find((x) => x.id === tid);
      if (!t) continue;
      const cut = new Map([...ms].map(([id, to]) => {
        const from = t.keyframes.find((x) => x.id === id)?.at ?? to;
        const back = to > from ? Math.max(from, to - s * SNAP_MS) : Math.min(from, to + s * SNAP_MS);
        return [id, back] as const;
      }));
      const ks = resolve(t.keyframes, cut, b.durationMs);
      if (!ks) { fits = false; break; }
      placed.set(tid, ks);
    }
    if (fits) return { ...b, tracks: b.tracks.map((t) => (placed.has(t.id) ? { ...t, keyframes: placed.get(t.id)! } : t)) };
  }
  return null;
}

/** One track's keyframes with `moved` at their times and the pushes they cause, or null when that does not fit. */
function resolve(keyframes: readonly Keyframe[], moved: ReadonlyMap<string, number>, durationMs: number): Keyframe[] | null {
  const pos = new Map(keyframes.map((k) => [k.id, moved.get(k.id) ?? k.at]));
  // A moved one stays within the flow and off 0 (where it was may be off that, from before #426).
  for (const k of keyframes) { const at = moved.get(k.id); if (at !== undefined && at !== k.at && (at < SNAP_MS || at > durationMs)) return null; }
  // The order they stood in; a moved keyframe passes a neighbour only where no margin faces between them.
  const order = [...keyframes].sort((a, b) => a.at - b.at || (a.id === START_KEYFRAME ? -1 : b.id === START_KEYFRAME ? 1 : 0));
  for (const id of moved.keys()) {
    let i = order.findIndex((k) => k.id === id);
    const m = order[i], to = pos.get(id)!;
    while (i + 1 < order.length && !moved.has(order[i + 1].id) && pos.get(order[i + 1].id)! < to && gapBetween(m, order[i + 1]) === 0) { [order[i], order[i + 1]] = [order[i + 1], m]; i++; }
    while (i > 0 && !moved.has(order[i - 1].id) && order[i - 1].id !== START_KEYFRAME && pos.get(order[i - 1].id)! > to && gapBetween(order[i - 1], m) === 0) { [order[i], order[i - 1]] = [order[i - 1], m]; i--; }
  }
  const fixed = (k: Keyframe) => moved.has(k.id) || k.id === START_KEYFRAME;
  const pushed = new Set<string>();
  // How far the later of two must stay from the earlier: their facing margins; a pushed one a step (SNAP_MS) at least.
  const need = (a: Keyframe, b: Keyframe, pusher: Keyframe) => gapBetween(a, b) || (pushed.has(pusher.id) ? SNAP_MS : 0);
  for (let i = 0; i < order.length; i++) {
    if (!moved.has(order[i].id)) continue;
    // Forward: what comes after is pushed later.
    for (let cur = i, j = i + 1; j < order.length; cur = j, j++) {
      const a = order[cur], n = order[j], d = need(a, n, a);
      if (pos.get(n.id)! >= pos.get(a.id)! + d && (d > 0 || pos.get(n.id)! > pos.get(a.id)!)) break;
      if (fixed(n) || d === 0) return null;
      pos.set(n.id, pos.get(a.id)! + d); pushed.add(n.id);
      if (pos.get(n.id)! > durationMs) return null;
    }
    // Backward: what comes before is pushed earlier, never onto the start keyframe.
    for (let cur = i, j = i - 1; j >= 0; cur = j, j--) {
      const z = order[cur], p = order[j], d = need(p, z, z);
      if (pos.get(p.id)! <= pos.get(z.id)! - d && (d > 0 || pos.get(p.id)! < pos.get(z.id)!)) break;
      if (fixed(p) || d === 0) return null;
      pos.set(p.id, pos.get(z.id)! - d); pushed.add(p.id);
      if (pos.get(p.id)! < SNAP_MS) return null;
    }
  }
  // Pushed from both sides at once (between two selected ones): everything it touched must still fit.
  for (let i = 1; i < order.length; i++) {
    const a = order[i - 1], n = order[i], gap = pos.get(n.id)! - pos.get(a.id)!;
    if (gap <= 0 || (gapBetween(a, n) > gap && (pushed.has(a.id) || pushed.has(n.id) || moved.has(a.id) || moved.has(n.id)))) return null;
  }
  return keyframes.map((k) => (pos.get(k.id) === k.at ? k : { ...k, at: pos.get(k.id)! }));
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
