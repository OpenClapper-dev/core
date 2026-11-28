import { useEffect, useState } from "react";
import { randomUUID } from "expo-crypto";
import { modelOf, type HardwareBody } from "@openclapper/ext-hardware";
import { call, canCall, isRejection, listFiles, putFile, binFiles, type FileRec } from "../../api";
import { log } from "../../log";
import { persisted } from "../../store";
import type { Fixture } from "./bt/types";

/**
 * The account's hardware (docs/features/hardware.md): device files of the home whose kind is a hardware type,
 * kept on the phone so the proxy holds them offline too. The server's list wins after each sync. The drivers
 * see each device as a `Fixture` (their own word, from the first app).
 */
export interface HardwareDevice { id: string; name: string; body: HardwareBody; updated_at: string | null }

const cache = persisted<HardwareDevice[]>("hardware.devices.v1", [], Array.isArray);
/** Sleep and wake made on this phone and not yet on the server, by device id: they stay on top of the server's list until sent. */
const unsentSleep = persisted<Record<string, boolean>>("hardware.sleepEdits.v1", {}, (v) => typeof v === "object" && v !== null && !Array.isArray(v));
export const getDevices = () => cache.get();
export const useDevices = () => cache.use();
export const onDevicesChange = (cb: () => void) => cache.subscribe(cb);

const isHardware = (f: FileRec) => f.type === "device" && !!f.body && !!modelOf((f.body as { model?: unknown }).model);
const fromFile = (f: FileRec): HardwareDevice => ({ id: f.id, name: f.name, body: f.body as unknown as HardwareBody, updated_at: f.updated_at ?? null });
/** A device with this phone's unsent sleep or wake over the server's flag. */
function withUnsent(d: HardwareDevice): HardwareDevice {
  const edits = unsentSleep.get();
  return d.id in edits && edits[d.id] !== d.body.asleep ? { ...d, body: { ...d.body, asleep: edits[d.id] } } : d;
}
function put(f: FileRec) {
  const d = withUnsent(fromFile(f));
  cache.set((l) => (l.some((x) => x.id === d.id) ? l.map((x) => (x.id === d.id ? d : x)) : [...l, d]).sort((a, b) => a.name.localeCompare(b.name)));
}

/** What the drivers and the hub work with. */
export const fixtureOf = (d: HardwareDevice): Fixture => ({
  id: d.id, label: d.name, kindId: d.body.model, address: d.body.address ?? "", asleep: d.body.asleep, synced: true, createdAt: "",
  mesh: d.body.mesh ? { networkId: d.body.mesh.network, unicast: d.body.mesh.unicast, elements: d.body.mesh.elements } : null,
});
/** The devices the phone can reach over Bluetooth, as fixtures. */
export const getFixtures = (): Fixture[] => getDevices().filter((d) => d.body.address).map(fixtureOf);

let syncing: Promise<void> | null = null;
/** Sends this phone's unsent sleep and wake, then takes the server's list of the account's hardware (unsent changes kept on top). Quiet when unreachable. */
export function syncDevices(): Promise<void> {
  syncing ??= (async () => {
    if (!canCall()) return;
    try {
      await sendSleep();
      const files = await listFiles({ home: true }, { type: "device", body: true });
      // A device saved while the list was on its way (a sleep sent meanwhile) keeps the newer copy.
      const newer = (d: HardwareDevice) => { const had = getDevices().find((x) => x.id === d.id); return had?.updated_at && d.updated_at && had.updated_at > d.updated_at ? had : d; };
      cache.set(files.filter(isHardware).map((f) => withUnsent(newer(fromFile(f)))).sort((a, b) => a.name.localeCompare(b.name)));
    } catch (e) { log("info", "hardware sync skipped", { error: e }); }
  })().finally(() => { syncing = null; });
  return syncing;
}

/** Adds a device (pairing). Online only: a device is a file of the account. */
export async function addDevice(model: string, address: string | null, name?: string): Promise<HardwareDevice> {
  const r = await call<{ file: FileRec }>("/api/hardware/devices", { method: "POST", body: { id: randomUUID(), model, address, ...(name ? { name } : {}) } });
  put(r.file);
  return fromFile(r.file);
}
const change = async (id: string, path: string, body: unknown) => { const r = await call<{ file: FileRec }>(`/api/hardware/devices/${id}/${path}`, { method: "PUT", body }); put(r.file); return fromFile(r.file); };
/** The battery a light runs on, or null for a socket. */
export const setPower = (id: string, battery: string | null) => change(id, "power", { battery });
/** Where a mesh light sits in the phone's network, or nowhere. */
export const setMesh = (id: string, mesh: { network: string; unicast: number; elements: number } | null) => change(id, "mesh", mesh ?? { network: null });

const sleepSent = new Set<() => void>();
/** Told when a sleep or wake made here reached the server (the proxy then has the other phones sync). */
export function onSleepSent(cb: () => void): () => void { sleepSent.add(cb); return () => { sleepSent.delete(cb); }; }

/**
 * Sleep or wake, at once and also offline (#426): the phone's list changes now, so the proxy lets go of the device
 * (or takes it again) without waiting for the server; the flag is sent when the server answers, and a sync meanwhile
 * keeps it.
 */
export function setAsleep(d: HardwareDevice, asleep: boolean) {
  unsentSleep.set((all) => ({ ...all, [d.id]: asleep }));
  cache.set((l) => l.map((x) => (x.id === d.id ? withUnsent(x) : x)));
  void sendSleep();
}

let sending: Promise<void> | null = null;
/** Sends the waiting sleep and wake, one device at a time. A network error stops the run until the next sync; a refusal (the device is gone) drops the change. */
function sendSleep(): Promise<void> {
  sending ??= (async () => {
    let sent = false;
    for (const [id, asleep] of Object.entries(unsentSleep.get())) {
      if (!canCall()) break;
      const d = getDevices().find((x) => x.id === id);
      // Dropped once sent, unless changed again on the way (that one goes with the next run).
      const done = () => unsentSleep.set((all) => { if (all[id] !== asleep) return all; const { [id]: _sent, ...rest } = all; void _sent; return rest; });
      if (!d) { done(); continue; }
      try {
        const f = await putFile(id, { type: "device", home: true, body: { ...d.body, asleep } as unknown as Record<string, unknown> });
        done();
        put(f);
        sent = true;
      } catch (e) {
        if (!isRejection(e)) { log("info", "sleep not sent", { device: id, error: e }); break; }
        log("warn", "sleep refused", { device: id, error: e });
        done();
      }
    }
    if (sent) for (const cb of sleepSent) cb();
  })().finally(() => { sending = null; });
  return sending;
}
/**
 * Keep a light on while nothing else holds it (#426, passive mode's override). This phone's list changes now, so the
 * proxy here acts at once; the flag is saved with the device for every client (online).
 */
export async function setKeepOn(d: HardwareDevice, keepOn: boolean) {
  const body: HardwareBody = { ...d.body };
  if (keepOn) body.keepOn = true; else delete body.keepOn;
  cache.set((l) => l.map((x) => (x.id === d.id ? { ...x, body } : x)));
  try { put(await putFile(d.id, { type: "device", home: true, body: body as unknown as Record<string, unknown> })); }
  catch (e) { cache.set((l) => l.map((x) => (x.id === d.id ? d : x))); throw e; }
}
export async function renameDevice(d: HardwareDevice, name: string) {
  const f = await putFile(d.id, { type: "device", home: true, name: name.trim().slice(0, 120) });
  put(f);
}
/** To the recycle bin: a mesh light still holds the network's keys until it is reset by hand. */
export async function removeDevice(d: HardwareDevice) {
  await binFiles([d.id]);
  cache.set((l) => l.filter((x) => x.id !== d.id));
}

/** Re-renders with the list. */
export function useDevice(id: string | null): HardwareDevice | null {
  const list = useDevices();
  const [d, set] = useState<HardwareDevice | null>(null);
  useEffect(() => { set(list.find((x) => x.id === id) ?? null); }, [list, id]);
  return d;
}
