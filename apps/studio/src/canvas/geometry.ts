// What the canvas editor and its renderer share (docs/features/canvas.md): the editing shape of an object
// (points as pairs), the kinds of pen, stroke paths, and where a frame sits on the photo. Pure, no DOM.
import { aspectFrame, opticsFrame, opticsView, type FrameSize, type PhotoView } from "@openclapper/fov-math";
import type { CanvasBody, CanvasFrame, CanvasObject, Look, PenType, PresetBody } from "@openclapper/model";
import { frameOptics } from "../optics";

export type P = [number, number];
/** An object as the editor holds it: points as pairs instead of the stored flat list. */
export type Obj = Omit<CanvasObject, "pts"> & { pts?: P[] };

export const toEdit = (o: CanvasObject): Obj => ({ ...o, pts: o.pts ? Array.from({ length: o.pts.length / 2 }, (_, i): P => [o.pts![2 * i], o.pts![2 * i + 1]]) : undefined });
const r4 = (v: number) => Math.round(v * 10000) / 10000;
/** Back to the stored shape: points flat and rounded to 4 decimals, so a canvas with many strokes stays small. */
export const toStore = (o: Obj): CanvasObject => {
  const { pts, ...rest } = o;
  const out: CanvasObject = { ...rest, x: r4(o.x), y: r4(o.y), w: r4(o.w), h: r4(o.h) };
  if (pts) out.pts = pts.flatMap((q) => [r4(q[0]), r4(q[1])]);
  for (const k of Object.keys(out) as (keyof CanvasObject)[]) if (out[k] === undefined) delete out[k];
  return out;
};

export const NO_LOOK: Look = { exposure: 0, contrast: 0, saturation: 0 };
export const lookFilter = (l: Look | undefined) => (l && (l.exposure || l.contrast || l.saturation) ? `brightness(${Math.pow(2, l.exposure).toFixed(3)}) contrast(${(1 + l.contrast).toFixed(2)}) saturate(${(1 + l.saturation).toFixed(2)})` : undefined);

/** The kinds of pen: how wide a stroke is against the chosen width, how it ends, how see-through it is. */
export const PENS: Record<PenType, { label: string; scale: number; opacity: number; cap: "round" | "butt"; dash?: number[]; taper?: boolean; blend?: string }> = {
  pen: { label: "Pen", scale: 1, opacity: 1, cap: "round" },
  marker: { label: "Marker", scale: 3, opacity: 0.9, cap: "butt" },
  highlighter: { label: "Highlighter", scale: 7, opacity: 0.4, cap: "butt", blend: "screen" },
  brush: { label: "Brush", scale: 4, opacity: 1, cap: "round", taper: true },
  dashed: { label: "Dashed", scale: 1, opacity: 1, cap: "round", dash: [2, 14] },
};

/** A stroke through its points with rounded corners: straight to the middle of each segment, curved around each point. */
export const smooth = (q: P[]) => (q.length < 3 ? `M${q.map((x) => x.join(" ")).join(" L")}` : `M${q[0].join(" ")}` + q.slice(1, -1).map((x, i) => ` Q${x.join(" ")} ${((x[0] + q[i + 2][0]) / 2).toFixed(1)} ${((x[1] + q[i + 2][1]) / 2).toFixed(1)}`).join("") + ` L${q[q.length - 1].join(" ")}`);
/** A brush stroke as a filled shape: thin at both ends, full width in the middle. */
export function taper(q: P[], width: number): string {
  if (q.length < 2) return "";
  const left: P[] = [], right: P[] = [];
  q.forEach((x, i) => {
    const a = q[Math.max(0, i - 1)], b = q[Math.min(q.length - 1, i + 1)], len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const n: P = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len], w = (width / 2) * (0.15 + 0.85 * Math.sin((Math.PI * i) / (q.length - 1)));
    left.push([x[0] + n[0] * w, x[1] + n[1] * w]); right.push([x[0] - n[0] * w, x[1] - n[1] * w]);
  });
  return `M${[...left, ...right.reverse()].map((x) => `${x[0].toFixed(1)} ${x[1].toFixed(1)}`).join(" L")}Z`;
}

/** The base photo as the canvas needs it: its picture, pixel aspect and angle of view (null: no optics frames). */
export interface BasePhoto { id: string; name: string; src: string; aspect: number; view: PhotoView | null }

/** The context a frame is measured in. */
export interface FrameCtx { base: BasePhoto | null; presets: ReadonlyMap<string, PresetBody> }

/** A frame's rectangle as fractions of the photo, its delivery's inner rectangle and what it sees; null when it cannot be drawn (no angle of view, preset gone). */
export function rectOf(f: CanvasFrame, ctx: FrameCtx): (FrameSize & { hfov?: number; vfov?: number; ffeq?: number }) | null {
  if (!ctx.base) return null;
  if (f.kind === "aspect") return aspectFrame(f.aspect ?? 2.39, f.size ?? 0.8, ctx.base.aspect);
  const o = frameOptics(f, ctx.presets);
  if (!o || !ctx.base.view) return null;
  const v = opticsView(o);
  return { ...opticsFrame(o, ctx.base.view), hfov: v.horizontal, vfov: v.vertical, ffeq: v.fullFrame };
}

export const clampCentre = (c: number, size: number) => (size >= 1 ? 0.5 : Math.min(1 - size / 2, Math.max(size / 2, c)));

/** The frame the canvas stands for, when it can be drawn. */
export const pictureOf = (b: CanvasBody, ctx: FrameCtx) => { const f = b.frames.find((x) => x.id === b.picture && x.visible); return f && rectOf(f, ctx) ? f : null; };
