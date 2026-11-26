import { cameraOptics } from "../modules/camera-optics";
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
  /** The camera layout in use (the file's, or chosen here): a built-in id or a layout's id. */
  layout?: string;
  /** Tabs, name or layout changed here and not saved yet. */
  dirty: { tabs?: boolean; name?: boolean; layout?: boolean };
}
/**
 * Kept under `device.v2`: the first app (v0.16.0) stored its device specs under `device.v1`, a different shape, so a
 * phone that ran it read that entry and had no tabs. A stored value of another shape counts as none: registering
 * again finds the device by its fingerprint and takes its tabs and layout from the server.
 */
const isDeviceState = (v: unknown) => typeof v === "object" && v !== null && Array.isArray((v as DeviceState).tabs) && (v as DeviceState).tabs.every((t) => typeof t === "string") && typeof (v as DeviceState).dirty === "object" && (v as DeviceState).dirty !== null;
export const device = persisted<DeviceState>("device.v2", { userId: null, file: null, tabs: DEFAULT_TABS, dirty: {} }, isDeviceState);

/** The real lenses as last read from the camera (persisted, so Setup can list them with the camera closed). */
export const lenses = persisted<LensSet>("lenses.v1", { lenses: [], torch: false });
/**
 * Lenses switched off on this device (#426): a driver may report a lens that is not there (a 0.8× beside the 0.5×).
 * Gone for every app here, and marked `off` in the device file so the Studio leaves it out too. The main lens stays.
 */
export const lensesOff = persisted<string[]>("lensesOff.v1", [], (v) => Array.isArray(v) && v.every((x) => typeof x === "string"));
export function setLensOff(id: string, off: boolean) {
  lensesOff.set((all) => (off ? [...new Set([...all, id])] : all.filter((x) => x !== id)));
  void syncDevice();
}
/** The lenses the apps offer: the real ones without those switched off. */
export function useLensSet(): LensSet {
  const set = lenses.use(), off = lensesOff.use();
  return { ...set, lenses: set.lenses.filter((l) => l.main || !off.includes(l.id)) };
}
let lensesRead = false;
function readLenses() {
  // The 35 mm equivalents from Camera2 (#426); none in a dev client built before the module (no optics frame then).
  const optics = cameraOptics();
  const set = lensSet(getAllCameraDevices() as unknown as CamLike[], new Map(optics.flatMap((o) => (o.focal35 ? [[o.id, o.focal35] as const] : []))));
  if (!set.lenses.length) return;
  lensesRead = true;
  if (JSON.stringify(set) !== JSON.stringify(lenses.get())) { lenses.set(set); log("info", "lenses", { ...set, optics }); void syncDevice(); }
}
addOnCameraDevicesChangedListener(() => readLenses());
setTimeout(readLenses, 0);

/** The camera's area (bars and picture, without the tab bar) per orientation, as the camera last measured it: the Studio previews layouts at it. */
export const cameraArea = persisted<{ portrait: { w: number; h: number } | null; landscape: { w: number; h: number } | null }>("cameraArea.v1", { portrait: null, landscape: null });
/** The camera reports its area as laid out; a change is sent with the next registration. */
export function measureCamera(landscape: boolean, w: number, h: number) {
  const size = { w: Math.round(w), h: Math.round(h) }, key = landscape ? "landscape" : "portrait", cur = cameraArea.get()[key];
  if (size.w < 100 || size.h < 100 || (cur && cur.w === size.w && cur.h === size.h)) return;
  cameraArea.set((a) => ({ ...a, [key]: size }));
  void syncDevice();
}

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
    lenses: lenses.get().lenses.map((l) => ({ ...deviceLens(l), ...(!l.main && lensesOff.get().includes(l.id) ? { off: true } : {}) })),
    screen: short > 0 ? { portrait: { w: short, h: long }, landscape: { w: long, h: short } } : null,
    // Both orientations once both were measured; until then the other one is the first turned round.
    ...(() => { const a = cameraArea.get(), p = a.portrait ?? (a.landscape && { w: a.landscape.h, h: a.landscape.w }), l = a.landscape ?? (a.portrait && { w: a.portrait.h, h: a.portrait.w }); return p && l ? { camera: { portrait: p, landscape: l } } : {}; })(),
    app: APP_VERSION.slice(0, 60),
  };
}
/** The model as the phone reports it, for the screens before registration. */
export const reportedModel = () => { const r = report(); return `${r.make} ${r.model}`.trim(); };

const take = (f: FileRec) => device.set((d) => ({
  ...d, userId: signedInUserId(),
  file: { id: f.id, name: d.dirty.name && d.file ? d.file.name : f.name, body: f.body ?? {} },
  tabs: d.dirty.tabs ? d.tabs : Array.isArray(f.body?.tabs) ? (f.body!.tabs as string[]) : d.tabs,
  layout: d.dirty.layout ? d.layout : typeof f.body?.layout === "string" ? f.body.layout : d.layout,
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
      const { file, dirty, tabs, layout } = device.get();
      if (file && (dirty.tabs || dirty.name || dirty.layout)) {
        const saved = await putFile(file.id, { type: "device", home: true, name: file.name, body: { ...file.body, tabs, ...(layout ? { layout } : {}) } });
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

/** The camera layout this device uses (a built-in id or a layout's id); also set from the Studio. */
export function setDeviceLayout(id: string) {
  device.set((d) => ({ ...d, layout: id, dirty: { ...d.dirty, layout: true } }));
  void syncDevice();
}

export function renameDevice(name: string) {
  const n = name.trim().slice(0, 120);
  if (!n) return;
  device.set((d) => (d.file ? { ...d, file: { ...d.file, name: n }, dirty: { ...d.dirty, name: true } } : d));
  void syncDevice();
}
