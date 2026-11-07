/**
 * Aputure's light commands inside the mesh (#213): one access message with the Telink vendor
 * opcode 0x26 and a 10-byte payload. Byte 0 is a checksum (sum of bytes 1–9), byte 9 the command
 * type; the fields are bit-packed into bytes 0–7 (bit n = byte n >> 3, bit n & 7) plus byte 8.
 * Layout from wesbos/amaran-BLE-control (MIT), itself verified against hardware; checked here
 * against vectors produced by that implementation.
 */
export const TELINK_OPCODE = 0x26;
export const CMD = { HSI: 0x81, CCT: 0x82, POWER: 0x8c, INTENSITY: 0x8f, STATUS: 0x0e, BATTERY: 0x0a } as const;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function setBits(p: Uint8Array, offset: number, width: number, value: number) {
  for (let i = 0; i < width; i++) if ((value >> i) & 1) p[(offset + i) >> 3] |= 1 << ((offset + i) & 7);
}
function getBits(p: Uint8Array, offset: number, width: number): number {
  let v = 0;
  for (let i = 0; i < width; i++) v |= ((p[(offset + i) >> 3] >> ((offset + i) & 7)) & 1) << i;
  return v;
}
const checksum = (p: Uint8Array) => { let s = 0; for (let i = 1; i < 10; i++) s += p[i]; return s & 0xff; };
function finish(p: Uint8Array, type: number) { p[9] = type; p[0] = checksum(p); return p; }

/** Intensity 0..1 → the light's 0..1000: the low two bits at bit 62, the rest in byte 8. */
function putIntensity(p: Uint8Array, i: number) {
  const v = Math.round(clamp(i, 0, 1) * 1000);
  setBits(p, 62, 2, v & 3);
  p[8] = (v >> 2) & 0xff;
}
const intensityOf = (p: Uint8Array) => Math.min(1000, (p[8] << 2) | getBits(p, 62, 2)) / 1000;

export const statusRequest = () => finish(new Uint8Array(10), CMD.STATUS);

export function power(on: boolean) { const p = new Uint8Array(10); p[8] = on ? 1 : 0; return finish(p, CMD.POWER); }

export function intensity(i: number) { const p = new Uint8Array(10); putIntensity(p, i); return finish(p, CMD.INTENSITY); }

/**
 * White: kelvin in tens (80..2000) at bit 52, above 10 000 K offset with bit 42 set; green/magenta
 * −10..+10 as 0..20 at bit 45 (10 = neutral); intensity as everywhere.
 */
export function cct(kelvin: number, i: number, gm = 0) {
  const p = new Uint8Array(10);
  const t = clamp(Math.trunc((kelvin + 5) / 10), 80, 2000);
  if (t < 1001) setBits(p, 52, 10, t);
  else { setBits(p, 52, 10, (t + 0x18) & 0x3ff); setBits(p, 42, 1, 1); }
  setBits(p, 45, 7, clamp(Math.round(gm) + 10, 0, 20));
  putIntensity(p, i);
  return finish(p, CMD.CCT);
}

/** Colour: saturation 0..100 at bit 46, hue 0..360 at bit 53, intensity as everywhere. */
export function hsi(hue: number, saturation: number, i: number) {
  const p = new Uint8Array(10);
  setBits(p, 46, 7, clamp(Math.round(saturation * 100), 0, 100));
  setBits(p, 53, 9, clamp(Math.round(hue), 0, 360));
  putIntensity(p, i);
  return finish(p, CMD.HSI);
}

export interface SidusStatus {
  on: boolean;
  /** 0..1 */
  intensity: number;
  mode: "cct" | "hsi";
  kelvin?: number;
  gm?: number;
  hue?: number;
  /** 0..1 */
  saturation?: number;
}

/**
 * What a light reports (type 0x02 in white, 0x01 in colour; the top bit set on an echo of a
 * command). Null for a bad checksum or another page (0x0a is diagnostics).
 */
export function parseStatus(p: Uint8Array): SidusStatus | null {
  if (p.length !== 10 || p[0] !== checksum(p)) return null;
  const type = p[9] & 0x7f;
  const on = getBits(p, 8, 1) === 1;
  if (type === 0x02) {
    const raw = getBits(p, 52, 10);
    const tens = getBits(p, 42, 1) ? raw + 1000 : raw;
    return { on, intensity: intensityOf(p), mode: "cct", kelvin: tens * 10, gm: clamp(getBits(p, 45, 7) - 10, -10, 10) };
  }
  if (type === 0x01) {
    return { on, intensity: intensityOf(p), mode: "hsi", hue: Math.min(360, getBits(p, 53, 9)), saturation: Math.min(100, getBits(p, 46, 7)) / 100 };
  }
  return null;
}

/** Ask for the battery page (#293). */
export const batteryRequest = () => finish(new Uint8Array(10), CMD.BATTERY);

export interface SidusBattery {
  /** 0..100 */
  charge: number;
  volts: number;
  /** The light's own estimate. */
  minutesLeft: number;
  /** An external supply is connected (not necessarily charging). */
  plugged: boolean;
}

/**
 * The battery page (type 0x0a): minutes left in byte 3 plus bit 0 of byte 4, charge in bits 1–7
 * of byte 4, battery and external supply in mV (bytes 5–6 and 7–8, little-endian). Layout from
 * neyako/amaran-hacs (MIT), taken from the decompiled Sidus Link app and verified on an Ace 25c.
 */
export function parseBattery(p: Uint8Array): SidusBattery | null {
  if (p.length !== 10 || p[0] !== checksum(p) || (p[9] & 0x7f) !== CMD.BATTERY) return null;
  return {
    minutesLeft: p[3] | ((p[4] & 1) << 8),
    charge: Math.min(100, p[4] >> 1),
    volts: (p[5] | (p[6] << 8)) / 1000,
    plugged: (p[7] | (p[8] << 8)) > 0,
  };
}
