import type { Curve, EffectId, EffectSettings } from "./lighting.ts";
import { FADE_MAX_MS, type LightCommand } from "./lightProxy.ts";

/**
 * Light sequences (#304). A sequence has tracks; a track has a type (a fixture kind) and, as a
 * separate step, the light it drives. Its keyframes hold values: between two keyframes the light
 * keeps the first one's values and jumps at the second, unless a fade connects them (the second
 * keyframe's `fadeIn`, a tile on the gap in the editor): then every value that differs fades over
 * the gap with the fade's curve. Every track starts with a fixed start keyframe at 0 holding a
 * complete state, so a sequence never inherits what a light happened to show. Played by sampling
 * every SEQUENCE_TICK_MS; lights that fade by themselves (#289) get one native fade per fade tile.
 */

export const SEQUENCE_TICK_MS = 100;
export const SEQUENCE_MAX_MS = 60 * 60_000;
/** The start keyframe's id on every track. */
export const START_KEYFRAME = "start";

export interface Keyframe {
  id: string;
  /** ms from the start of the sequence; the start keyframe is always at 0. */
  at: number;
  /** A fade from the previous keyframe into this one, with this curve; absent: jump here. */
  fadeIn?: Curve;
  /** On a light that fades by itself (#289): send this fade in steps every 0.1 s instead, to compare. */
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
}

export interface SequenceTrack {
  id: string;
  name: string;
  /** FIXTURE_KINDS id: which lights it can drive. */
  kindId: string;
  /** The light it drives; null until assigned (an unassigned track does not play). */
  fixtureId: string | null;
  /** Temporarily left out of playback and Live, like a muted track in an audio editor. */
  muted?: boolean;
  keyframes: Keyframe[];
}

export interface LightSequence {
  id: string;
  name: string;
  durationMs: number;
  loop: boolean;
  tracks: SequenceTrack[];
  updatedAt: string;
}

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

/** A start keyframe: on, half intensity, white in the middle of the kind's range (or colour without white). */
export function startKeyframe(kind: { caps: { cct: { min: number; max: number } | null; hsi: boolean } } | undefined): Keyframe {
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
