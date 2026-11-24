import { useEffect, useState } from "react";
import { randomUUID } from "expo-crypto";
import { modelOf, type HardwareBody } from "@openclapper/ext-hardware";
import { call, canCall, listFiles, putFile, binFiles, type FileRec } from "../../api";
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
export const getDevices = () => cache.get();
export const useDevices = () => cache.use();
export const onDevicesChange = (cb: () => void) => cache.subscribe(cb);

const isHardware = (f: FileRec) => f.type === "device" && !!f.body && !!modelOf((f.body as { model?: unknown }).model);
const fromFile = (f: FileRec): HardwareDevice => ({ id: f.id, name: f.name, body: f.body as unknown as HardwareBody, updated_at: f.updated_at ?? null });
function put(f: FileRec) {
  const d = fromFile(f);
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
/** Takes the server's list of the account's hardware. Quiet when unreachable. */
export function syncDevices(): Promise<void> {
  syncing ??= (async () => {
    if (!canCall()) return;
    try {
      const files = await listFiles({ home: true }, { type: "device", body: true });
      cache.set(files.filter(isHardware).map(fromFile).sort((a, b) => a.name.localeCompare(b.name)));
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

/** Sleep or wake. Online only: the flag lives on the server, and an offline change would be undone by the next sync. */
export async function setAsleep(d: HardwareDevice, asleep: boolean) {
  const f = await putFile(d.id, { type: "device", home: true, body: { ...d.body, asleep } as unknown as Record<string, unknown> });
  put(f);
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
