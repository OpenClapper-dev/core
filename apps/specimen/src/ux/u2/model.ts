// The canvas document of the U2 prototype: optics presets and frames (with the real frame math of workshop 02), and
// the objects on the canvas. Fake data; nothing here is product code.
import type { IconName } from "@openclapper/design";
import type { Colour } from "../u1/catalogue";

export interface Preset { id: string; name: string; format: [number, number]; mult: number; squeeze: number; delivery?: number; primes?: number[]; zoom?: [number, number] }
export const PRESETS: Preset[] = [
  { id: "p6k", name: "Pocket 6K · Sigma 18–35", format: [23.1, 12.99], mult: 1, squeeze: 1, delivery: 2.39, zoom: [18, 35] },
  { id: "ff", name: "Full frame primes", format: [36, 24], mult: 1, squeeze: 1, primes: [24, 35, 50, 85] },
  { id: "ana", name: "Super 35 4-perf · 2× anamorphic", format: [24.89, 18.66], mult: 1, squeeze: 2, delivery: 2.39, primes: [40, 50, 75] },
];
export const PRIMES = [12, 14, 16, 18, 20, 21, 24, 25, 27, 28, 32, 35, 40, 50, 65, 75, 85, 90, 100, 135];
export const FORMATS: [string, number, number][] = [["Full frame (135)", 36, 24], ["Super 35, 3-perf", 24.89, 14], ["Super 35, 4-perf", 24.89, 18.66], ["Micro Four Thirds", 17.3, 13], ["APS-C", 23.5, 15.6], ["IMAX, 15-perf", 70.41, 52.63]];
export const ASPECTS: [string, number][] = [["2.39:1", 2.39], ["1.85:1", 1.85], ["16:9", 16 / 9], ["4:3", 4 / 3], ["1:1", 1]];

/** The base photo: 4:3, taken at a 24 mm equivalent. Half-angle tangents follow from the full-frame diagonal (workshop 02). */
export const PHOTO = { name: "Photo 0102", seed: 12, eq: 24, aspect: 4 / 3, tanH: 34.616 / (2 * 24), tanV: 25.962 / (2 * 24) };

export interface Frame { id: string; name: string; color: Colour; kind: "preset" | "free" | "aspect"; preset?: string; format: [number, number]; mult: number; squeeze: number; focal: number; delivery?: number; aspect: number; size: number; portrait: boolean; cx: number; cy: number; visible: boolean }
export const frameFrom = (p: Preset, focal: number, n: number): Frame => ({ id: `f${n}-${focal}-${Math.round(performance.now())}`, name: `${focal} mm`, color: (n % 8) + 1, kind: "preset", preset: p.id, format: p.format, mult: p.mult, squeeze: p.squeeze, focal, delivery: p.delivery, aspect: 2.39, size: 0.8, portrait: false, cx: 0.5, cy: 0.5, visible: true });

/** A frame's rectangle as fractions of the photo: what the optics see against what the photo sees, per axis. */
export function rectOf(f: Frame): { w: number; h: number; inner?: { w: number; h: number }; hfov?: number; vfov?: number; ffeq?: number } {
  if (f.kind === "aspect") { const w = f.size, h = (f.size * PHOTO.aspect) / f.aspect; return h > 1 ? { w: w / h, h: 1 } : { w, h }; }
  const eff = f.focal * f.mult;
  let tw = (f.format[0] * f.squeeze) / (2 * eff), th = f.format[1] / (2 * eff);
  if (f.portrait) [tw, th] = [th, tw];
  const w = tw / PHOTO.tanH, h = th / PHOTO.tanV;
  const out: ReturnType<typeof rectOf> = { w, h, hfov: (2 * Math.atan(tw) * 180) / Math.PI, vfov: (2 * Math.atan(th) * 180) / Math.PI, ffeq: 43.27 / (2 * Math.hypot(tw, th)) };
  if (f.delivery) { const a = (w * PHOTO.aspect) / h; out.inner = f.delivery > a ? { w, h: (h * a) / f.delivery } : { w: (w * f.delivery) / a, h }; }
  return out;
}
export const clampCentre = (c: number, size: number) => (size >= 1 ? 0.5 : Math.min(1 - size / 2, Math.max(size / 2, c)));

export type PenType = "pen" | "marker" | "highlighter" | "brush" | "dashed";
/** The kinds of pen: how wide a stroke is against the chosen width, how it ends, and how see-through it is. */
export const PENS: Record<PenType, { label: string; scale: number; opacity: number; cap: "round" | "butt"; dash?: string; taper?: boolean; blend?: string }> = {
  pen: { label: "Pen", scale: 1, opacity: 1, cap: "round" },
  marker: { label: "Marker", scale: 3, opacity: 0.9, cap: "butt" },
  highlighter: { label: "Highlighter", scale: 7, opacity: 0.4, cap: "butt", blend: "screen" },
  brush: { label: "Brush", scale: 4, opacity: 1, cap: "round", taper: true },
  dashed: { label: "Dashed", scale: 1, opacity: 1, cap: "round", dash: "2 14" },
};
export type Kind = "pen" | "line" | "arrow" | "rect" | "ellipse" | "text" | "stencil" | "picture" | "group";
export interface Look { exposure: number; contrast: number; saturation: number }
/**
 * Anything on the canvas. Its place in the list is its place in the stack (last = on top). x, y, w, h are fractions of
 * the surface. A group has no shape of its own: its children name it in `group`.
 */
export interface Obj {
  id: string; kind: Kind; name: string; x: number; y: number; w: number; h: number;
  /** Pen, line and arrow: points inside the box, 0..1. */
  pts?: [number, number][];
  stroke: Colour; fill?: Colour; width: number; opacity: number;
  text?: string; icon?: IconName; seed?: number; look?: Look;
  /** Rotation in degrees around the middle of its box. */
  rot?: number;
  /** Which pen a pen stroke was drawn with. */
  pen?: PenType;
  visible: boolean; locked: boolean; group?: string;
}
export const KIND: Record<Kind, { label: string; icon: IconName }> = {
  pen: { label: "Pen", icon: "pencil" }, line: { label: "Line", icon: "line-tool" }, arrow: { label: "Arrow", icon: "arrow-up-right" }, rect: { label: "Rectangle", icon: "square" }, ellipse: { label: "Ellipse", icon: "circle" },
  text: { label: "Text", icon: "text" }, stencil: { label: "Stencil", icon: "stencil" }, picture: { label: "Picture", icon: "image" }, group: { label: "Group", icon: "group" },
};
export const STENCILS: IconName[] = ["camera", "video", "light-fixture", "bulb", "sun", "moon", "user", "users", "flag", "microphone", "drone", "slate", "practical", "battery", "plug", "antenna", "pin", "building", "trees", "mountain", "wind", "cloud", "umbrella", "star", "lock", "eye"];
export const NO_LOOK: Look = { exposure: 0, contrast: 0, saturation: 0 };
export const lookFilter = (l: Look | undefined) => (l && (l.exposure || l.contrast || l.saturation) ? `brightness(${Math.pow(2, l.exposure).toFixed(3)}) contrast(${(1 + l.contrast).toFixed(2)}) saturate(${(1 + l.saturation).toFixed(2)})` : undefined);

const base = { stroke: "#ff2d2d" as Colour, width: 3, opacity: 1, visible: true, locked: false };
/** What the canvas opens with: a few marks on the harbour photo, so the layer list has something in it. */
export const START: Obj[] = [
  { ...base, id: "o1", kind: "ellipse", name: "Sun", x: 0.47, y: 0.39, w: 0.13, h: 0.17, stroke: 4 },
  { ...base, id: "o2", kind: "arrow", name: "Camera move", x: 0.2, y: 0.74, w: 0.3, h: 0.06, pts: [[0, 1], [1, 0]], stroke: "#ffffff" },
  { ...base, id: "o3", kind: "stencil", name: "Camera A", x: 0.14, y: 0.76, w: 0.06, h: 0.08, icon: "camera", stroke: "#ffffff" },
  { ...base, id: "o4", kind: "text", name: "Note", x: 0.52, y: 0.72, w: 0.3, h: 0.06, text: "Dolly in, 6 m", stroke: "#ffffff" },
];

/** A comment on the canvas: a point, or a region when w and h are set. Not an object: it is not part of the picture. */
export interface Comment { id: string; n: number; x: number; y: number; w?: number; h?: number; author: string; at: string; text: string; replies: { author: string; at: string; text: string }[]; resolved: boolean }
export const COMMENTS: Comment[] = [
  { id: "c1", n: 1, x: 0.535, y: 0.44, author: "Ben", at: "Yesterday 17:40", text: "Can we wait for the sun to sit lower? It should touch the roofline.", replies: [{ author: "Ada", at: "Yesterday 18:02", text: "About 20 minutes later. I'll note it on the shot." }], resolved: false },
  { id: "c2", n: 2, x: 0.08, y: 0.62, w: 0.26, h: 0.3, author: "Mara", at: "Today 09:15", text: "Is this corner clear for the dolly track? There was a fence last week.", replies: [], resolved: false },
];
