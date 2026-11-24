/**
 * Optics as generic factors (docs/rewrite/02-optics.md): what a camera with a lens sees, and where
 * that is on a photo whose angle of view is known. No equipment, no rigs, no vignetting.
 */

/** Format (sensor or film area, mm), multiplier (focal reducer or teleconverter), squeeze (front anamorphic), focal length (mm), orientation. */
export interface Optics {
  format: readonly [number, number];
  multiplier: number;
  squeeze: number;
  focal: number;
  portrait?: boolean;
  /** An aspect ratio cropped centred inside the camera's view (2.39 out of a 16:9 or desqueezed picture). */
  delivery?: number | null;
}

/** Half-angle tangents of what the optics see, horizontal and vertical, desqueezed. */
export function opticsTangents(o: Optics): { h: number; v: number } {
  const f = o.focal * o.multiplier;
  let h = (o.format[0] * o.squeeze) / (2 * f), v = o.format[1] / (2 * f);
  if (o.portrait) [h, v] = [v, h];
  return { h, v };
}

const deg = (t: number) => (2 * Math.atan(t) * 180) / Math.PI;
const FF_DIAGONAL = Math.hypot(36, 24);

/** The angle of view of optics (degrees) and the full-frame focal length with the same diagonal view. */
export function opticsView(o: Optics): { horizontal: number; vertical: number; diagonal: number; fullFrame: number } {
  const t = opticsTangents(o);
  const d = Math.hypot(t.h, t.v);
  return { horizontal: deg(t.h), vertical: deg(t.v), diagonal: deg(d), fullFrame: FF_DIAGONAL / (2 * d) };
}

/** A photo's angle of view as the photos table stores it (degrees). */
export interface PhotoView { horizontal: number; vertical: number }
const tan = (degrees: number) => Math.tan((degrees * Math.PI) / 360);

/**
 * A frame on a photo, as fractions of the photo's width and height: what the optics see against what
 * the photo sees, per axis. Above 1: the optics see more than the photo. `inner` is the delivery
 * aspect's rectangle inside it, when there is one.
 */
export interface FrameSize { w: number; h: number; inner: { w: number; h: number } | null }

export function opticsFrame(o: Optics, photo: PhotoView): FrameSize {
  const t = opticsTangents(o);
  const w = t.h / tan(photo.horizontal), h = t.v / tan(photo.vertical);
  if (!o.delivery) return { w, h, inner: null };
  const aspect = t.h / t.v;
  return { w, h, inner: o.delivery > aspect ? { w, h: (h * aspect) / o.delivery } : { w: (w * o.delivery) / aspect, h } };
}

/** An aspect frame: `size` of the photo's width (at most the whole photo), the ratio held against the photo's pixel aspect. */
export function aspectFrame(aspect: number, size: number, photoAspect: number): FrameSize {
  let w = size, h = (size * photoAspect) / aspect;
  if (h > 1) { w /= h; h = 1; }
  return { w, h, inner: null };
}

/** The generic formats (02-optics.md), checked against the published standards. */
export const FORMATS: readonly { group: string; name: string; w: number; h: number }[] = [
  { group: "Small sensors", name: '1/2.3"', w: 6.17, h: 4.55 },
  { group: "Small sensors", name: '1/1.7"', w: 7.6, h: 5.7 },
  { group: "Small sensors", name: '1"', w: 13.2, h: 8.8 },
  { group: "Small film", name: "Super 8", w: 5.79, h: 4.01 },
  { group: "Small film", name: "16 mm", w: 10.26, h: 7.49 },
  { group: "Small film", name: "Super 16", w: 12.52, h: 7.41 },
  { group: "Mid-size", name: "Micro Four Thirds", w: 17.3, h: 13 },
  { group: "Mid-size", name: "APS-C (Canon)", w: 22.3, h: 14.9 },
  { group: "Mid-size", name: "APS-C (Sony, Nikon, Fuji)", w: 23.5, h: 15.6 },
  { group: "35 mm cine", name: "Academy 35", w: 21.95, h: 16 },
  { group: "35 mm cine", name: "Super 35, 3-perf", w: 24.89, h: 13.87 },
  { group: "35 mm cine", name: "Super 35, 4-perf", w: 24.89, h: 18.66 },
  { group: "Full frame", name: "Full frame (135)", w: 36, h: 24 },
  { group: "Full frame", name: "VistaVision, 8-perf", w: 37.72, h: 25.17 },
  { group: "Medium and large", name: "Medium format 44 × 33", w: 43.8, h: 32.9 },
  { group: "Medium and large", name: "Medium format 645 digital", w: 53.4, h: 40 },
  { group: "Medium and large", name: "65 mm, 5-perf", w: 52.63, h: 23.01 },
  { group: "Medium and large", name: "IMAX, 15-perf", w: 70.41, h: 52.63 },
];

/** The built-in prime list (cine and photo series merged), whole mm. */
export const PRIMES: readonly number[] = [12, 14, 16, 18, 20, 21, 24, 25, 27, 28, 32, 35, 40, 50, 65, 75, 85, 90, 100, 135];
/** Squeeze factors on offer; free entry allowed. */
export const SQUEEZES: readonly number[] = [1, 1.25, 1.33, 1.5, 1.6, 1.8, 2];
/** Delivery aspects on offer; free entry allowed. */
export const DELIVERIES: readonly { label: string; ratio: number }[] = [
  { label: "2.39:1", ratio: 2.39 }, { label: "2:1", ratio: 2 }, { label: "1.85:1", ratio: 1.85 }, { label: "16:9", ratio: 16 / 9 }, { label: "4:3", ratio: 4 / 3 }, { label: "1:1", ratio: 1 },
];
