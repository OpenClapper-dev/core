import type { Curve, EffectId, EffectSettings } from "./lighting.ts";
import type { LightCommand } from "./lightProxy.ts";

/**
 * Light sequences (#304), first version: a track per fixture, keyframes on it. A keyframe sets any
 * of the channels; numbers ease from the previous keyframe that set the same channel, with the
 * keyframe's curve (the lights' four dimming curves). Power, colour mode, effect and dimming curve
 * switch at their keyframe. Played by sampling every SEQUENCE_TICK_MS and sending what changed.
 */

export const SEQUENCE_TICK_MS = 100;
export const SEQUENCE_MAX_MS = 60 * 60_000;

export interface Keyframe {
  id: string;
  /** ms from the start of the sequence. */
  at: number;
  /** Easing into this keyframe's numbers from the previous ones. */
  ease: Curve;
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

export interface SequenceTrack { fixtureId: string; keyframes: Keyframe[] }

export interface LightSequence {
  id: string;
  name: string;
  durationMs: number;
  loop: boolean;
  tracks: SequenceTrack[];
  updatedAt: string;
}

/** What a track says at one moment; undefined: no keyframe has set it yet. */
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

/** 0..1 → 0..1 for each dimming curve, used as easing. */
export function ease(curve: Curve, t: number): number {
  const x = Math.min(1, Math.max(0, t));
  switch (curve) {
    case "linear": return x;
    case "exp": return (2 ** (10 * x) - 1) / 1023;
    case "log": return Math.log2(1 + 1023 * x) / 10;
    case "s": return x * x * (3 - 2 * x);
  }
}

type Numeric = "intensity" | "kelvin" | "gm" | "hue" | "sat";
const NUMERIC: readonly Numeric[] = ["intensity", "kelvin", "gm", "hue", "sat"];

/** Keyframes by time; a track is short, so sorting on every sample is fine. */
const sorted = (k: readonly Keyframe[]) => [...k].sort((a, b) => a.at - b.at);

/** The state of a track at `t` ms. Hue takes the short way round the colour wheel. */
export function sampleTrack(keyframes: readonly Keyframe[], t: number): SequenceSample {
  const kfs = sorted(keyframes);
  const out: SequenceSample = {};
  for (const ch of NUMERIC) {
    let prev: Keyframe | undefined, next: Keyframe | undefined;
    for (const k of kfs) {
      if (k[ch] === undefined) continue;
      if (k.at <= t) prev = k;
      else { next = k; break; }
    }
    if (!prev) continue;
    const a = prev[ch]!;
    if (!next) { out[ch] = a; continue; }
    let b = next[ch]!;
    if (ch === "hue" && Math.abs(b - a) > 180) b += b > a ? -360 : 360;
    const v = a + (b - a) * ease(next.ease, (t - prev.at) / (next.at - prev.at));
    out[ch] = ch === "hue" ? ((v % 360) + 360) % 360 : v;
  }
  // Switched channels: the last keyframe at or before t that sets them.
  for (const k of kfs) {
    if (k.at > t) break;
    if (k.power !== undefined) out.power = k.power;
    if (k.kelvin !== undefined) out.mode = "white";
    if (k.hue !== undefined || k.sat !== undefined) out.mode = "colour";
    if (k.effect !== undefined) out.effect = k.effect;
    if (k.curve !== undefined) out.curve = k.curve;
  }
  return out;
}

/** Rounded to what a light can show, so a slow ramp does not send a command every tick for nothing. */
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
