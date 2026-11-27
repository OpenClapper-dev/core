// The render of a canvas (docs/features/canvas.md): the whole surface flattened (base photo with its look,
// every visible object), drawn on a 2D canvas with the editor's geometry and uploaded with each save, with
// a thumbnail. Comments and frames are never part of it; viewers apply a frame themselves.
import { GLYPHS } from "@openclapper/design/glyphs";
import { arrowHead, type CanvasBody, type Colour } from "@openclapper/model";
import { lookFilter, PENS, smooth, taper, toEdit, type BasePhoto, type Obj, type P } from "./geometry";

/** A colour as the 2D canvas takes it: the design system's categorical colours are read from the page's tokens. */
function paint(c: Colour | null | undefined): string {
  if (typeof c === "string") return c;
  const v = getComputedStyle(document.documentElement).getPropertyValue(c ? `--cat-${c}` : "--text-secondary").trim();
  return v || "#ffffff";
}

const images = new Map<string, Promise<HTMLImageElement | null>>();
function load(src: string): Promise<HTMLImageElement | null> {
  let p = images.get(src);
  if (!p) {
    p = new Promise((resolve) => { const img = new Image(); img.decoding = "async"; img.onload = () => resolve(img); img.onerror = () => resolve(null); img.src = src; });
    images.set(src, p);
  }
  return p;
}
const glyph = (name: string, colour: string) => {
  const g = (GLYPHS as Record<string, readonly [string, string]>)[name] ?? GLYPHS.camera;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="240" height="240" fill="none" stroke="${colour}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${g[1]}</svg>`)}`;
};

export interface RenderInput { body: CanvasBody; base: BasePhoto | null; photoSrc: (id: string) => string }
/** A part of the surface, in fractions of it: what a thumbnail of a canvas with a picture shows (Crop). */
export interface Crop { x: number; y: number; w: number; h: number }

/**
 * Draws the canvas at `longEdge` pixels on its long side, as a JPEG (photo surface) or PNG (blank); with
 * `crop`, only that part of the surface, at `longEdge` on its long side.
 */
export async function renderCanvas(inp: RenderInput, longEdge: number, crop?: Crop): Promise<Blob> {
  const { body, base } = inp;
  const aspect = body.surface.kind === "photo" ? base?.aspect ?? 4 / 3 : body.surface.aspect;
  const want = longEdge;
  if (crop) longEdge = Math.min(4096, Math.round(longEdge / Math.max(crop.w, crop.h)));
  const W = Math.round(aspect >= 1 ? longEdge : longEdge * aspect), H = Math.round(aspect >= 1 ? longEdge / aspect : longEdge);
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const g = cv.getContext("2d")!;
  // The surface.
  if (body.surface.kind === "blank") { if (body.surface.color !== null) { g.fillStyle = paint(body.surface.color); g.fillRect(0, 0, W, H); } }
  else {
    g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
    const img = base ? await load(base.src) : null;
    if (img) { g.filter = lookFilter(body.surface.look) ?? "none"; g.drawImage(img, 0, 0, W, H); g.filter = "none"; }
  }
  const objs = body.objects.map(toEdit);
  const byId = new Map(objs.map((o) => [o.id, o]));
  const shown = (o: Obj) => o.visible && (!o.group || byId.get(o.group)?.visible !== false);
  const unit = W / 1000; // stroke widths are in thousandths of the surface's width, as in the editor
  for (const o of objs) {
    if (o.kind === "group" || !shown(o)) continue;
    g.save();
    const cx = (o.x + o.w / 2) * W, cy = (o.y + o.h / 2) * H;
    if (o.rot) { g.translate(cx, cy); g.rotate((o.rot * Math.PI) / 180); g.translate(-cx, -cy); }
    g.globalAlpha = o.opacity;
    const colour = paint(o.stroke);
    if (o.kind === "pen" || o.kind === "line" || o.kind === "arrow") {
      const q = (o.pts ?? []).map((p): P => [(o.x + p[0] * o.w) * W, (o.y + p[1] * o.h) * H]);
      const pen = PENS[o.pen ?? "pen"];
      const sw = o.width * 1.3 * (o.kind === "pen" ? pen.scale : 1) * unit;
      if (o.kind === "pen") { g.globalAlpha = o.opacity * pen.opacity; if (pen.blend) g.globalCompositeOperation = pen.blend as GlobalCompositeOperation; }
      if (o.kind === "pen" && pen.taper) { g.fillStyle = colour; g.fill(new Path2D(taper(q, sw))); }
      else if (q.length > 1) {
        g.strokeStyle = colour; g.lineWidth = sw; g.lineJoin = "round"; g.lineCap = o.kind === "pen" ? pen.cap : "round";
        if (o.kind === "pen" && pen.dash) g.setLineDash(pen.dash.map((d) => d * unit));
        g.stroke(new Path2D(o.kind === "pen" ? smooth(q) : `M${q.map((x) => x.join(" ")).join(" L")}`));
        if (o.kind === "arrow") { g.setLineDash([]); g.fillStyle = colour; g.fill(new Path2D(arrowHead(q[q.length - 2], q[q.length - 1], sw))); }
      }
    } else if (o.kind === "rect" || o.kind === "ellipse") {
      const x = o.x * W, y = o.y * H, w = o.w * W, h = o.h * H, bw = o.width * 1.3 * unit;
      g.beginPath();
      if (o.kind === "rect") g.rect(x + bw / 2, y + bw / 2, Math.max(0, w - bw), Math.max(0, h - bw));
      else g.ellipse(x + w / 2, y + h / 2, Math.max(0, w / 2 - bw / 2), Math.max(0, h / 2 - bw / 2), 0, 0, Math.PI * 2);
      if (o.fill != null) { g.fillStyle = paint(o.fill); g.fill(); }
      g.strokeStyle = colour; g.lineWidth = bw; g.stroke();
    } else if (o.kind === "text") {
      const size = o.h * 0.78 * H;
      g.font = `700 ${size}px ${getComputedStyle(document.documentElement).getPropertyValue("--font-sans").trim() || "sans-serif"}`;
      g.textBaseline = "middle"; g.fillStyle = colour; g.shadowColor = "rgba(0,0,0,.55)"; g.shadowBlur = 2 * unit;
      (o.text ?? "").split("\n").forEach((line, i, all) => g.fillText(line, o.x * W, (o.y + o.h / 2) * H + (i - (all.length - 1) / 2) * size * 1.05));
    } else if (o.kind === "stencil") {
      const img = await load(glyph(o.icon ?? "camera", colour));
      if (img) { g.shadowColor = "rgba(0,0,0,.6)"; g.shadowBlur = unit; g.drawImage(img, o.x * W, o.y * H, o.w * W, o.h * H); }
    } else if (o.kind === "picture" && o.photo) {
      const img = await load(inp.photoSrc(o.photo));
      const x = o.x * W, y = o.y * H, w = o.w * W, h = o.h * H;
      if (img) {
        // Cover the box, as the editor shows it.
        const k = Math.max(w / img.naturalWidth, h / img.naturalHeight), sw = w / k, sh = h / k;
        g.filter = lookFilter(o.look) ?? "none";
        g.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, x, y, w, h);
        g.filter = "none";
      }
      g.strokeStyle = "rgba(255,255,255,.7)"; g.lineWidth = Math.max(1, unit); g.strokeRect(x, y, w, h);
    }
    g.restore();
  }
  let out = cv;
  if (crop) {
    const sw = crop.w * W, sh = crop.h * H;
    out = document.createElement("canvas");
    const k = want / Math.max(sw, sh);
    out.width = Math.max(1, Math.round(sw * k)); out.height = Math.max(1, Math.round(sh * k));
    out.getContext("2d")!.drawImage(cv, crop.x * W, crop.y * H, sw, sh, 0, 0, out.width, out.height);
  }
  return new Promise((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error("the render could not be made"))), body.surface.kind === "photo" ? "image/jpeg" : "image/png", 0.9));
}
