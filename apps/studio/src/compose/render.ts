/**
 * Flattened renders. A step's bake (epic #275) is the raw photo at its stored size with the layers
 * the step shows on top, so the phone frames it exactly like the photo. A sketch render is the
 * canvas on white. Both draw the same shapes as the SVG (Canvas.tsx), on a 2D context.
 */
import { lookFilter, withCentre, type Drawing, type Frame, type Layer, type Look, type Shape } from "@openclapper/vocab";
import type { Photo } from "../api";
import { arrowPoints } from "./Canvas";
import { arrowHead, sizePx, strokePx, toPx, type CanvasRect } from "./geometry";
import { STENCIL_BOX, STENCIL_PATHS, STENCIL_STROKE } from "./stencils";

const FONT = "'Atkinson Hyperlegible Next', system-ui, sans-serif";
export const SKETCH_RENDER_WIDTH = 1600;
export const SKETCH_BG = "#FFFFFF";
/** Blur radius at 1.0, as a fraction of the canvas width (same on screen and in the render). */
export const BLUR_FRACTION = 0.02;

export function drawShapes(ctx: CanvasRenderingContext2D, shapes: readonly Shape[], c: CanvasRect) {
  for (const s of shapes) {
    if (!s.mask?.length) { drawShape(ctx, s, c); continue; }
    // A masked shape is drawn on its own layer, its mask strokes cut out of it, then the layer is laid on.
    const layer = document.createElement("canvas");
    layer.width = ctx.canvas.width; layer.height = ctx.canvas.height;
    const lc = layer.getContext("2d")!;
    drawShape(lc, s, c);
    lc.globalCompositeOperation = "destination-out";
    lc.lineCap = "round"; lc.lineJoin = "round";
    for (const m of s.mask) {
      const w = strokePx(m.width, c);
      lc.lineWidth = w;
      lc.beginPath();
      if (m.points.length === 1) { const [x, y] = toPx(m.points[0], c); lc.arc(x, y, w / 2, 0, Math.PI * 2); lc.fill(); continue; }
      m.points.forEach((p, i) => { const [x, y] = toPx(p, c); if (i === 0) lc.moveTo(x, y); else lc.lineTo(x, y); });
      lc.stroke();
    }
    ctx.drawImage(layer, 0, 0);
  }
}

function drawShape(ctx: CanvasRenderingContext2D, s: Shape, c: CanvasRect) {
  {
    ctx.save();
    ctx.globalAlpha = s.opacity;
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const sw = strokePx(s.width, c);
    ctx.lineWidth = sw;
    switch (s.type) {
      case "path": {
        if (s.points.length === 1) { const [x, y] = toPx(s.points[0], c); ctx.beginPath(); ctx.arc(x, y, sw / 2, 0, Math.PI * 2); ctx.fill(); break; }
        ctx.beginPath();
        s.points.forEach((p, i) => { const [x, y] = toPx(p, c); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
        ctx.stroke();
        break;
      }
      case "line": { const [ax, ay] = toPx(s.from, c), [bx, by] = toPx(s.to, c); ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); break; }
      case "arrow": {
        const [ax, ay] = toPx(s.from, c), [bx, by] = toPx(s.to, c);
        const len = arrowHead(sw) * 0.6, ang = Math.atan2(by - ay, bx - ax);
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx - len * Math.cos(ang), by - len * Math.sin(ang)); ctx.stroke();
        const head = arrowPoints(ax, ay, bx, by, sw);
        ctx.beginPath(); head.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y))); ctx.closePath();
        ctx.lineWidth = sw / 2; ctx.fill(); ctx.stroke();
        break;
      }
      case "rect": {
        const [ax, ay] = toPx(s.from, c), [bx, by] = toPx(s.to, c);
        const x = Math.min(ax, bx), y = Math.min(ay, by), w = Math.abs(bx - ax), h = Math.abs(by - ay);
        if (s.fill) ctx.fillRect(x, y, w, h); else ctx.strokeRect(x, y, w, h);
        break;
      }
      case "ellipse": {
        const [ax, ay] = toPx(s.from, c), [bx, by] = toPx(s.to, c);
        ctx.beginPath(); ctx.ellipse((ax + bx) / 2, (ay + by) / 2, Math.abs(bx - ax) / 2, Math.abs(by - ay) / 2, 0, 0, Math.PI * 2);
        if (s.fill) ctx.fill(); else ctx.stroke();
        break;
      }
      case "text": {
        const [x, y] = toPx(s.at, c);
        const px = sizePx(s.size, c);
        ctx.font = `700 ${px}px ${FONT}`;
        ctx.textBaseline = "alphabetic";
        ctx.lineJoin = "round";
        ctx.lineWidth = px * 0.08;
        ctx.strokeStyle = s.color === "#0B0B0C" ? "#FFFFFF" : "#0B0B0C";
        ctx.strokeText(s.text, x, y);
        ctx.fillText(s.text, x, y);
        break;
      }
      case "stencil": {
        const [x, y] = toPx(s.at, c);
        const k = sizePx(s.size, c) / STENCIL_BOX;
        ctx.translate(x, y); ctx.rotate((s.rotation * Math.PI) / 180); ctx.scale(k, k); ctx.translate(-STENCIL_BOX / 2, -STENCIL_BOX / 2);
        ctx.lineWidth = STENCIL_STROKE;
        ctx.stroke(new Path2D(STENCIL_PATHS[s.stencil]));
        break;
      }
    }
    ctx.restore();
  }
}

/** Look passes after the photo: tint layer and vignette (the filter itself is applied while drawing the image). */
export function drawLookLayers(ctx: CanvasRenderingContext2D, look: Look, w: number, h: number) {
  if (look.tint && look.tint_opacity > 0) { ctx.save(); ctx.globalAlpha = look.tint_opacity; ctx.fillStyle = look.tint; ctx.fillRect(0, 0, w, h); ctx.restore(); }
  if (look.vignette > 0) {
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) / 2);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, `rgba(0,0,0,${look.vignette.toFixed(3)})`);
    ctx.save(); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); ctx.restore();
  }
}

/** CSS for the vignette layer on screen; matches `drawLookLayers`. */
export const vignetteCss = (v: number) => `radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(0,0,0,${v.toFixed(3)}) 100%)`;

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("render failed"))), type, quality));

/**
 * A step's bake: the photo at its stored size, then the step's layers bottom to top. Layers below
 * the footage are covered by the photo (they only show beyond it, which a photo-sized image has no
 * room for). An adjustment layer re-draws what is there through its look, blended by its opacity;
 * a drawing layer is drawn on its own canvas, then laid on with its opacity. Frame-space layers sit
 * in (and are cut at) the frame rect; photo-space layers span the photo.
 */
export async function renderStep(photo: Photo, frame: Frame | null, layers: readonly Layer[]): Promise<Blob> {
  const res = await fetch(photo.image_url, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`photo ${res.status}`);
  const bitmap = await createImageBitmap(await res.blob());
  const w = bitmap.width, h = bitmap.height;
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const full: CanvasRect = { x: 0, y: 0, w, h };
  const fr = frame ? withCentre(frame) : null;
  const frameRect: CanvasRect = fr ? { x: (fr.x - fr.width_fraction / 2) * w, y: (fr.y - fr.height_fraction / 2) * h, w: fr.width_fraction * w, h: fr.height_fraction * h } : full;
  for (const l of layers) {
    if (l.position < 0) continue;
    const c = l.space === "photo" ? full : frameRect;
    ctx.save();
    if (l.space === "frame") { ctx.beginPath(); ctx.rect(c.x, c.y, c.w, c.h); ctx.clip(); }
    if (l.kind === "adjustment" && l.look) {
      const look = l.look;
      const under = document.createElement("canvas");
      under.width = w; under.height = h;
      under.getContext("2d")!.drawImage(canvas, 0, 0);
      ctx.globalAlpha = l.opacity;
      ctx.filter = lookFilter(look, c.w * BLUR_FRACTION);
      ctx.drawImage(under, 0, 0);
      ctx.filter = "none";
      if (look.tint && look.tint_opacity > 0) { ctx.globalAlpha = l.opacity * look.tint_opacity; ctx.fillStyle = look.tint; ctx.fillRect(c.x, c.y, c.w, c.h); }
      if (look.vignette > 0) {
        ctx.globalAlpha = l.opacity;
        const g = ctx.createRadialGradient(c.x + c.w / 2, c.y + c.h / 2, Math.min(c.w, c.h) * 0.35, c.x + c.w / 2, c.y + c.h / 2, Math.hypot(c.w, c.h) / 2);
        g.addColorStop(0, "rgba(0,0,0,0)");
        g.addColorStop(1, `rgba(0,0,0,${look.vignette.toFixed(3)})`);
        ctx.fillStyle = g; ctx.fillRect(c.x, c.y, c.w, c.h);
      }
    } else if (l.kind === "drawing" && l.shapes?.length) {
      const own = document.createElement("canvas");
      own.width = w; own.height = h;
      drawShapes(own.getContext("2d")!, l.shapes, c);
      ctx.globalAlpha = l.opacity;
      ctx.drawImage(own, 0, 0);
    }
    ctx.restore();
  }
  return toBlob(canvas, "image/jpeg", 0.9);
}

/** The sketch canvas on white, 1600 px wide, as PNG (crisp lines). */
export async function renderSketch(drawing: Drawing, aspect: number): Promise<Blob> {
  const w = SKETCH_RENDER_WIDTH, h = Math.round(w / aspect);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = SKETCH_BG;
  ctx.fillRect(0, 0, w, h);
  drawShapes(ctx, drawing.shapes, { x: 0, y: 0, w, h });
  return toBlob(canvas, "image/png");
}
