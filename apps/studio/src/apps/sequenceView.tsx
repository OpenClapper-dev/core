import { effectName, sampleTrack, type Keyframe, type SequenceSample } from "@openclapper/vocab";
import { getSettings, updateSettings, useSettings, type SeqView } from "../settings";
export type { SeqView } from "../settings";

export const SEQ_VIEW_LABELS: Record<keyof SeqView, string> = { graph: "Intensity graph", fill: "Light colour", labels: "Value labels", badges: "Effect and power badges" };

export function useSeqView(): [SeqView, (patch: Partial<SeqView>) => void] {
  return [useSettings().seqView, (patch) => updateSettings({ seqView: { ...getSettings().seqView, ...patch } })];
}

/**
 * The colour of a white light at `k` kelvin, as sRGB (Tanner Helland's fit of the Planckian locus;
 * close enough for a swatch). A light's real colour is content, like a photo: not a theme token.
 */
export function kelvinRgb(k: number): [number, number, number] {
  const t = Math.min(40_000, Math.max(1000, k)) / 100;
  const clamp = (x: number) => Math.round(Math.min(255, Math.max(0, x)));
  const r = t <= 66 ? 255 : 329.698727446 * (t - 60) ** -0.1332047592;
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * (t - 60) ** -0.0755148492;
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  return [clamp(r), clamp(g), clamp(b)];
}

/** The CSS colour a light shows in this state, or null when nothing has set white or colour. */
export function lightColour(s: SequenceSample): string | null {
  if (s.mode === "colour") return `hsl(${Math.round(s.hue ?? 0)} ${Math.round((s.sat ?? 1) * 100)}% ${Math.round(100 - (s.sat ?? 1) * 50)}%)`;
  if (s.mode === "white" && s.kelvin !== undefined) { const [r, g, b] = kelvinRgb(s.kelvin); return `rgb(${r} ${g} ${b})`; }
  return null;
}

/** The level the graph shows at t: off counts as 0. */
const levelAt = (ks: readonly Keyframe[], t: number) => { const s = sampleTrack(ks, t); return s.power === false ? 0 : s.intensity ?? 0; };

/**
 * The intensity line of a track as SVG points ("t,y" with y = 1 − level), in the lane's time axis:
 * flat while held, a vertical step at a jump, the eased curve across a fade (sampled finely).
 */
export function graphPoints(keyframes: readonly Keyframe[], durationMs: number): string {
  const ks = [...keyframes].sort((a, b) => a.at - b.at);
  if (!ks.length) return "";
  const pts: [number, number][] = [];
  const push = (t: number) => pts.push([t, 1 - levelAt(ks, t)]);
  for (let i = 0; i < ks.length; i++) {
    const k = ks[i], next = ks[i + 1];
    if (i > 0 && !k.fadeIn) pts.push([k.at, 1 - levelAt(ks, Math.max(0, k.at - 1))]); // the level just before a jump
    push(k.at);
    const end = next ? next.at : durationMs;
    if (next?.fadeIn) for (let j = 1; j < 24; j++) push(k.at + ((end - k.at) * j) / 24);
    else if (!next) push(end);
  }
  return pts.map(([t, y]) => `${t},${y.toFixed(4)}`).join(" ");
}

/** The level a keyframe sits at in the graph. */
export const keyframeLevel = (keyframes: readonly Keyframe[], k: Keyframe) => levelAt(keyframes, k.at);

/** A short line of what a keyframe sets ("70 % · 3200 K", "Fire"), for the value labels; `effect` false when a badge shows it. */
export function shortLabel(k: Keyframe, effect = true): string {
  return [
    k.power === false ? "off" : null,
    k.intensity !== undefined ? `${Math.round(k.intensity * 100)} %` : null,
    k.kelvin !== undefined ? `${k.kelvin} K` : null,
    k.hue !== undefined ? `${Math.round(k.hue)}°` : null,
    k.effect !== undefined && (effect || !k.effect.id) ? (k.effect.id ? effectName(k.effect.id) : "fx off") : null,
  ].filter(Boolean).join(" · ");
}
