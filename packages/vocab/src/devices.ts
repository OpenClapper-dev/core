/**
 * Device specs (issue #68): what a phone reports about itself, so the layout editor previews on the
 * real screen and the phone-lenses control offers the real lenses. Read out from the connected
 * phone (dashboard › Add device specs), stored by the Worker, kept up to date by the phone.
 */

/** The Shoot screen's area in dp (bars + camera image), after the tab bar and system bars. */
export interface DeviceSize { width: number; height: number }

export interface DeviceSpecs {
  v: 1;
  /** As the phone names itself (e.g. "motorola edge 50 pro"). */
  model: string | null;
  /** Measured whenever Shoot lays out in that orientation; null until it has been seen. */
  viewport: { portrait: DeviceSize | null; landscape: DeviceSize | null };
  /** The back camera's zoom range and the stops the phone offers from it (0.5, 1, 2, 3…). */
  zoom: { min: number; max: number } | null;
  stops: number[];
  /** The main lens's 35 mm equivalent (the phone's calibration) and where it comes from. */
  mainEquivalentMm: number;
  calibration: "auto" | "manual";
}

const size = (v: unknown, at: string): string | null => {
  if (v === null) return null;
  const s = v as Record<string, unknown> | undefined;
  if (!s || typeof s.width !== "number" || typeof s.height !== "number" || !(s.width >= 100 && s.width <= 4000) || !(s.height >= 100 && s.height <= 4000)) return `${at} must be { width, height } in 100..4000 dp, or null`;
  return null;
};

/** Strict check (the phone builds these; the dashboard only stores what it was sent). */
export function validateDeviceSpecs(v: unknown): string | null {
  if (typeof v !== "object" || v === null) return "specs must be an object";
  const d = v as Record<string, unknown>;
  if (d.v !== 1) return "specs.v must be 1";
  if (d.model !== null && (typeof d.model !== "string" || d.model.length > 80)) return "specs.model must be a string up to 80 characters, or null";
  const vp = d.viewport as Record<string, unknown> | undefined;
  if (!vp || typeof vp !== "object") return "specs.viewport must be an object";
  const e = size(vp.portrait, "viewport.portrait") ?? size(vp.landscape, "viewport.landscape");
  if (e) return e;
  if (d.zoom !== null) {
    const z = d.zoom as Record<string, unknown> | undefined;
    if (!z || typeof z.min !== "number" || typeof z.max !== "number" || !(z.min > 0 && z.min <= z.max && z.max <= 1000)) return "specs.zoom must be { min, max } with 0 < min <= max, or null";
  }
  if (!Array.isArray(d.stops) || d.stops.length > 12 || !d.stops.every((s) => typeof s === "number" && s > 0 && s <= 1000)) return "specs.stops must be up to 12 positive numbers";
  if (typeof d.mainEquivalentMm !== "number" || !(d.mainEquivalentMm >= 5 && d.mainEquivalentMm <= 200)) return "specs.mainEquivalentMm must be 5..200";
  if (d.calibration !== "auto" && d.calibration !== "manual") return "specs.calibration must be auto or manual";
  return null;
}
