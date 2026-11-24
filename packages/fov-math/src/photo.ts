import { angleOfViewDeg, diagonalMm } from "./fov.ts";
import { FULL_FRAME } from "./presets.ts";

/**
 * A photo's angle of view (docs/rewrite/02-optics.md), computed once when the photo is added, the
 * same way for a photo taken in the app and an imported one:
 *   1. from EXIF FocalLengthIn35mmFilm and the picture's aspect ratio;
 *   2. else from EXIF FocalLength and the sensor size the focal-plane resolution gives;
 *   3. else the photo has none.
 * The raw EXIF is kept with the photo, so the angle can be computed again if this rule changes.
 */
export type AovSource = "exif-35mm" | "exif-sensor";
export interface PhotoAov { horizontal: number; vertical: number; source: AovSource }

/** The EXIF tags the rule reads, by their EXIF names. Anything that is not a positive number counts as absent. */
export interface AovExif {
  FocalLengthIn35mmFilm?: unknown;
  FocalLength?: unknown;
  FocalPlaneXResolution?: unknown;
  FocalPlaneYResolution?: unknown;
  /** 2 = inch (the default), 3 = centimetre, 4 = millimetre. */
  FocalPlaneResolutionUnit?: unknown;
}

const positive = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
const round = (deg: number) => Math.round(deg * 100) / 100;

/**
 * `width` and `height` are the picture's pixels as it is shown (upright). The 35 mm equivalent is
 * defined on the diagonal: a sensor of the picture's own aspect whose diagonal is full frame's.
 */
export function photoAov(exif: AovExif, width: number, height: number): PhotoAov | null {
  if (!(width > 0) || !(height > 0)) return null;
  const f35 = positive(exif.FocalLengthIn35mmFilm);
  if (f35) {
    const d = diagonalMm(FULL_FRAME), k = d / Math.hypot(width, height);
    return { horizontal: round(angleOfViewDeg(width * k, f35)), vertical: round(angleOfViewDeg(height * k, f35)), source: "exif-35mm" };
  }
  const f = positive(exif.FocalLength), xRes = positive(exif.FocalPlaneXResolution), yRes = positive(exif.FocalPlaneYResolution);
  if (f && xRes && yRes) {
    const unit = exif.FocalPlaneResolutionUnit === 3 ? 10 : exif.FocalPlaneResolutionUnit === 4 ? 1 : 25.4;
    // The focal plane's X is the sensor's long side as it was built; a picture taken upright has its
    // long side there too, whichever way it is shown.
    const longMm = (Math.max(width, height) / xRes) * unit, shortMm = (Math.min(width, height) / yRes) * unit;
    // Sensors reported larger than medium format are a broken tag, not a camera.
    if (longMm > 0.5 && longMm < 80 && shortMm > 0.5 && shortMm < 80) {
      const [w, h] = width >= height ? [longMm, shortMm] : [shortMm, longMm];
      return { horizontal: round(angleOfViewDeg(w, f)), vertical: round(angleOfViewDeg(h, f)), source: "exif-sensor" };
    }
  }
  return null;
}
