// Fake data and the small rules of the U3 prototype (shot, set and location windows): what a shot's progression is,
// which canvases have frames, and how a picture is seen through a frame. Nothing here is product code.
// Specified in docs/rewrite/04-shots.md, 09a-places.md and i1-interjection.md.
import { FILES, type FileRec } from "../u1/data";
import { PRESETS, type Preset } from "../u2/model";

/** A frame as a canvas stores it: optics values (or only an aspect) and where it sits on the base photo. */
export interface Fr { id: string; name: string; color: number; preset?: string; format?: [number, number]; mult?: number; squeeze?: number; focal?: number; delivery?: number; aspect?: number; cx: number; cy: number }
/** What the prototype knows of a canvas: its base photo, its frames, and which frame is the picture. */
export interface Doc { base?: string; frames: Fr[]; picture?: string }
/** A reference to a picture: a photo, a canvas, or one frame of a canvas. */
export interface Ref { file: string; frame?: string }
export interface Item extends Ref { id: string; hold: number }
/** The default frame of a progression: optics values or an aspect, applied centred. */
export type DefFrame = { kind: "preset"; preset: string; focal: number } | { kind: "aspect"; aspect: number };
export interface Prog { items: Item[]; timing: "each" | "even" | "ends"; total: number; overlay: { file: string; visible: boolean } | null; frame: DefFrame | null }

export const fromPreset = (p: Preset, focal: number, n: number, cx = 0.5, cy = 0.5): Fr => ({ id: `${p.id}-${focal}-${n}`, name: `${focal} mm`, color: (n % 8) + 1, preset: p.id, format: p.format, mult: p.mult, squeeze: p.squeeze, focal, delivery: p.delivery, cx, cy });

/** The full-frame equivalent a photo was taken at, from its facts; undefined = no angle of view. */
export const eqOf = (f: FileRec | undefined) => { const m = f?.facts?.find(([k]) => k === "Lens")?.[1].match(/^(\d+)/); return m ? Number(m[1]) : undefined; };
/** A frame's rectangle as fractions of a 4:3 photo taken at `eq` mm equivalent (workshop 02). */
export function rect(f: Fr, eq: number): { w: number; h: number; inner?: { w: number; h: number } } {
  if (f.aspect && !f.format) { const w = 0.9, h = (w * (4 / 3)) / f.aspect; return h > 0.9 ? { w: (w * 0.9) / h, h: 0.9 } : { w, h }; }
  const eff = f.focal! * (f.mult ?? 1), w = (f.format![0] * (f.squeeze ?? 1)) / (2 * eff) / (34.616 / (2 * eq)), h = f.format![1] / (2 * eff) / (25.962 / (2 * eq));
  if (!f.delivery) return { w, h };
  const a = (w * (4 / 3)) / h;
  return { w, h, inner: f.delivery > a ? { w, h: (h * a) / f.delivery } : { w: (w * f.delivery) / a, h } };
}
export const frameOfDefault = (d: DefFrame): Fr => (d.kind === "aspect" ? { id: "default", name: "Default frame", color: 6, aspect: d.aspect, cx: 0.5, cy: 0.5 } : { ...fromPreset(PRESETS.find((p) => p.id === d.preset)!, d.focal, 5), id: "default", name: "Default frame" });
export const describe = (d: DefFrame) => (d.kind === "aspect" ? `${Math.round(d.aspect * 100) / 100}:1` : `${PRESETS.find((p) => p.id === d.preset)!.name} · ${d.focal} mm`);

/** How long each item holds: its own time, or its share of one total (evenly, or with the first and last held twice as long). */
export function holds(p: Prog): number[] {
  if (p.timing === "each") return p.items.map((i) => i.hold);
  const w = p.items.map((_, i) => (p.timing === "ends" && p.items.length > 2 && (i === 0 || i === p.items.length - 1) ? 2 : 1)), sum = w.reduce((a, b) => a + b, 0) || 1;
  return w.map((x) => (p.total * x) / sum);
}
export const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}${s % 1 ? `.${Math.round((s % 1) * 10)}` : ""}`;

const P6K = PRESETS[0];
/** Canvases of the fake project that have a base photo and frames. Canvas 02 is a project file; the others are internal files of shots. */
export const DOCS: Record<string, Doc> = {
  cv2: { base: "ph102", frames: [fromPreset(P6K, 18, 0), fromPreset(P6K, 24, 1), fromPreset(P6K, 35, 2)], picture: `${P6K.id}-35-2` },
  "s2-series": { base: "ph105", frames: [18, 21, 24, 28, 35].map((mm, i) => fromPreset(P6K, mm, i)) },
};

const made = { created: "2026-11-09 11:20", by: "Ada", props: {} };
/** The project of U1, plus what U3 needs: internal files of two shots and a photo that was binned while a shot still names it. */
export const START_FILES: FileRec[] = [
  ...FILES.map((f) => (f.id === "s1" ? { ...f, content: ["cv2", "ph103", "b1"] } : f.id === "s2" ? { ...f, content: ["ph105", "cv5"] } : f)),
  { ...made, id: "s2-series", type: "canvas", name: "Framing series", pic: 15, internalOf: "s2", facts: [["Surface", "Photo 0105"], ["Frames", "5"]] },
  { ...made, id: "s2-overlay", type: "canvas", name: "Overlay", internalOf: "s2", facts: [["Surface", "Blank"], ["Layers", "2"]] },
];
export const START_PROGS: Record<string, Prog> = {
  s1: { items: [{ id: "i1", file: "ph101", hold: 2 }, { id: "i2", file: "ph102", hold: 1.5 }, { id: "i3", file: "ph105", hold: 3 }], timing: "each", total: 6.5, overlay: null, frame: { kind: "preset", preset: P6K.id, focal: 24 } },
  s2: { items: DOCS["s2-series"].frames.map((f, i) => ({ id: `g${i}`, file: "s2-series", frame: f.id, hold: 1 })), timing: "ends", total: 6, overlay: { file: "s2-overlay", visible: true }, frame: null },
};
/** The windows the prototype bar offers. */
export const TABS = ["s2", "s1", "s5", "s9", "set3", "loc2"];
