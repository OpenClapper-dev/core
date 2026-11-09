import { BleManager } from "@sfourdrinier/react-native-ble-plx";
import { fromBase64, toBase64 } from "../fixtures/bytes.ts";
import type { Link } from "../fixtures/types.ts";

/**
 * The only file that talks to the Bluetooth library (lights, epic #206): drivers, the hub and
 * the tests see `Link`. One manager for the app's lifetime, created on first use so the app does
 * not touch Bluetooth until Lights is opened.
 */
let manager: BleManager | null = null;
const ble = () => (manager ??= new BleManager());

export type Adapter = "on" | "off" | "unauthorized" | "unsupported" | "unknown";

/** Whether Bluetooth can be used right now. */
export async function adapterState(): Promise<Adapter> {
  const s = await ble().state();
  return s === "PoweredOn" ? "on" : s === "PoweredOff" ? "off" : s === "Unauthorized" ? "unauthorized" : s === "Unsupported" ? "unsupported" : "unknown";
}

export interface Seen { address: string; name: string | null; rssi: number | null; serviceUUIDs: string[] | null }

interface Scanner { onSeen: (d: Seen) => void; onError: (e: unknown) => void }
const scanners = new Set<Scanner>();
let scanning = false;

/**
 * Report every advertising device (repeats included) until the returned function is called. The
 * library runs one scan at a time (a second start replaces the first), so every caller (pairing,
 * the proxy's presence check) shares one: it runs while anyone listens.
 */
export function scan(onSeen: (d: Seen) => void, onError: (e: unknown) => void): () => void {
  const s: Scanner = { onSeen, onError };
  scanners.add(s);
  if (!scanning) {
    scanning = true;
    ble().startDeviceScan(null, { allowDuplicates: true }, (err, d) => {
      if (err) { scanning = false; for (const x of [...scanners]) x.onError(err); return; }
      if (d) { const seen = { address: d.id, name: d.localName ?? d.name, rssi: d.rssi, serviceUUIDs: d.serviceUUIDs }; for (const x of [...scanners]) x.onSeen(seen); }
    }).catch((e) => { scanning = false; for (const x of [...scanners]) x.onError(e); });
  }
  return () => {
    if (!scanners.delete(s) || scanners.size) return;
    scanning = false;
    void ble().stopDeviceScan().catch(() => {});
  };
}

/** MTU asked for on connect: room for a NEEWER frame or a mesh proxy PDU in one write. */
const MTU = 247;
const CONNECT_TIMEOUT_MS = 15_000;

export async function connect(address: string): Promise<Link> {
  const m = ble();
  const device = await m.connectToDevice(address, { requestMTU: MTU, timeout: CONNECT_TIMEOUT_MS });
  try {
    await m.discoverAllServicesAndCharacteristicsForDevice(address);
  } catch (e) {
    await m.cancelDeviceConnection(address).catch(() => {});
    throw e;
  }
  return {
    address,
    mtu: device.mtu || 23,
    async write(service, characteristic, bytes, withResponse) {
      const v = toBase64(bytes);
      if (withResponse) await m.writeCharacteristicWithResponseForDevice(address, service, characteristic, v);
      else await m.writeCharacteristicWithoutResponseForDevice(address, service, characteristic, v);
    },
    async notify(service, characteristic, cb) {
      const sub = m.monitorCharacteristicForDevice(address, service, characteristic, (err, c) => { if (!err && c?.value) cb(fromBase64(c.value)); });
      return () => sub.remove();
    },
    async read(service, characteristic) {
      const c = await m.readCharacteristicForDevice(address, service, characteristic);
      return c.value ? fromBase64(c.value) : new Uint8Array();
    },
    onDisconnect(cb) {
      const sub = m.onDeviceDisconnected(address, (err) => cb(err));
      return () => sub.remove();
    },
    async close() { await m.cancelDeviceConnection(address).catch(() => {}); },
  };
}
