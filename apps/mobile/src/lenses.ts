/**
 * The phone's real lenses (docs/rewrite/03-capture.md, "Real lenses only"), worked out from what the
 * camera library reports. Pure, so it can be tested without a phone.
 *
 * Three cases, best first:
 * 1. A logical back camera made of several physical ones: its lenses are the physical cameras, and the
 *    camera switches between them by zoom. The zoom where each takes over is the library's switch
 *    factors when they fit, else the ratio of focal lengths to the main lens.
 * 2. Separate back cameras (wide, ultra-wide, tele): each is opened on its own, at zoom 1.
 * 3. Neither: the default back camera only.
 */

/** What this module reads of a vision-camera CameraDevice. */
export interface CamLike {
  id: string;
  position: string;
  type: string;
  focalLength?: number;
  isVirtualDevice: boolean;
  physicalDevices: CamLike[];
  zoomLensSwitchFactors: number[];
  minZoom: number;
  maxZoom: number;
  hasTorch: boolean;
}

/** One real lens: how to get to it, and what it reports (the device file's DeviceLens plus where to open it). */
export interface Lens {
  /** The physical camera's id. */
  id: string;
  /** The phone's own name: 0.5×, 1×, 5×. */
  name: string;
  /** The 35 mm equivalent the camera reports; null when it reports none (no optics frame then). */
  focal35: number | null;
  /** The zoom of the logical camera at which this lens is used; null when it is opened as a camera of its own. */
  zoom: number | null;
  /** The camera to open for this lens. */
  camera: string;
  /** The zoom to set on that camera. */
  cameraZoom: number;
  /** The main lens (1×). */
  main: boolean;
}

export interface LensSet { lenses: Lens[]; torch: boolean }

const round = (v: number) => Math.round(v * 10) / 10;
/** 0.5×, 1×, 2.5×, 5×: one decimal below 10, whole numbers from there. */
export const zoomName = (z: number) => `${z >= 10 ? Math.round(z) : round(z)}×`;
const known = (f: number | undefined): number | null => (typeof f === "number" && Number.isFinite(f) && f > 0 ? round(f) : null);
const LENS_TYPES = ["wide-angle", "ultra-wide-angle", "telephoto"];
const typeName = (t: string) => (t === "ultra-wide-angle" ? "Ultra-wide" : t === "telephoto" ? "Tele" : "Wide");

/** The main lens among several: the wide-angle one, else the one whose focal length is nearest 26 mm. */
function mainOf(list: CamLike[]): CamLike {
  return list.find((d) => d.type === "wide-angle")
    ?? [...list].sort((a, b) => Math.abs((known(a.focalLength) ?? 1e9) - 26) - Math.abs((known(b.focalLength) ?? 1e9) - 26))[0];
}

export function lensSet(devices: readonly CamLike[]): LensSet {
  const back = devices.filter((d) => d.position === "back");
  if (!back.length) return { lenses: [], torch: false };

  // 1. A logical camera over physical ones; the one with the most lenses.
  const logical = [...back].filter((d) => d.isVirtualDevice && d.physicalDevices.length > 1).sort((a, b) => b.physicalDevices.length - a.physicalDevices.length)[0];
  if (logical) {
    const phys = [...logical.physicalDevices].sort((a, b) => (known(a.focalLength) ?? 1e9) - (known(b.focalLength) ?? 1e9));
    const main = mainOf(phys);
    const mainF = known(main.focalLength);
    const factors = [...logical.zoomLensSwitchFactors].sort((a, b) => a - b);
    // The switch factors name where the 2nd, 3rd… lens takes over; the first lens starts at the camera's minimum.
    const byFactors = factors.length === phys.length - 1 ? [logical.minZoom, ...factors] : null;
    const lenses = phys.map((d, i): Lens => {
      const f = known(d.focalLength);
      const z = byFactors ? byFactors[i] : d === main ? 1 : f && mainF ? f / mainF : null;
      const zoom = z === null ? null : Math.min(logical.maxZoom, Math.max(logical.minZoom, z));
      return { id: d.id, name: zoom !== null ? zoomName(zoom) : d === main ? "1×" : typeName(d.type), focal35: f, zoom: zoom === null ? null : Math.round(zoom * 100) / 100, camera: logical.id, cameraZoom: zoom ?? 1, main: d === main };
    }).filter((l) => l.zoom !== null || l.main);
    return { lenses: dedupe(lenses), torch: logical.hasTorch };
  }

  // 2. Separate physical back cameras.
  const separate = back.filter((d) => !d.isVirtualDevice && LENS_TYPES.includes(d.type));
  if (separate.length > 1) {
    const main = mainOf(separate);
    const mainF = known(main.focalLength);
    const lenses = [...separate].sort((a, b) => (known(a.focalLength) ?? 1e9) - (known(b.focalLength) ?? 1e9)).map((d): Lens => {
      const f = known(d.focalLength);
      return { id: d.id, name: d === main ? "1×" : f && mainF ? zoomName(f / mainF) : typeName(d.type), focal35: f, zoom: null, camera: d.id, cameraZoom: 1, main: d === main };
    });
    return { lenses: dedupe(lenses), torch: main.hasTorch };
  }

  // 3. The default back camera.
  const only = mainOf(back);
  return { lenses: [{ id: only.id, name: "1×", focal35: known(only.focalLength), zoom: null, camera: only.id, cameraZoom: 1, main: true }], torch: only.hasTorch };
}

/** Two entries with the same name are the same lens to the person (some phones list a lens twice). */
function dedupe(list: Lens[]): Lens[] {
  const out: Lens[] = [];
  for (const l of list) {
    const twin = out.findIndex((o) => o.name === l.name);
    if (twin < 0) out.push(l);
    else if (l.main) out[twin] = l;
  }
  return out;
}

/** A lens as the device file stores it. */
export const deviceLens = (l: Lens) => ({ id: l.id.slice(0, 60), name: l.name.slice(0, 20), focal35: l.focal35, zoom: l.zoom });
