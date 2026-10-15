/**
 * The phone's lenses as magnifications (issue #26). Android exposes the back cameras as one logical
 * camera whose zoom ratio is measured against the main lens: a minimum below 1 means an ultra-wide
 * (0.5×, 0.6×), and the phone switches to a tele by itself at its factor. vision-camera reports the
 * range but not the switch points on Android, so the strip offers fixed stops inside it.
 */

/** Which magnifications the strip offers (Setup → Viewfinder → Phone lenses). */
export type PhoneLenses = { mode: "all" } | { mode: "list"; zooms: number[] } | { mode: "fixed"; zoom: number };

/** The zoom range of the camera in use, as the camera reported it once it ran. */
export interface ZoomRange { min: number; max: number }

const TELE_STOPS = [2, 3, 5, 10];

/** The stops the camera can do: its ultra-wide (when below 1×), 1×, then 2× 3× 5× 10× up to its maximum. */
export function zoomStops(range: ZoomRange | null): number[] {
  if (!range || !(range.max >= 1)) return [1];
  const wide = range.min < 0.95 ? [Math.round(range.min * 10) / 10] : [];
  return [...wide, 1, ...TELE_STOPS.filter((z) => z <= range.max + 1e-6)];
}

/** What the strip shows: all stops, the picked ones the camera can do (at least 1×), or the fixed one alone. */
export function offeredZooms(stops: number[], setting: PhoneLenses): number[] {
  if (setting.mode === "fixed") return [stops.includes(setting.zoom) ? setting.zoom : 1];
  if (setting.mode === "list") {
    const picked = stops.filter((z) => setting.zooms.includes(z));
    return picked.length ? picked : [1];
  }
  return stops;
}

/** The zoom actually used: the chosen one when offered, else the offered stop nearest to it. */
export function effectiveZoom(chosen: number, offered: number[]): number {
  if (offered.includes(chosen)) return chosen;
  return offered.reduce((best, z) => (Math.abs(Math.log(z / chosen)) < Math.abs(Math.log(best / chosen)) ? z : best), offered[0] ?? 1);
}

/** "0.5×", "1×", "3×" */
export const zoomLabel = (z: number) => `${Number.isInteger(z) ? z : z.toFixed(1)}×`;
