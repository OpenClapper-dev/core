/**
 * Issue #26: the phone's field of view without a per-phone constant. Android writes the lens's
 * 35 mm-equivalent focal length into every photo's EXIF (FocalLengthIn35mmFilm); the Motorola's 162
 * production photos all say 25, the value that was hard-coded. Auto calibration takes it from each
 * capture; Manual keeps a typed value for phones that write no or a wrong tag.
 */
export interface ExifCalibration { mm: number; model: string | null }

/** The 35 mm-equivalent focal length a photo's EXIF reports, or null when it is missing or implausible. */
export function calibrationFromExif(exif: Record<string, unknown> | null | undefined): ExifCalibration | null {
  const raw = exif?.FocalLengthIn35mmFilm;
  const mm = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(mm) || mm < 5 || mm > 200) return null;
  const model = typeof exif?.Model === "string" && exif.Model.trim() ? exif.Model.trim() : null;
  return { mm, model };
}
