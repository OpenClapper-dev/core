import type { Curve, EffectId, EffectSettings } from "@openclapper/vocab";

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

/**
 * The short white frame NEEWER 5.8.0's Music FX streams after `d3 01` (smoothing off): intensity,
 * kelvin/100 and G/M + 50, without the curve and decimal bytes. Music must follow the beat at once,
 * so this is the app's only white command meant to land instantly (#206).
 */
export function quickWhiteFrame(address: string, w: { intensity: number; kelvin: number; gm?: number }): Uint8Array {
  const bri = Math.round(Math.min(1, Math.max(0, w.intensity)) * 100);
  return frame(0x90, address, [0x87, bri, Math.round(w.kelvin / 100), Math.round(Math.min(50, Math.max(-50, w.gm ?? 0))) + 50]);
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

/**
 * Smooth or instant changes (tag D3; NEEWER 5.8.0 sends 00 for its gradient modes and while idle, 01
 * while it streams music or blink effects): 00 = the light eases between values, 01 = it jumps.
 */
export const smoothFrame = (address: string, smooth: boolean) => frame(0xd3, address, [smooth ? 0x00 : 0x01]);

/** Asks for the light's state; the answer is tag 0x04 (parseState). The app sends it on connect. */
export const stateQuery = (address: string) => frame(0x8e, address, [0x85]);

/** The FS series' effects (scene class 5): device id and parameter layout, from NEEWER 5.8.0. */
type Field = "int" | "intMin" | "intMax" | "k" | "kMax" | "gm" | "rate" | "ember" | "zero";
export const NW_EFFECT_LAYOUT: Partial<Record<EffectId, { id: number; fields: readonly Field[] }>> = {
  nw_flash: { id: 1, fields: ["int", "k", "rate"] },
  nw_paparazzi: { id: 2, fields: ["int", "k", "gm", "rate"] },
  nw_bad_bulb: { id: 3, fields: ["int", "k", "gm", "rate"] },
  nw_explosion: { id: 4, fields: ["int", "k", "gm", "rate", "ember"] },
  nw_welding: { id: 5, fields: ["intMin", "intMax", "k", "gm", "rate"] },
  nw_cct_flicker: { id: 6, fields: ["int", "k", "gm", "rate"] },
  nw_cct_pulse: { id: 8, fields: ["int", "k", "gm", "rate"] },
  nw_candle: { id: 11, fields: ["intMin", "intMax", "k", "gm", "rate", "ember"] },
  nw_cct_loop: { id: 13, fields: ["int", "k", "kMax", "rate"] },
  // Mode 0 (white), then the colour range the white mode ignores.
  nw_intensity_loop: { id: 14, fields: ["zero", "intMin", "intMax", "zero", "zero", "k", "rate"] },
  nw_tv: { id: 15, fields: ["intMin", "intMax", "k", "gm", "rate"] },
  // Mode 0: the white kind, the only one the FS lights get.
  nw_fireworks: { id: 16, fields: ["int", "zero", "rate", "ember"] },
};

/**
 * A built-in effect (tag 0x91, subtag 0x8B, then the effect id and its fields): intensity 0..100,
 * kelvin in hundreds, G/M 50 (the app hides it for these effects), speed and sparks 1..10. Ranges
 * clamp to the light's 2700–6500 K. Stopping is a white-light frame again: there is no "effect off".
 */
export function effectFrame(address: string, effect: EffectId, intensity: number, s: EffectSettings): Uint8Array {
  const l = NW_EFFECT_LAYOUT[effect];
  if (!l) throw new Error(`NEEWER lights have no ${effect}`);
  const pct = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 100);
  const k = (v: number) => Math.round(Math.min(6500, Math.max(2700, v)) / 100);
  const step = (v: number | undefined) => Math.min(10, Math.max(1, Math.round(v ?? 5)));
  const value: Record<Field, number> = {
    int: pct(intensity), intMin: pct(s.intensityMin ?? 0), intMax: pct(s.intensityMax ?? 0.5),
    k: k(s.kelvin ?? 5500), kMax: k(s.kelvinMax ?? 5600), gm: 50, rate: step(s.frequency), ember: step(s.ember), zero: 0,
  };
  return frame(0x91, address, [0x8b, l.id, ...l.fields.map((f) => value[f])]);
}

const CURVE_OF: Record<number, Curve> = { 1: "exp", 2: "log", 3: "s", 4: "linear" };

/** What the light says it shows (the reply to stateQuery, tag 0x04): power, then mode 1 (white) or 3 (an effect). */
export interface NeewerState { power: boolean; intensity?: number; kelvin?: number; gm?: number; curve?: Curve; effect?: EffectId | null }

export function parseState(n: Notice): NeewerState | null {
  if (n.tag !== 0x04 || n.payload.length < 3) return null;
  const [, power, mode, ...p] = n.payload;
  const out: NeewerState = { power: power === 1 };
  if (mode === 1 && p.length >= 4) {
    Object.assign(out, { intensity: Math.min(100, p[0]) / 100, kelvin: p[1] * 100, gm: p[2] - 50, effect: null, ...(CURVE_OF[p[3]] ? { curve: CURVE_OF[p[3]] } : {}) });
  } else if (mode === 3 && p.length >= 1) {
    const id = (Object.entries(NW_EFFECT_LAYOUT) as [EffectId, { id: number }][]).find(([, l]) => l.id === p[0])?.[0];
    if (id) out.effect = id;
  }
  return out;
}
