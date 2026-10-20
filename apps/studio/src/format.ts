import type { RigLens } from "@openclapper/fov-math";
import { cameraLabel, extraLabel, label, lightLabel, rootFrame, withCentre, type FilterableShot } from "@openclapper/vocab";
import type { Photo, Shot } from "./api";

/** The photo that stands for the shot in lists, maps and filters: the first one. */
export const cover = (s: Shot): Photo => s.photos[0];

/** "Uploaded image" / "Drawn sketch" for photos that did not come from the phone camera. */
export const sourceLabel = (p: Photo): string | null => (p.source === "upload" ? "Uploaded image" : p.source === "drawn" ? "Drawn sketch" : null);

export function rigLabel(p: Photo): string {
  const src = sourceLabel(p);
  if (src) return src;
  const f = p.framing;
  const name = p.preset_name ?? (f?.preset_name as string | undefined) ?? "unknown rig";
  const sb = f?.speedbooster_factor as number | undefined;
  return `${name} · ${p.lens_mm} mm${sb && sb !== 1 ? ` ×${sb}` : ""}`;
}

/** "Name" or, for shots without tags, the rig label. */
export const shotTitle = (s: Shot): string => s.name?.trim() || rigLabel(cover(s));
export const placeLabel = (s: Shot): string => [s.location_name, s.spot_name].filter(Boolean).join(" · ");
export const tagsLabel = (s: Shot): string =>
  [label(s.int_ext), lightLabel(s.light, s.artificial), label(s.weather), cameraLabel(s), extraLabel(s.extra)].filter(Boolean).join(" · ");
/**
 * Where a shot is on a map: the location's pin when the shot is synced to it (and the pin is set),
 * else its own position. Null when there is none.
 */
export function positionOf(s: Shot): { lat: number; lon: number } | null {
  if (s.position_from_location && s.location_position) return s.location_position;
  return ownPositionOf(s);
}
/** The shot's own position: the cover photo, else the first photo with a position; null when none has one (GPS off). */
export function ownPositionOf(s: Shot): { lat: number; lon: number } | null {
  const p = [cover(s), ...s.photos].find((x) => x.lat !== null && x.lon !== null);
  return p ? { lat: p.lat!, lon: p.lon! } : null;
}
/** "3 photos" for sequences, "" for single shots. */
export const photoCountLabel = (s: Shot): string => (s.photos.length > 1 ? `${s.photos.length} photos` : "");

export function fovLabel(p: Photo): string {
  const f = p.framing;
  if (!f) return "";
  const parts: string[] = [];
  if (typeof f.full_frame_equivalent_mm === "number") parts.push(`${f.full_frame_equivalent_mm} mm FF-eq`);
  if (typeof f.hfov_deg === "number" && typeof f.vfov_deg === "number") parts.push(`${f.hfov_deg}° × ${f.vfov_deg}°`);
  return parts.join(" · ");
}

const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
export const when = (iso: string) => fmt.format(new Date(iso));
export const coords = (p: Photo) => (p.lat === null || p.lon === null ? "No position" : `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`);

/** Rig frame relative to the photo; `x`/`y` is its centre (absent = 0.5, centred). */
export interface FrameGeometry { width_fraction: number; height_fraction: number; x?: number; y?: number }

/** The frame a photo is shown with everywhere: its root framing (issue #29), else as captured. */
export const frameOf = (p: Photo): FrameGeometry | null => rootFrame(p);

/** The frame as captured on the phone (centred), whatever the root is: the source for re-framing math. */
export function capturedFrameOf(p: Photo): FrameGeometry | null {
  const f = p.framing?.frame as Partial<FrameGeometry> | undefined;
  if (!f || typeof f.width_fraction !== "number" || typeof f.height_fraction !== "number") return null;
  return { width_fraction: f.width_fraction, height_fraction: f.height_fraction };
}

export function rigDescription(p: Photo): string {
  const f = p.framing;
  if (!f) return "";
  const parts: string[] = [];
  if (typeof f.camera_id === "string" && typeof f.format_id === "string") parts.push(`${f.camera_id} / ${f.format_id}`);
  if (typeof f.sensor_width_mm === "number" && typeof f.sensor_height_mm === "number") parts.push(`${f.sensor_width_mm} × ${f.sensor_height_mm} mm`);
  if (typeof f.speedbooster_factor === "number" && f.speedbooster_factor !== 1) parts.push(`×${f.speedbooster_factor}`);
  return parts.join(" · ");
}

/** Photo aspect ratio (w/h) as uploaded; 4:3 when the app did not record it. */
export const imageAspect = (p: Photo): number => (p.width && p.height ? p.width / p.height : 4 / 3);

export type FrameMode = "mask" | "frame" | "fit" | "off";
export const FRAME_MODES: readonly FrameMode[] = ["mask", "frame", "fit", "off"];
export const frameModeLabel = (m: FrameMode) => (m === "off" ? "Raw" : m[0].toUpperCase() + m.slice(1));
export const isFrameMode = (v: unknown): v is FrameMode => FRAME_MODES.includes(v as FrameMode);

export interface PctRect { left: number; top: number; width: number; height: number }
export interface FrameLayout {
  /** Photo box inside the container, in % of the container. */
  img: PctRect;
  /** Rig frame in % of the container; null when no frame is drawn (raw or fit). */
  frame: PctRect | null;
  /** Rig saw more than the phone: photo shrunk, frame dashed. */
  shrunk: boolean;
  /** Container aspect ratio (w/h) to apply in fit mode. */
  aspect?: number;
}

/**
 * Same layout rules as the phone: shrink the photo when the rig saw more, crop to the frame in fit
 * mode, and place the frame at its centre (re-framed frames are off-centre; the centre is clamped
 * so the frame stays on the photo, see @openclapper/vocab framing.ts).
 */
export function frameLayout(frame: FrameGeometry, mode: FrameMode, photoAspect: number): FrameLayout {
  const f = withCentre(frame);
  const full = { left: 0, top: 0, width: 100, height: 100 };
  if (mode === "off") return { img: full, frame: null, shrunk: false };
  if (mode === "fit") {
    // The container is the rig frame. Where the rig saw more than the phone (fraction > 1) the
    // photo covers less than the container and the rest stays black, like the live view.
    const w = 100 / f.width_fraction, h = 100 / f.height_fraction;
    const shrunk = f.width_fraction > 1 || f.height_fraction > 1;
    return { img: { left: 50 - f.x * w, top: 50 - f.y * h, width: w, height: h }, frame: null, shrunk, aspect: photoAspect * (f.width_fraction / f.height_fraction) };
  }
  const scale = 1 / Math.max(1, f.width_fraction, f.height_fraction);
  const img = scale < 1 ? { left: (1 - scale) * 50, top: (1 - scale) * 50, width: scale * 100, height: scale * 100 } : full;
  const w = f.width_fraction * img.width, h = f.height_fraction * img.height;
  return { img, frame: { left: img.left + f.x * img.width - w / 2, top: img.top + f.y * img.height - h / 2, width: w, height: h }, shrunk: scale < 1 };
}

/** Map a shot to the shape the shared filter evaluator expects. Rig and lens come from the cover photo. */
export function filterable(s: Shot): FilterableShot {
  const p = cover(s);
  const ffEq = p.framing?.full_frame_equivalent_mm;
  return {
    state: s.state, project_id: s.project_id, name: s.name, location_id: s.location_id, spot_id: s.spot_id, int_ext: s.int_ext,
    light: s.light, artificial: s.artificial ? "yes" : "no", weather: s.weather,
    shot_size: s.shot_size, camera_support: s.camera_support, movement: s.movement, has_position: positionOf(s) ? "yes" : "no",
    preset_id: p.preset_id, lens_mm: p.lens_mm, ff_eq_mm: typeof ffEq === "number" ? ffEq : null,
    photo_count: s.photos.length, timestamp: s.captured_at, extra: s.extra,
  };
}

/** The rig and lens a photo was framed with, as fov-math input; null for photos without a framing snapshot. */
export function sourceRigOf(p: Photo): { rigLens: RigLens; frame: { widthFraction: number; heightFraction: number } } | null {
  const f = p.framing;
  const fr = capturedFrameOf(p);
  if (!f || !fr || typeof f.sensor_width_mm !== "number" || typeof f.sensor_height_mm !== "number") return null;
  return {
    rigLens: {
      rig: { sensor: { widthMm: f.sensor_width_mm, heightMm: f.sensor_height_mm }, speedboosterFactor: typeof f.speedbooster_factor === "number" ? f.speedbooster_factor : 1 },
      lensMm: p.lens_mm,
      portrait: f.rig_orientation === "portrait",
    },
    frame: { widthFraction: fr.width_fraction, heightFraction: fr.height_fraction },
  };
}
