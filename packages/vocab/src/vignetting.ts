/**
 * Lens vignetting per rig (issue #266). The dark, softly fading corners of a wide lens on a large
 * format are the lens's image circle ending before the format diagonal: a circle around the centre
 * in sensor space, so the corners darken and the edges' midpoints do not. The shape is given; a rig
 * only says, per focal length, where the falloff begins and is complete (fractions of the frame's
 * half-diagonal) and how dark the corner gets. Between stored points the values interpolate; below
 * the widest point its values hold; above the longest point there is none (vignetting is a wide-end
 * matter). Aperture also changes it: ignored, this is a rough indication for the viewfinder and the
 * Studio, never baked into photos or renders.
 */

export interface VignettePoint {
  mm: number;
  /** Where the darkening starts, 0..1 of the half-diagonal (0 = the centre). */
  start: number;
  /** Where the corner reaches its full darkness, start..1. */
  end: number;
  /** Darkness at the corner, 0..1. */
  opacity: number;
}
/** The effect at one focal length. */
export type Vignette = Pick<VignettePoint, "start" | "end" | "opacity">;

export const MAX_VIGNETTE_POINTS = 12;

const num = (v: unknown, min: number, max: number) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;

/** Strict check of a rig's `vignetting` (interactive edits); null = fine. `null`/`undefined` mean none. */
export function validateVignetting(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (!Array.isArray(v)) return "vignetting must be an array";
  if (v.length > MAX_VIGNETTE_POINTS) return `vignetting: at most ${MAX_VIGNETTE_POINTS} focal lengths`;
  const seen = new Set<number>();
  for (let i = 0; i < v.length; i++) {
    const p = v[i] as Record<string, unknown> | null;
    if (typeof p !== "object" || p === null || Array.isArray(p)) return `vignetting[${i}] must be an object`;
    if (!num(p.mm, 1, 2000)) return `vignetting[${i}].mm must be 1..2000`;
    if (seen.has(p.mm as number)) return `vignetting[${i}].mm repeats`;
    seen.add(p.mm as number);
    if (!num(p.start, 0, 1)) return `vignetting[${i}].start must be 0..1`;
    if (!num(p.end, 0, 1)) return `vignetting[${i}].end must be 0..1`;
    if ((p.start as number) >= (p.end as number)) return `vignetting[${i}].start must be below end`;
    if (!num(p.opacity, 0, 1)) return `vignetting[${i}].opacity must be 0..1`;
  }
  return null;
}

/** The points sorted by focal length, with only the fields that matter (what the server stores). */
export const normalizeVignetting = (points: readonly VignettePoint[]): VignettePoint[] =>
  [...points].sort((a, b) => a.mm - b.mm).map((p) => ({ mm: p.mm, start: p.start, end: p.end, opacity: p.opacity }));

/**
 * The vignette a rig shows at `mm`: interpolated between the two points around it, the widest
 * point's values below it, none above the longest point, none when the result would be invisible.
 */
export function vignetteAt(points: readonly VignettePoint[] | null | undefined, mm: number): Vignette | null {
  if (!points?.length || !(mm > 0)) return null;
  const list = normalizeVignetting(points);
  let v: Vignette;
  if (mm <= list[0].mm) v = list[0];
  else if (mm > list[list.length - 1].mm) return null;
  else {
    const i = list.findIndex((p) => p.mm >= mm);
    const a = list[i - 1], b = list[i];
    const t = (mm - a.mm) / (b.mm - a.mm);
    const mix = (x: number, y: number) => x + (y - x) * t;
    v = { start: mix(a.start, b.start), end: mix(a.end, b.end), opacity: mix(a.opacity, b.opacity) };
  }
  return v.opacity > 0.005 ? { start: v.start, end: v.end, opacity: v.opacity } : null;
}
