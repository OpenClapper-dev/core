import { Platform } from "react-native";
import * as Crypto from "expo-crypto";
import type { DeviceSize, DeviceSpecs } from "@openclapper/vocab";
import { kv } from "./kv";
import type { Settings } from "./types";
import { zoomStops, type ZoomRange } from "./zoom";

/**
 * This phone as a device (issue #68): its own id (the Studio saves the specs under it, so the phone
 * can keep that record current) and the Shoot screen's size per orientation, measured whenever Shoot
 * lays out. The specs are built from that, the camera's zoom range and the calibration in Settings.
 */
interface Profile { id: string; viewport: { portrait: DeviceSize | null; landscape: DeviceSize | null } }

const KEY = "device.v1";
const listeners = new Set<() => void>();

function load(): Profile {
  try {
    const raw = kv.getItemSync(KEY);
    if (raw) return JSON.parse(raw) as Profile;
  } catch { /* a new profile below */ }
  const p: Profile = { id: Crypto.randomUUID(), viewport: { portrait: null, landscape: null } };
  kv.setItemSync(KEY, JSON.stringify(p));
  return p;
}
let profile: Profile | null = null;
const get = () => (profile ??= load());

export const deviceId = () => get().id;

/** As the phone names itself; Android's build model ("motorola edge 50 pro"). */
export const deviceModel = (): string | null => {
  const c = Platform.constants as { Model?: string; Manufacturer?: string };
  return c.Model ? c.Model.slice(0, 80) : null;
};

/** Shoot laid out at this size: remembered per orientation (rounded to whole dp). */
export function recordViewport(width: number, height: number) {
  if (width < 100 || height < 100) return; // hidden (another tab) or not laid out yet
  const p = get();
  const o = height >= width ? "portrait" : "landscape";
  const next = { width: Math.round(width), height: Math.round(height) };
  const cur = p.viewport[o];
  if (cur && cur.width === next.width && cur.height === next.height) return;
  p.viewport = { ...p.viewport, [o]: next };
  kv.setItemSync(KEY, JSON.stringify(p));
  for (const fn of listeners) fn();
}

/** Called when the measured sizes change (the preview socket sends fresh specs). */
export function onDeviceChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function deviceSpecs(settings: Pick<Settings, "phoneEquivalentFocalMm" | "phoneCalibration">, zoom: ZoomRange | null): DeviceSpecs {
  return {
    v: 1,
    model: deviceModel(),
    viewport: get().viewport,
    zoom: zoom && zoom.max >= 1 ? { min: zoom.min, max: zoom.max } : null,
    stops: zoomStops(zoom),
    mainEquivalentMm: settings.phoneEquivalentFocalMm,
    calibration: settings.phoneCalibration,
  };
}

const NAME_KEY = "deviceName.v1";
/** The name the Studio saved this phone under, or null while it has no device record. */
export const registeredName = (): string | null => { try { return kv.getItemSync(NAME_KEY); } catch { return null; } };

/**
 * Part of every flush: once the Studio has saved this phone, keep its record in step with the
 * phone (calibration, measured sizes, lenses). The phone never creates the record: naming is the
 * Studio's readout. Offline it simply waits for the next flush.
 */
export async function syncDevice(settings: Pick<Settings, "phoneEquivalentFocalMm" | "phoneCalibration">, zoom: ZoomRange | null, api: { listDevices: () => Promise<{ id: string; name: string; specs: DeviceSpecs }[]>; putDeviceSpecs: (id: string, s: DeviceSpecs) => Promise<unknown> }) {
  const mine = (await api.listDevices()).find((d) => d.id === deviceId());
  if (!mine) { kv.removeItemSync(NAME_KEY); return; }
  kv.setItemSync(NAME_KEY, mine.name);
  const local = deviceSpecs(settings, zoom);
  if (JSON.stringify(mine.specs) !== JSON.stringify(local)) await api.putDeviceSpecs(mine.id, local);
}

/** Tell listeners (the preview socket) that something in the specs changed. */
export const notifyDeviceChange = () => { for (const fn of listeners) fn(); };
