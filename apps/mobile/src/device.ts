import { Dimensions, Platform } from "react-native";
import * as Application from "expo-application";
import { randomUUID } from "expo-crypto";
import { addOnCameraDevicesChangedListener, getAllCameraDevices } from "react-native-vision-camera";
import { canCall, putFile, registerDevice, type DeviceReport, type FileRec } from "./api";
import { signedInUserId } from "./auth";
import { deviceLens, lensSet, type CamLike, type LensSet } from "./lenses";
import { log } from "./log";
import { persisted } from "./store";
import { APP_VERSION } from "./version";

/**
 * This phone or tablet as a device of the account (docs/rewrite/03-capture.md, "Devices"): it
 * registers itself, tied to a fingerprint of the hardware, and keeps what it reports current (model,
 * real lenses, screen). Its tabs are the person's choice, kept with the device: changed here or in
 * the Studio. Without an account the choice stays on the phone.
 */
export const DEFAULT_TABS = ["camera", "media", "shots", "setup"];

interface DeviceState {
  /** The account the file belongs to; another account registers anew. */
  userId: string | null;
  file: { id: string; name: string; body: Record<string, unknown> } | null;
  /** The tabs as this phone shows them (the file's, or chosen here). */
  tabs: string[];
  /** Tabs or name changed here and not saved yet. */
  dirty: { tabs?: boolean; name?: boolean };
}
export const device = persisted<DeviceState>("device.v1", { userId: null, file: null, tabs: DEFAULT_TABS, dirty: {} });

/** The real lenses as last read from the camera (persisted, so Setup can list them with the camera closed). */
export const lenses = persisted<LensSet>("lenses.v1", { lenses: [], torch: false });
let lensesRead = false;
function readLenses() {
  const set = lensSet(getAllCameraDevices() as unknown as CamLike[]);
  if (!set.lenses.length) return;
  lensesRead = true;
  if (JSON.stringify(set) !== JSON.stringify(lenses.get())) { lenses.set(set); log("info", "lenses", set); void syncDevice(); }
}
addOnCameraDevicesChangedListener(() => readLenses());
setTimeout(readLenses, 0);

/** On Android ANDROID_ID: stable across reinstalls, new after a factory reset, one per signing key. Elsewhere a random id kept on the phone. */
const fallbackId = persisted<string | null>("deviceFallbackId.v1", null);
function fingerprint(): string {
  try { if (Platform.OS === "android") { const id = Application.getAndroidId(); if (id) return id; } } catch { /* below */ }
  return fallbackId.get() ?? (fallbackId.set(randomUUID()), fallbackId.get()!);
}

function report(): DeviceReport {
  const k = (Platform.constants ?? {}) as { Manufacturer?: string; Brand?: string; Model?: string; model?: string };
  const { width, height } = Dimensions.get("screen");
  const short = Math.round(Math.min(width, height)), long = Math.round(Math.max(width, height));
  const make = (k.Manufacturer ?? k.Brand ?? Platform.OS).slice(0, 120);
  return {
    fingerprint: fingerprint(),
    kind: short >= 600 ? "tablet" : "phone",
    make: make.charAt(0).toUpperCase() + make.slice(1),
    model: (k.Model ?? k.model ?? "").slice(0, 120),
    lenses: lenses.get().lenses.map(deviceLens),
    screen: short > 0 ? { portrait: { w: short, h: long }, landscape: { w: long, h: short } } : null,
    app: APP_VERSION.slice(0, 60),
  };
}
/** The model as the phone reports it, for the screens before registration. */
export const reportedModel = () => { const r = report(); return `${r.make} ${r.model}`.trim(); };

const take = (f: FileRec) => device.set((d) => ({
  ...d, userId: signedInUserId(),
  file: { id: f.id, name: d.dirty.name && d.file ? d.file.name : f.name, body: f.body ?? {} },
  tabs: d.dirty.tabs ? d.tabs : Array.isArray(f.body?.tabs) ? (f.body!.tabs as string[]) : d.tabs,
}));

let running: Promise<void> | null = null;

/**
 * Registers the device (or finds its record again) and keeps it current, then saves what was
 * changed here. Waits a moment for the camera to report its lenses on the first run.
 */
export function syncDevice(): Promise<void> {
  if (running) return running;
  running = (async () => {
    const user = signedInUserId();
    if (!user || !canCall()) return;
    if (!lensesRead) { readLenses(); if (!lensesRead) await new Promise((r) => setTimeout(r, 1500)); readLenses(); }
    if (device.get().userId !== user) device.set({ userId: user, file: null, tabs: device.get().tabs, dirty: { tabs: device.get().dirty.tabs } });
    try {
      take(await registerDevice(report()));
      const { file, dirty, tabs } = device.get();
      if (file && (dirty.tabs || dirty.name)) {
        const saved = await putFile(file.id, { type: "device", home: true, name: file.name, body: { ...file.body, tabs } });
        device.set((d) => ({ ...d, dirty: {} }));
        take(saved);
      }
    } catch (e) { log("warn", "device sync failed", e); }
  })().finally(() => { running = null; });
  return running;
}

/** The person's choice of tabs on this device, in order; Setup is always there and not part of it. */
export function setTabs(tabs: string[]) {
  device.set((d) => ({ ...d, tabs: [...tabs.filter((t) => t !== "setup"), "setup"], dirty: { ...d.dirty, tabs: true } }));
  void syncDevice();
}

export function renameDevice(name: string) {
  const n = name.trim().slice(0, 120);
  if (!n) return;
  device.set((d) => (d.file ? { ...d, file: { ...d.file, name: n }, dirty: { ...d.dirty, name: true } } : d));
  void syncDevice();
}
