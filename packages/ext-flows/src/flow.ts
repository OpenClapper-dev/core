import { CAMERA_CONTROLS, FADE_MAX_MS, modelOf, type Curve, type EffectId, type EffectSettings, type LightCommand, type Value } from "@openclapper/ext-hardware";
import type { FlowStage } from "./stage.ts";

/**
 * Flows (docs/features/flows.md; the first app's light sequences, #304). A flow has tracks; a track has a type (a
 * catalogue model: a light or a camera) and, as a separate step, the device it drives. A light track: Its keyframes hold values: between two keyframes the light
 * keeps the first one's values and jumps at the second, unless a fade connects them (the second
 * keyframe's `fadeIn`, a tile on the gap in the editor): then every value that differs fades over
 * the gap with the fade's curve. Every track starts with a fixed start keyframe at 0 holding a
 * complete state, so a sequence never inherits what a light happened to show. Played by sampling
 * every FLOW_TICK_MS; every fade goes in those steps (native fades are off, NATIVE_FADES).
 */

export const FLOW_TICK_MS = 100;
/**
 * Native fades (#289: the MC runs a fade tile by itself) are switched off (#426): on the owner's lights they were
 * unreliable and started oddly, so every fade tile goes in steps every FLOW_TICK_MS on every light. The code stays
 * (nativeFades, nativeStep, the `fade` command) to try again; while this is false the player never sends `fade`, the
 * editors offer no choice of how a fade runs, and stored `fadeStepped` values are kept but mean nothing.
 */
export const NATIVE_FADES: boolean = false;
export const FLOW_MAX_MS = 60 * 60_000;
/** The start keyframe's id on every track. */
export const START_KEYFRAME = "start";

export interface Keyframe {
  id: string;
  /** ms from the start of the sequence; the start keyframe is always at 0. */
  at: number;
  /** A fade from the previous keyframe into this one, with this curve; absent: jump here. */
  fadeIn?: Curve;
  /** On a light that fades by itself (#289): send this fade in steps every 0.1 s instead. Ignored while NATIVE_FADES is off. */
  fadeStepped?: boolean;
  power?: boolean;
  /** 0..1 */
  intensity?: number;
  /** White: sets white mode. */
  kelvin?: number;
  /** −50..50, with kelvin. */
  gm?: number;
  /** Colour: 0..360 and 0..1; sets colour mode. */
  hue?: number;
  sat?: number;
  /** A built-in effect from here on (null: stop it). */
  effect?: { id: EffectId | null; settings?: EffectSettings };
  /** The fixture's dimming curve from here on. */
  curve?: Curve;
  /** On a camera track: catalogue controls set from here on (record, ISO…), by control id; they jump, never fade. */
  controls?: Record<string, Value>;
  /**
   * Margins (#426), in ms on the half-second grid (edit.ts SNAP_MS): the least distance to the keyframe before / after on the track. Moving a
   * keyframe pushes a neighbour that would come inside one (edit.ts, moveKeyframes). The start keyframe has none before.
   */
  marginBeforeMs?: number;
  marginAfterMs?: number;
}

export interface FlowTrack {
  id: string;
  name: string;
  /** FIXTURE_KINDS id: which lights it can drive. */
  model: string;
  /** The light it drives; null until assigned (an unassigned track does not play). */
  device: string | null;
  /** Temporarily left out of playback and Live, like a muted track in an audio editor. */
  muted?: boolean;
  /** One of TRACK_COLORS (#323): the label's stripe, the lane's tint, the keyframes' border. */
  color?: number;
  keyframes: Keyframe[];
  /**
   * A light's parameters locked on its start keyframe (#426): the start's value holds for the whole track. Other
   * keyframes' values for them are kept but ignored (`playedKeyframes`), so unlocking brings them back.
   */
  locked?: LightParam[];
}

/**
 * A light keyframe's parameters, by the ids of the catalogue's light controls (ext-hardware lightControls), so a
 * lock or a hidden parameter means the same in a flow and on a device card. Colour is hue and saturation as one.
 */
export const LIGHT_PARAMS = ["power", "intensity", "kelvin", "gm", "colour", "effect", "curve"] as const;
export type LightParam = (typeof LIGHT_PARAMS)[number];
/** The parameters a light model has: the catalogue controls it declares. */
export const modelParams = (modelId: string): LightParam[] => LIGHT_PARAMS.filter((p) => modelOf(modelId)?.controls.some((c) => c.id === p));
/** What a keyframe's panel shows besides the parameters (#426); each can be left out, like a parameter. */
export const KEYFRAME_FIELDS = ["at", "marginBefore", "marginAfter"] as const;
export type KeyframeField = (typeof KEYFRAME_FIELDS)[number] | LightParam;
/**
 * What the account leaves out (#426; preferences `lightParamsHidden`, `keyframeFieldsHidden`): a model's parameters
 * everywhere (panels, locks, device cards), and fields of every keyframe panel. Only what is shown; values stay.
 */
export interface PanelHides { params: readonly LightParam[]; fields: readonly KeyframeField[] }
export const NO_HIDES: PanelHides = { params: [], fields: [] };

/** How the editors name them. */
export const PARAM_LABELS: Record<LightParam, string> = {
  power: "Power", intensity: "Intensity", kelvin: "Colour temperature", gm: "Green / magenta", colour: "Colour", effect: "Effect", curve: "Dimming curve",
};
/** The keyframe fields each parameter is stored in. */
export const PARAM_FIELDS: Record<LightParam, readonly (keyof Keyframe)[]> = {
  power: ["power"], intensity: ["intensity"], kelvin: ["kelvin"], gm: ["gm"], colour: ["hue", "sat"], effect: ["effect"], curve: ["curve"],
};

/**
 * A track's keyframes as they play (#426): where a parameter is locked, every keyframe that sets it takes the start
 * keyframe's value instead (none, when the start leaves it unset). Taking the value rather than dropping the field
 * keeps a keyframe's switch between white and colour. The stored keyframes are not changed.
 */
export function playedKeyframes(t: Pick<FlowTrack, "keyframes" | "locked">): Keyframe[] {
  if (!t.locked?.length) return t.keyframes;
  const start = t.keyframes.find((k) => k.id === START_KEYFRAME);
  if (!start) return t.keyframes;
  const fields = t.locked.flatMap((p) => PARAM_FIELDS[p] ?? []);
  return t.keyframes.map((k) => {
    if (k.id === START_KEYFRAME || !fields.some((f) => k[f] !== undefined)) return k;
    const n: Record<string, unknown> = { ...k };
    for (const f of fields) { if (n[f] === undefined) continue; if (start[f] === undefined) delete n[f]; else n[f] = start[f]; }
    return n as unknown as Keyframe;
  });
}

export interface Flow {
  id: string;
  name: string;
  durationMs: number;
  loop: boolean;
  tracks: FlowTrack[];
  /** Named checkpoints and ranges (#323); absent on sequences saved before them. */
  markers?: FlowMarker[];
  /** The stage (#426, stage.ts): a drawing with a widget per placed light track; absent until one is drawn or placed. */
  stage?: FlowStage;
  updatedAt: string;
}

/** How many track colours there are (the Studio's --track-1 … --track-8). */
export const TRACK_COLORS = 8;

/**
 * A marker (#323): a named point (`end` absent) or range (`at` to `end`), across the whole
 * sequence or on one track (`trackId`). Only for finding your way: playback ignores markers.
 */
export interface FlowMarker {
  id: string;
  at: number;
  end?: number;
  name: string;
  trackId?: string;
}
export const FLOW_MARKERS_MAX = 200;
export const MARKER_NAME_MAX = 60;

/** What a track says at one moment; undefined: no keyframe has set it. */
export interface SequenceSample {
  power?: boolean;
  intensity?: number;
  mode?: "white" | "colour";
  kelvin?: number;
  gm?: number;
  hue?: number;
  sat?: number;
  effect?: { id: EffectId | null; settings?: EffectSettings };
  curve?: Curve;
}

/** A start keyframe: a light on, half intensity, white in the middle of its range (or colour without white); a camera not recording. */
export function startKeyframe(kind: { caps: { cct: { min: number; max: number } | null; hsi: boolean; camera?: boolean } } | undefined): Keyframe {
  if (kind?.caps.camera) return { id: START_KEYFRAME, at: 0, controls: { record: false } };
  const cct = kind?.caps.cct;
  return {
    id: START_KEYFRAME, at: 0, power: true, intensity: 0.5,
    ...(cct ? { kelvin: Math.round((cct.min + cct.max) / 200) * 100, gm: 0 } : kind?.caps.hsi ? { hue: 0, sat: 1 } : {}),
  };
}

/** 0..1 → 0..1 for each dimming curve, used as the shape of a fade. */
export function ease(curve: Curve, t: number): number {
  const x = Math.min(1, Math.max(0, t));
  switch (curve) {
    case "linear": return x;
    case "exp": return (2 ** (10 * x) - 1) / 1023;
    case "log": return Math.log2(1 + 1023 * x) / 10;
    case "s": return x * x * (3 - 2 * x);
  }
}

const sorted = (k: readonly Keyframe[]) => [...k].sort((a, b) => a.at - b.at || (a.id === START_KEYFRAME ? -1 : b.id === START_KEYFRAME ? 1 : 0));

/** Values held after every keyframe up to and including index `i`. */
function heldAt(ks: readonly Keyframe[], i: number): SequenceSample {
  const out: SequenceSample = {};
  for (let j = 0; j <= i; j++) {
    const k = ks[j];
    if (k.power !== undefined) out.power = k.power;
    if (k.intensity !== undefined) out.intensity = k.intensity;
    if (k.kelvin !== undefined) { out.mode = "white"; out.kelvin = k.kelvin; out.gm = k.gm ?? out.gm ?? 0; }
    if (k.hue !== undefined || k.sat !== undefined) { out.mode = "colour"; if (k.hue !== undefined) out.hue = k.hue; if (k.sat !== undefined) out.sat = k.sat; }
    if (k.effect !== undefined) out.effect = k.effect;
    if (k.curve !== undefined) out.curve = k.curve;
  }
  return out;
}

/** The fade into keyframe `i` (from i − 1), if one is set and the gap is long enough to fade. */
const fadeInto = (ks: readonly Keyframe[], i: number) => (i > 0 && ks[i].fadeIn && ks[i].at - ks[i - 1].at >= 1 ? ks[i].fadeIn! : null);

/**
 * The state of a track at `t` ms: what the last keyframe at or before `t` left, or, inside a fade, every
 * number that differs between the two ends eased with the fade's curve (hue the short way round).
 * White ↔ colour cannot be blended: across such a fade the mode switches at its end.
 */
export function sampleTrack(keyframes: readonly Keyframe[], t: number): SequenceSample {
  const ks = sorted(keyframes);
  let i = -1;
  while (i + 1 < ks.length && ks[i + 1].at <= t) i++;
  if (i < 0) return {};
  const a = heldAt(ks, i);
  const next = i + 1 < ks.length ? i + 1 : -1;
  const curve = next >= 0 ? fadeInto(ks, next) : null;
  if (!curve) return a;
  const b = heldAt(ks, next);
  const x = ease(curve, (t - ks[i].at) / (ks[next].at - ks[i].at));
  const out = { ...a };
  const mix = (p: number | undefined, q: number | undefined) => (p === undefined || q === undefined ? p : p + (q - p) * x);
  out.intensity = mix(a.intensity, b.intensity);
  if (a.mode === b.mode) {
    if (a.mode === "white") { out.kelvin = mix(a.kelvin, b.kelvin); out.gm = mix(a.gm, b.gm); }
    if (a.mode === "colour") {
      let h = b.hue;
      if (a.hue !== undefined && h !== undefined && Math.abs(h - a.hue) > 180) h += h > a.hue ? -360 : 360;
      const v = mix(a.hue, h);
      out.hue = v === undefined ? v : ((v % 360) + 360) % 360;
      out.sat = mix(a.sat, b.sat);
    }
  }
  return out;
}

/** A camera track's controls at `t`: every value the keyframes up to `t` set (they jump). */
export function sampleControls(keyframes: readonly Keyframe[], t: number): Record<string, Value> {
  const out: Record<string, Value> = {};
  for (const k of sorted(keyframes)) { if (k.at > t) break; Object.assign(out, k.controls ?? {}); }
  return out;
}

/** The camera controls a flow can set: those that hold a value (no buttons, no per-output table). */
export const FLOW_CAMERA_CONTROLS = CAMERA_CONTROLS.filter((c) => c.kind === "switch" || c.kind === "choice" || c.kind === "number" || c.kind === "range");

/** Rounded to what a light can show, so a slow fade does not send a command every tick for nothing. */
function quantize(s: SequenceSample): SequenceSample {
  const q = { ...s };
  if (q.intensity !== undefined) q.intensity = Math.round(q.intensity * 1000) / 1000;
  if (q.kelvin !== undefined) q.kelvin = Math.round(q.kelvin / 10) * 10;
  if (q.gm !== undefined) q.gm = Math.round(q.gm);
  if (q.hue !== undefined) q.hue = Math.round(q.hue) % 360;
  if (q.sat !== undefined) q.sat = Math.round(q.sat * 100) / 100;
  return q;
}

const sameEffect = (a: SequenceSample["effect"], b: SequenceSample["effect"]) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * The commands that take a light from what was last sent (`prev`, null at the start) to `next`, and
 * what counts as sent afterwards. White or colour commands would stop a running effect, so while an
 * effect runs only power and intensity follow.
 */
export function commandsFor(prev: SequenceSample | null, next: SequenceSample): { commands: LightCommand[]; sent: SequenceSample } {
  const n = quantize(next), p = prev ?? {};
  const cmds: LightCommand[] = [];
  if (n.power !== undefined && n.power !== p.power) cmds.push({ op: "power", on: n.power });
  if (n.curve !== undefined && n.curve !== p.curve) cmds.push({ op: "curve", curve: n.curve });
  const fx = n.effect?.id ? n.effect : null;
  if (n.effect !== undefined && !sameEffect(n.effect, p.effect)) {
    cmds.push(n.effect.id ? { op: "effect", effect: n.effect.id, ...(n.effect.settings ? { settings: n.effect.settings } : {}) } : { op: "effect", effect: null });
  }
  const modeChanged = n.mode !== p.mode || (!fx && !!p.effect?.id);
  if (fx) {
    if (n.intensity !== undefined && n.intensity !== p.intensity) cmds.push({ op: "intensity", value: n.intensity });
  } else if (n.mode === "colour") {
    if (modeChanged || n.hue !== p.hue || n.sat !== p.sat || n.intensity !== p.intensity) {
      cmds.push({ op: "hsi", h: n.hue ?? 0, s: n.sat ?? 1, i: n.intensity ?? 0.5 });
    }
  } else {
    if (n.mode === "white" && (modeChanged || n.kelvin !== p.kelvin || n.gm !== p.gm) && n.kelvin !== undefined) {
      cmds.push({ op: "cct", kelvin: n.kelvin, gm: n.gm ?? 0 });
    }
    if (n.intensity !== undefined && n.intensity !== p.intensity) cmds.push({ op: "intensity", value: n.intensity });
  }
  return { commands: cmds, sent: n };
}

/** Whether `t` lies inside a fade tile (any kind): lights with switchable smoothing smooth there and jump elsewhere. */
export function inFade(keyframes: readonly Keyframe[], t: number): boolean {
  const ks = sorted(keyframes);
  for (let i = 1; i < ks.length; i++) if (ks[i - 1].at <= t && t < ks[i].at) return !!fadeInto(ks, i);
  return false;
}

/** A fade tile the light runs by itself (#289): the gap from one keyframe to the next. */
export interface NativeFade { from: number; to: number; /** The keyframe it fades into. */ toId: string; curve: Curve }

/** The fade tiles of a track a light can run by itself: no effect running at their start, not set to stepped. */
export function nativeFades(keyframes: readonly Keyframe[]): NativeFade[] {
  const ks = sorted(keyframes);
  const out: NativeFade[] = [];
  for (let i = 1; i < ks.length; i++) {
    const curve = fadeInto(ks, i);
    if (!curve || ks[i].fadeStepped) continue;
    const a = heldAt(ks, i - 1);
    if (a.effect?.id) continue;
    out.push({ from: ks[i - 1].at, to: ks[i].at, toId: ks[i].id, curve });
  }
  return out;
}

/**
 * One playback tick for a light that fades by itself (#289). Inside a fade tile the light gets one
 * `fade` command to the far keyframe's values when the tile (or a 25.5 s chunk of a longer one)
 * begins, and nothing else until it ends: `key` names the running chunk; the runner keeps it and
 * passes it back. Outside fades: the values, jumping at keyframes.
 */
export function nativeStep(keyframes: readonly Keyframe[], t: number, prev: SequenceSample | null, prevKey: string | null): { commands: LightCommand[]; sent: SequenceSample; key: string | null } {
  const s = sampleTrack(keyframes, t);
  const fade = nativeFades(keyframes).find((f) => f.from <= t && t < f.to);
  if (!fade) return { ...commandsFor(prev, s), key: null };
  const idx = Math.floor((t - fade.from) / FADE_MAX_MS);
  const key = `${fade.toId}:${idx}`;
  if (key === prevKey && prev) return { commands: [], sent: prev, key };
  const end = Math.min(fade.to, fade.from + (idx + 1) * FADE_MAX_MS);
  // Where the light is now (a start mid-fade jumps there first), then one fade to where the chunk ends.
  const base = commandsFor(prev, s);
  const target = quantize(end === fade.to ? heldAt(sorted(keyframes), sorted(keyframes).findIndex((k) => k.id === fade.toId)) : sampleTrack(keyframes, end));
  const cmd: LightCommand = {
    op: "fade", ms: end - t, curve: fade.curve, intensity: target.intensity ?? s.intensity ?? 0.5,
    ...(target.mode === "colour" ? { colour: { h: target.hue ?? 0, s: target.sat ?? 1 } } : target.mode === "white" && target.kelvin !== undefined ? { white: { kelvin: target.kelvin, gm: target.gm ?? 0 } } : {}),
  };
  return { commands: [...base.commands, cmd], sent: { ...base.sent, ...target, power: base.sent.power }, key };
}

export const FLOW_NAME_MAX = 120;
export const FLOW_TRACKS_MAX = 64;
export const FLOW_KEYFRAMES_MAX = 2000;

const isNum = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const CURVE_IDS = ["linear", "exp", "log", "s"];

/**
 * A sequence's tracks as the Worker stores them (#304): checked strictly (they come from the editor),
 * unknown fields dropped. Returns the clean tracks, or an error naming the first problem.
 */
export function parseFlowTracks(v: unknown, durationMs: number, isKind: (id: string) => boolean, isEffect: (id: string) => boolean): { tracks: FlowTrack[] } | { error: string } {
  if (!Array.isArray(v)) return { error: "tracks must be an array" };
  if (v.length > FLOW_TRACKS_MAX) return { error: `at most ${FLOW_TRACKS_MAX} tracks` };
  let total = 0;
  const tracks: FlowTrack[] = [];
  for (const [i, raw] of v.entries()) {
    const t = (raw ?? {}) as Record<string, unknown>;
    const where = `tracks[${i}]`;
    if (typeof t.id !== "string" || !t.id || t.id.length > 64) return { error: `${where}.id is missing` };
    if (typeof t.name !== "string" || !t.name.trim() || t.name.length > 60) return { error: `${where}.name must be 1–60 characters` };
    if (typeof t.model !== "string" || !isKind(t.model)) return { error: `${where}.model is not a light or camera of the catalogue` };
    const camera = modelOf(t.model)?.type === "camera";
    if (t.device != null && (typeof t.device !== "string" || t.device.length > 64)) return { error: `${where}.device is not an id` };
    if (!Array.isArray(t.keyframes)) return { error: `${where}.keyframes must be an array` };
    total += t.keyframes.length;
    if (total > FLOW_KEYFRAMES_MAX) return { error: `at most ${FLOW_KEYFRAMES_MAX} keyframes per sequence` };
    const keyframes: Keyframe[] = [];
    for (const [j, rk] of t.keyframes.entries()) {
      const k = (rk ?? {}) as Record<string, unknown>;
      const at = `${where}.keyframes[${j}]`;
      if (typeof k.id !== "string" || !k.id || k.id.length > 64) return { error: `${at}.id is missing` };
      if (!isNum(k.at, 0, durationMs)) return { error: `${at}.at must be within the sequence` };
      const out: Keyframe = { id: k.id, at: Math.round(k.at) };
      if (k.fadeIn != null) { if (!CURVE_IDS.includes(k.fadeIn as string)) return { error: `${at}.fadeIn is not a curve` }; out.fadeIn = k.fadeIn as Curve; }
      if (k.fadeStepped === true) out.fadeStepped = true;
      if (k.power != null) { if (typeof k.power !== "boolean") return { error: `${at}.power must be true or false` }; out.power = k.power; }
      for (const [f, lo, hi] of [["intensity", 0, 1], ["kelvin", 1000, 20000], ["gm", -50, 50], ["hue", 0, 360], ["sat", 0, 1]] as const) {
        if (k[f] == null) continue;
        if (!isNum(k[f], lo, hi)) return { error: `${at}.${f} is out of range` };
        out[f] = k[f] as number;
      }
      if (k.curve != null) { if (!CURVE_IDS.includes(k.curve as string)) return { error: `${at}.curve is not a curve` }; out.curve = k.curve as Curve; }
      for (const f of ["marginBeforeMs", "marginAfterMs"] as const) {
        if (k[f] == null) continue;
        if (!isNum(k[f], 0, durationMs) || (k[f] as number) % 500 !== 0) return { error: `${at}.${f} must be half seconds within the sequence` };
        if (f === "marginBeforeMs" && k.id === START_KEYFRAME && k[f] !== 0) return { error: `${at}: the start keyframe has no margin before` };
        if (k[f] !== 0) out[f] = k[f] as number;
      }
      if (k.controls != null) {
        if (!camera || typeof k.controls !== "object" || Array.isArray(k.controls)) return { error: `${at}.controls belong to a camera track` };
        const controls: Record<string, Value> = {};
        for (const [id, v] of Object.entries(k.controls as Record<string, unknown>)) {
          const c = FLOW_CAMERA_CONTROLS.find((x) => x.id === id);
          if (!c) return { error: `${at}.controls.${id} is not a camera control a flow can set` };
          const ok = c.kind === "switch" ? typeof v === "boolean" : c.kind === "choice" ? c.options.some((o) => o.value === v) : c.kind === "number" || c.kind === "range" ? isNum(v, c.min, c.max) : false;
          if (!ok) return { error: `${at}.controls.${id} is out of range` };
          controls[id] = v as Value;
        }
        out.controls = controls;
      }
      if (camera && (out.power !== undefined || out.intensity !== undefined || out.kelvin !== undefined || out.hue !== undefined || out.fadeIn)) return { error: `${at}: a camera track sets camera controls only, without fades` };
      if (k.effect != null) {
        const e = k.effect as Record<string, unknown>;
        if (typeof e !== "object" || (e.id !== null && (typeof e.id !== "string" || !isEffect(e.id)))) return { error: `${at}.effect is not a known effect` };
        out.effect = { id: e.id as EffectId | null, ...(e.settings && typeof e.settings === "object" ? { settings: e.settings as EffectSettings } : {}) };
      }
      keyframes.push(out);
    }
    if (!keyframes.some((k) => k.id === START_KEYFRAME && k.at === 0)) return { error: `${where} has no start keyframe at 0` };
    if (t.color != null && (!Number.isInteger(t.color) || !isNum(t.color, 0, TRACK_COLORS - 1))) return { error: `${where}.color is not a track colour` };
    // Locks (#426): known light parameters, each once; a camera track has none.
    let locked: LightParam[] | undefined;
    if (t.locked != null) {
      if (!Array.isArray(t.locked) || t.locked.some((p) => !(LIGHT_PARAMS as readonly unknown[]).includes(p)) || new Set(t.locked).size !== t.locked.length) return { error: `${where}.locked must list light parameters (${LIGHT_PARAMS.join(", ")}), each once` };
      if (camera && t.locked.length) return { error: `${where}: a camera track has no locks` };
      if (t.locked.length) locked = t.locked as LightParam[];
    }
    tracks.push({ id: t.id, name: t.name.trim(), model: t.model, device: (t.device as string | null | undefined) ?? null, ...(t.muted === true ? { muted: true } : {}), ...(t.color != null ? { color: t.color as number } : {}), keyframes, ...(locked ? { locked } : {}) });
  }
  return { tracks };
}

/**
 * A sequence's markers as the Worker stores them (#323): checked strictly, unknown fields dropped.
 * A marker on a track that is not in the sequence (removed) becomes one across the sequence.
 */
export function parseFlowMarkers(v: unknown, durationMs: number, trackIds: ReadonlySet<string>): { markers: FlowMarker[] } | { error: string } {
  if (v == null) return { markers: [] };
  if (!Array.isArray(v)) return { error: "markers must be an array" };
  if (v.length > FLOW_MARKERS_MAX) return { error: `at most ${FLOW_MARKERS_MAX} markers` };
  const markers: FlowMarker[] = [];
  for (const [i, raw] of v.entries()) {
    const m = (raw ?? {}) as Record<string, unknown>;
    const where = `markers[${i}]`;
    if (typeof m.id !== "string" || !m.id || m.id.length > 64) return { error: `${where}.id is missing` };
    if (typeof m.name !== "string" || m.name.length > MARKER_NAME_MAX) return { error: `${where}.name must be at most ${MARKER_NAME_MAX} characters` };
    if (!isNum(m.at, 0, durationMs)) return { error: `${where}.at must be within the sequence` };
    if (m.end != null && (!isNum(m.end, 0, durationMs) || m.end <= m.at)) return { error: `${where}.end must be after at, within the sequence` };
    if (m.trackId != null && typeof m.trackId !== "string") return { error: `${where}.trackId is not an id` };
    markers.push({ id: m.id, at: Math.round(m.at), name: m.name.trim(), ...(m.end != null ? { end: Math.round(m.end as number) } : {}), ...(typeof m.trackId === "string" && trackIds.has(m.trackId) ? { trackId: m.trackId } : {}) });
  }
  return { markers };
}
