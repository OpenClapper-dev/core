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

/** Report every advertising device (repeats included) until the returned function is called. */
export function scan(onSeen: (d: Seen) => void, onError: (e: unknown) => void): () => void {
  let stopped = false;
  ble().startDeviceScan(null, { allowDuplicates: false }, (err, d) => {
    if (stopped) return;
    if (err) { onError(err); return; }
    if (d) onSeen({ address: d.id, name: d.localName ?? d.name, rssi: d.rssi, serviceUUIDs: d.serviceUUIDs });
  }).catch(onError);
  return () => { stopped = true; void ble().stopDeviceScan().catch(() => {}); };
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
    onDisconnect(cb) {
      const sub = m.onDeviceDisconnected(address, (err) => cb(err));
      return () => sub.remove();
    },
    async close() { await m.cancelDeviceConnection(address).catch(() => {}); },
  };
}
