import type { Curve } from "@openclapper/vocab";

/**
 * NEEWER "Infinity" lights (FS230B, FS300B), decoded from an HCI snoop of the NEEWER app (#207,
 * #209). Every frame is `78 <tag> <len> <MAC> <payload…> <checksum>`: `len` counts the MAC and the
 * payload, the checksum is the sum of all bytes before it. The MAC is the light's own Bluetooth
 * address, in the order Android shows it.
 */
export const NEEWER_SERVICE = "69400001-b5a3-f393-e0a9-e50e24dcca99";
export const NEEWER_WRITE = "69400002-b5a3-f393-e0a9-e50e24dcca99";
export const NEEWER_NOTIFY = "69400003-b5a3-f393-e0a9-e50e24dcca99";

const PREFIX = 0x78;

export function macBytes(address: string): number[] {
  const parts = address.split(":").map((x) => parseInt(x, 16));
  if (parts.length !== 6 || parts.some((x) => !(x >= 0 && x <= 255))) throw new Error(`not a Bluetooth address: ${address}`);
  return parts;
}

export const checksum = (bytes: ArrayLike<number>) => { let sum = 0; for (let i = 0; i < bytes.length; i++) sum += bytes[i]; return sum & 0xff; };

export function frame(tag: number, address: string, payload: number[]): Uint8Array {
  const body = [PREFIX, tag, 6 + payload.length, ...macBytes(address), ...payload];
  return Uint8Array.from([...body, checksum(body)]);
}

/** The curve byte of the white-light command, as the app's four buttons send it. */
export const CURVE_BYTE: Record<Curve, number> = { exp: 1, log: 2, s: 3, linear: 4 };

export const powerFrame = (address: string, on: boolean) => frame(0x8d, address, [0x81, on ? 0x01 : 0x02]);

/**
 * Intensity, white and curve travel together: the app has no intensity-only command, so the
 * driver always sends all three. Kelvin in hundreds (2700 K = 27); green/magenta 50 = neutral, the
 * only value the app sends for the bi-colour lights.
 */
export function whiteFrame(address: string, w: { intensity: number; kelvin: number; curve: Curve; gm?: number }): Uint8Array {
  const bri = Math.round(Math.min(1, Math.max(0, w.intensity)) * 100);
  const cct = Math.round(w.kelvin / 100);
  const gm = Math.round(Math.min(50, Math.max(-50, w.gm ?? 0))) + 50;
  return frame(0x90, address, [0x87, bri, cct, gm, CURVE_BYTE[w.curve], 0x00]);
}

/** What the app sends right after connecting: a hello and five queries. Replayed so the light sees the same start. */
export const helloFrames = (address: string): Uint8Array[] => [
  frame(0x9f, address, [0x01, 0x00, 0xff, 0xff, 0xff, 0xff]),
  frame(0x8e, address, [0x85]),
  frame(0x95, address, []),
  frame(0xd3, address, [0x00]),
  frame(0xd1, address, []),
  frame(0x9e, address, []),
];

export interface Notice { tag: number; address: string; payload: number[]; ok: boolean }

/** A notification frame, or null when it is not one (a continuation of a longer reply). */
export function parseNotice(b: Uint8Array): Notice | null {
  if (b.length < 10 || b[0] !== PREFIX) return null;
  const len = b[2];
  const end = 3 + len;
  const address = Array.from(b.subarray(3, 9), (x) => x.toString(16).padStart(2, "0").toUpperCase()).join(":");
  return { tag: b[1], address, payload: Array.from(b.subarray(9, Math.min(end, b.length))), ok: b.length > end && b[end] === checksum(b.subarray(0, end)) };
}

/** The model name in the info reply (tag 0x08), e.g. "FS150B" from an FS230B: they share firmware. */
export function modelOf(n: Notice): string | null {
  if (n.tag !== 0x08) return null;
  const text = String.fromCharCode(...n.payload.filter((x) => x >= 0x20 && x < 0x7f));
  const m = /[A-Z]{2}\d{2,4}[A-Z]?/.exec(text);
  return m ? m[0] : null;
}
