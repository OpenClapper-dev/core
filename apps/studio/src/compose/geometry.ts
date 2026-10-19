/**
 * Mapping between drawing coordinates (fractions of the canvas: the raw photo, or the sketch box)
 * and screen pixels, plus hit testing. The SVG editor, the read-only canvas and the flattened
 * render all go through `CanvasRect`, so a stroke lands on the same pixel everywhere.
 */
import { shapeBounds, type Point, type Shape } from "@fielder/vocab";

/** Where the canvas (photo or sketch box) sits inside the drawing surface, in px. */
export interface CanvasRect { x: number; y: number; w: number; h: number }

export const toPx = (p: Point, c: CanvasRect): [number, number] => [c.x + p[0] * c.w, c.y + p[1] * c.h];
export const toFrac = (x: number, y: number, c: CanvasRect): Point => [(x - c.x) / c.w, (y - c.y) / c.h];
/** Stroke width in px: fractions of the canvas width. */
export const strokePx = (width: number, c: CanvasRect) => Math.max(width * c.w, 0.5);
/** Text and stencil size in px: fractions of the canvas height. */
export const sizePx = (size: number, c: CanvasRect) => size * c.h;
/** Arrow head length in px for a stroke. */
export const arrowHead = (strokeW: number) => Math.max(10, strokeW * 4);

const distToSegment = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

/** True when the screen point (px) is on the shape's stroke, or inside a filled shape / text / stencil. */
export function hitShape(s: Shape, x: number, y: number, c: CanvasRect): boolean {
  const tol = Math.max(7, strokePx(s.width, c) / 2 + 4);
  switch (s.type) {
    case "path": {
      const pts = s.points.map((p) => toPx(p, c));
      if (pts.length === 1) return Math.hypot(x - pts[0][0], y - pts[0][1]) <= tol;
      for (let i = 1; i < pts.length; i++) if (distToSegment(x, y, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) <= tol) return true;
      return false;
    }
    case "line": case "arrow": {
      const [ax, ay] = toPx(s.from, c), [bx, by] = toPx(s.to, c);
      return distToSegment(x, y, ax, ay, bx, by) <= tol;
    }
    case "rect": {
      const [ax, ay] = toPx(s.from, c), [bx, by] = toPx(s.to, c);
      const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), y0 = Math.min(ay, by), y1 = Math.max(ay, by);
      const inside = x >= x0 - tol && x <= x1 + tol && y >= y0 - tol && y <= y1 + tol;
      if (!inside) return false;
      if (s.fill) return true;
      return x <= x0 + tol || x >= x1 - tol || y <= y0 + tol || y >= y1 - tol;
    }
    case "ellipse": {
      const [ax, ay] = toPx(s.from, c), [bx, by] = toPx(s.to, c);
      const cx = (ax + bx) / 2, cy = (ay + by) / 2, rx = Math.abs(bx - ax) / 2, ry = Math.abs(by - ay) / 2;
      if (rx < 1 || ry < 1) return Math.hypot(x - cx, y - cy) <= tol;
      const d = Math.hypot((x - cx) / rx, (y - cy) / ry); // 1 on the boundary
      const band = tol / Math.min(rx, ry);
      return s.fill ? d <= 1 + band : Math.abs(d - 1) <= band;
    }
    case "text": case "stencil": {
      const b = shapeBounds(s, c.w / c.h);
      const [x0, y0] = toPx([b.x0, b.y0], c), [x1, y1] = toPx([b.x1, b.y1], c);
      return x >= x0 - tol && x <= x1 + tol && y >= y0 - tol && y <= y1 + tol;
    }
  }
}

/** The topmost shape under a screen point, or null. */
export function shapeAt(shapes: readonly Shape[], x: number, y: number, c: CanvasRect): Shape | null {
  for (let i = shapes.length - 1; i >= 0; i--) if (hitShape(shapes[i], x, y, c)) return shapes[i];
  return null;
}

/** Bounds of a shape in px (for the selection outline). */
export function boundsPx(s: Shape, c: CanvasRect): { x: number; y: number; w: number; h: number } {
  const b = shapeBounds(s, c.w / c.h);
  const [x0, y0] = toPx([b.x0, b.y0], c), [x1, y1] = toPx([b.x1, b.y1], c);
  const pad = strokePx(s.width, c) / 2 + 4;
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
}
