/**
 * How a canvas object is drawn (docs/features/canvas.md), for every renderer: the Studio's editor and render, and
 * a flow's stage on the phone (react-native-svg; docs/features/flows.md, "The stage"). Pure: points in, path data out.
 */
import type { PenType } from "./canvas.ts";

export type DrawPoint = [number, number];

/** The kinds of pen: how wide a stroke is against the chosen width, how it ends, how see-through it is. */
export const PENS: Record<PenType, { label: string; scale: number; opacity: number; cap: "round" | "butt"; dash?: number[]; taper?: boolean; blend?: string }> = {
  pen: { label: "Pen", scale: 1, opacity: 1, cap: "round" },
  marker: { label: "Marker", scale: 3, opacity: 0.9, cap: "butt" },
  highlighter: { label: "Highlighter", scale: 7, opacity: 0.4, cap: "butt", blend: "screen" },
  brush: { label: "Brush", scale: 4, opacity: 1, cap: "round", taper: true },
  dashed: { label: "Dashed", scale: 1, opacity: 1, cap: "round", dash: [2, 14] },
};

/** Stroke widths are thousandths of the surface's width, times this, so a drawing looks the same at any size. */
export const STROKE_UNIT = 1.3;
/** A text's letters are this share of its box's height. */
export const TEXT_SIZE = 0.78;

/** A stroke through its points with rounded corners: straight to the middle of each segment, curved around each point. */
export const smooth = (q: DrawPoint[]) => (q.length < 3 ? `M${q.map((x) => x.join(" ")).join(" L")}` : `M${q[0].join(" ")}` + q.slice(1, -1).map((x, i) => ` Q${x.join(" ")} ${((x[0] + q[i + 2][0]) / 2).toFixed(1)} ${((x[1] + q[i + 2][1]) / 2).toFixed(1)}`).join("") + ` L${q[q.length - 1].join(" ")}`);

/** A brush stroke as a filled shape: thin at both ends, full width in the middle. */
export function taper(q: DrawPoint[], width: number): string {
  if (q.length < 2) return "";
  const left: DrawPoint[] = [], right: DrawPoint[] = [];
  q.forEach((x, i) => {
    const a = q[Math.max(0, i - 1)], b = q[Math.min(q.length - 1, i + 1)], len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const n: DrawPoint = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len], w = (width / 2) * (0.15 + 0.85 * Math.sin((Math.PI * i) / (q.length - 1)));
    left.push([x[0] + n[0] * w, x[1] + n[1] * w]); right.push([x[0] - n[0] * w, x[1] - n[1] * w]);
  });
  return `M${[...left, ...right.reverse()].map((x) => `${x[0].toFixed(1)} ${x[1].toFixed(1)}`).join(" L")}Z`;
}

/** An arrow's head at the end of a line from a to b, as a closed path, for a stroke of width `sw` (the render's shape). */
export function arrowHead(a: DrawPoint, b: DrawPoint, sw: number): string {
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), len = 5 * sw, c = Math.cos(ang), s = Math.sin(ang);
  const tip: DrawPoint = [b[0] + c * 0.75 * sw, b[1] + s * 0.75 * sw];
  const l: DrawPoint = [tip[0] - c * len + (s * len) / 2, tip[1] - s * len - (c * len) / 2];
  const r: DrawPoint = [tip[0] - c * len - (s * len) / 2, tip[1] - s * len + (c * len) / 2];
  const f = (q: DrawPoint) => `${q[0].toFixed(1)} ${q[1].toFixed(1)}`;
  return `M${f(tip)} L${f(l)} L${f(r)}Z`;
}
