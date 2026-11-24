import { opticsFrame, type Optics, type PhotoView } from "@openclapper/fov-math";
import type { CanvasBody, CanvasFrame, PresetBody } from "@openclapper/model";
import type { FileRec } from "./api";
import { imageUrl } from "./media";

/**
 * Optics presets and frames in the Studio (docs/features/canvas.md): the presets of a project, which
 * of their focal lengths frames use, the optics of a frame, and the pictures a preset is previewed on.
 */
export interface Preset { id: string; name: string; body: PresetBody; file: FileRec }

export const presetsIn = (files: readonly FileRec[] | null): Preset[] =>
  (files ?? []).filter((f) => f.type === "preset" && f.body).map((f) => ({ id: f.id, name: f.name, body: f.body as unknown as PresetBody, file: f }))
    .sort((a, b) => Number(a.body.archived) - Number(b.body.archived) || a.name.localeCompare(b.name, undefined, { numeric: true }));

/** Which focal lengths of each preset the canvases of the project use (the server checks the same with its frames table). */
export function usedFocals(files: readonly FileRec[] | null): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  for (const f of files ?? []) {
    if (f.type !== "canvas" || !f.body) continue;
    for (const fr of (f.body as unknown as CanvasBody).frames ?? []) {
      if (fr.kind !== "preset" || !fr.preset || !fr.focal) continue;
      out.set(fr.preset, (out.get(fr.preset) ?? new Set()).add(fr.focal));
    }
  }
  return out;
}

/** The optics a frame sees: its preset's values with its focal length, or its own; null for an aspect frame or a preset that is gone. */
export function frameOptics(f: CanvasFrame, presets: ReadonlyMap<string, PresetBody>): Optics | null {
  if (f.kind === "aspect") return null;
  if (f.kind === "preset") {
    const p = f.preset ? presets.get(f.preset) : undefined;
    if (!p || !f.focal) return null;
    return { format: p.format, multiplier: p.multiplier, squeeze: p.squeeze, focal: f.focal, delivery: p.delivery, portrait: f.portrait };
  }
  if (!f.format || !f.focal) return null;
  return { format: f.format, multiplier: f.multiplier ?? 1, squeeze: f.squeeze ?? 1, focal: f.focal, delivery: f.delivery ?? null, portrait: f.portrait };
}

/** A picture to preview a preset on: an image, its angle of view and its aspect (width / height). */
export interface Example { id: string; label: string; src: string; view: PhotoView; aspect: number }

/**
 * The test chart: a picture "taken" at 14 mm on full frame (104° × 81°, 3:2), with the frames of the
 * usual full-frame focal lengths drawn on it, so a preset can be previewed in an empty project. The
 * example photos of docs/rewrite/optics-example-photos.md replace it once they are shot.
 */
export const CHART: Example = (() => {
  const W = 1500, H = 1000, view = { horizontal: (2 * Math.atan(36 / 28) * 180) / Math.PI, vertical: (2 * Math.atan(24 / 28) * 180) / Math.PI };
  const rects = [24, 35, 50, 85, 135].map((mm) => {
    const fr = opticsFrame({ format: [36, 24], multiplier: 1, squeeze: 1, focal: mm }, view);
    const w = fr.w * W, h = fr.h * H;
    return `<rect x="${(W - w) / 2}" y="${(H - h) / 2}" width="${w}" height="${h}" fill="none" stroke="#9aa3b5" stroke-width="2"/><text x="${(W - w) / 2 + 8}" y="${(H - h) / 2 + 26}" fill="#c9cfdb" font-family="sans-serif" font-size="22">${mm} mm</text>`;
  }).join("");
  const grid = Array.from({ length: 29 }, (_, i) => `<line x1="${(i + 1) * 50}" y1="0" x2="${(i + 1) * 50}" y2="${H}" stroke="#2a2f3a"/>`).join("") + Array.from({ length: 19 }, (_, i) => `<line x1="0" y1="${(i + 1) * 50}" x2="${W}" y2="${(i + 1) * 50}" stroke="#2a2f3a"/>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#151820"/>${grid}<line x1="${W / 2}" y1="0" x2="${W / 2}" y2="${H}" stroke="#4a5266"/><line x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}" stroke="#4a5266"/>${rects}<text x="16" y="${H - 20}" fill="#7c8496" font-family="sans-serif" font-size="20">Test chart · 14 mm on full frame · 104° × 81°</text></svg>`;
  return { id: "chart", label: "Test chart", src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, view, aspect: 1.5 };
})();

/** The examples: the chart, then the project's photos that have an angle of view (newest first, a few). */
export function examplesIn(files: readonly FileRec[] | null, max = 6): Example[] {
  const photos = (files ?? []).filter((f) => f.type === "photo" && f.photo?.angle_of_view && f.photo.stored.preview)
    .sort((a, b) => (b.photo!.taken_at ?? "").localeCompare(a.photo!.taken_at ?? "")).slice(0, max);
  return [CHART, ...photos.map((f) => ({ id: f.id, label: f.name, src: imageUrl(f.id, "preview"), view: f.photo!.angle_of_view!, aspect: f.photo!.width / f.photo!.height }))];
}
