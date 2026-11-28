// What a flow's lanes show (docs/features/flows.md): a light's colour, the intensity graph, short labels of what a
// keyframe sets, and the view switches. Shared by the Studio's and the device's editors.
import { effectName, hsiCss, modelOf } from "@openclapper/ext-hardware";
import { sampleTrack, type Keyframe, type SequenceSample } from "./flow.ts";

export interface FlowView { graph: boolean; fill: boolean; labels: boolean; badges: boolean }
export const VIEW_LABELS: Record<keyof FlowView, string> = { graph: "Intensity graph", fill: "Light colour", labels: "Value labels", badges: "Effect and power badges" };
export const DEFAULT_VIEW: FlowView = { graph: false, fill: true, labels: false, badges: true };
export type KeyframeSize = "s" | "m" | "l";

/**
 * The colour of a white light at `k` kelvin, as sRGB (Tanner Helland's fit of the Planckian locus; close enough for
 * a swatch). A light's real colour is content, like a photo: not a theme token.
 */
export function kelvinRgb(k: number): [number, number, number] {
  const t = Math.min(40_000, Math.max(1000, k)) / 100;
  const clamp = (x: number) => Math.round(Math.min(255, Math.max(0, x)));
  const r = t <= 66 ? 255 : 329.698727446 * (t - 60) ** -0.1332047592;
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * (t - 60) ** -0.0755148492;
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  return [clamp(r), clamp(g), clamp(b)];
}

/** The colour a light shows (CSS and React Native) in this state, or null when nothing has set white or colour. */
export function lightColour(s: SequenceSample): string | null {
  if (s.mode === "colour") return hsiCss(s.hue ?? 0, s.sat ?? 1);
  if (s.mode === "white" && s.kelvin !== undefined) { const [r, g, b] = kelvinRgb(s.kelvin); return `rgb(${r}, ${g}, ${b})`; }
  return null;
}

/** The level the graph shows at t: off counts as 0. */
const levelAt = (ks: readonly Keyframe[], t: number) => { const s = sampleTrack(ks, t); return s.power === false ? 0 : s.intensity ?? 0; };
/** The level a keyframe sits at in the graph. */
export const keyframeLevel = (ks: readonly Keyframe[], k: Keyframe) => levelAt(ks, k.at);

/** The intensity line of a track as points [t, y] (y = 1 − level): flat while held, a step at a jump, the eased curve across a fade. */
export function graphLine(keyframes: readonly Keyframe[], durationMs: number): [number, number][] {
  const ks = [...keyframes].sort((a, b) => a.at - b.at);
  if (!ks.length) return [];
  const pts: [number, number][] = [];
  const push = (t: number) => pts.push([t, 1 - levelAt(ks, t)]);
  for (let i = 0; i < ks.length; i++) {
    const k = ks[i], next = ks[i + 1];
    if (i > 0 && !k.fadeIn) pts.push([k.at, 1 - levelAt(ks, Math.max(0, k.at - 1))]);
    push(k.at);
    const end = next ? next.at : durationMs;
    if (next?.fadeIn) for (let j = 1; j < 24; j++) push(k.at + ((end - k.at) * j) / 24);
    else if (!next) push(end);
  }
  return pts;
}
/** The same as SVG points ("t,y …"). */
export const graphPoints = (keyframes: readonly Keyframe[], durationMs: number): string => graphLine(keyframes, durationMs).map(([t, y]) => `${t},${y.toFixed(4)}`).join(" ");

/** What a camera keyframe sets, in the catalogue's words ("Record · ISO 1600"). */
export function cameraLabel(model: string, k: Keyframe): string {
  const m = modelOf(model);
  return Object.entries(k.controls ?? {}).map(([id, v]) => {
    const c = m?.controls.find((x) => x.id === id);
    if (!c) return id;
    if (id === "record") return v ? "Record" : "Stop";
    if (c.kind === "choice") return `${c.label} ${c.options.find((o) => o.value === v)?.label ?? v}`;
    if (c.kind === "switch") return `${c.label} ${v ? "on" : "off"}`;
    return `${c.label} ${typeof v === "number" && !Number.isInteger(v) ? v.toFixed(2) : v}`;
  }).join(" · ");
}

/** A short line of what a keyframe sets ("70 % · 3200 K", "Fire"); `effect` false when a badge shows it. */
export function shortLabel(model: string, k: Keyframe, effect = true): string {
  if (k.controls) return cameraLabel(model, k);
  return [
    k.power === false ? "off" : null,
    k.intensity !== undefined ? `${Math.round(k.intensity * 100)} %` : null,
    k.kelvin !== undefined ? `${k.kelvin} K` : null,
    k.hue !== undefined ? `${Math.round(k.hue)}°` : null,
    k.effect !== undefined && (effect || !k.effect.id) ? (k.effect.id ? effectName(k.effect.id) : "fx off") : null,
  ].filter(Boolean).join(" · ");
}
