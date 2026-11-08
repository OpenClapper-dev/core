import { effectSettingsOf, type Curve, type EffectId, type EffectSettings } from "@openclapper/vocab";

/**
 * Aputure's light commands inside the mesh (#213): one access message with the Telink vendor
 * opcode 0x26 and a 10-byte payload. Byte 0 is a checksum (sum of bytes 1–9), byte 9 the command
 * type; the fields are bit-packed into bytes 0–7 (bit n = byte n >> 3, bit n & 7) plus byte 8.
 * Layout from wesbos/amaran-BLE-control (MIT), itself verified against hardware; checked here
 * against vectors produced by that implementation.
 */
export const TELINK_OPCODE = 0x26;
export const CMD = { HSI: 0x81, CCT: 0x82, POWER: 0x8c, INTENSITY: 0x8f, STATUS: 0x0e, BATTERY: 0x0a, CURVE: 0x88 } as const;

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

/**
 * First-generation built-in effects (#291): command 0x87, the effect's code in byte 8, the app's
 * default fields as [value, bit] pairs, intensity (0..1000) at bit 46 or 54, the run bit at bit 8.
 * From neyako/amaran-hacs (MIT), taken there from the decompiled Sidus Link app and confirmed on
 * amaran lights by their own reports.
 */
const EFFECT_CMD = 0x87;
const EFFECT_STOP = 15;
const GEN1: Record<EffectId, { code: number; fields: [number, number][]; intensityBit: 46 | 54 }> = {
  club_lights: { code: 0, fields: [[5, 50]], intensityBit: 54 },
  paparazzi: { code: 1, fields: [[10, 33], [560, 40], [5, 50]], intensityBit: 54 },
  lightning: { code: 2, fields: [[5, 27], [2, 31], [10, 33], [560, 40], [5, 50]], intensityBit: 54 },
  tv: { code: 3, fields: [[5, 50]], intensityBit: 54 },
  candle: { code: 4, fields: [[5, 50]], intensityBit: 54 },
  fire: { code: 5, fields: [[5, 50]], intensityBit: 54 },
  strobe: { code: 6, fields: [[2, 28], [100, 30], [5, 56], [1, 60]], intensityBit: 46 },
  explosion: { code: 7, fields: [[1, 28], [100, 30], [5, 56], [1, 60]], intensityBit: 46 },
  faulty_bulb: { code: 8, fields: [[5, 24], [2, 28], [100, 30], [5, 56], [1, 60]], intensityBit: 46 },
  pulsing: { code: 9, fields: [[5, 24], [2, 28], [100, 30], [5, 56], [1, 60]], intensityBit: 46 },
  welding: { code: 10, fields: [[18, 21], [2, 28], [100, 30], [5, 56], [1, 60]], intensityBit: 46 },
  cop_car: { code: 11, fields: [[2, 46], [5, 50]], intensityBit: 54 },
  color_chase: { code: 12, fields: [[100, 43], [5, 50]], intensityBit: 54 },
  party_lights: { code: 13, fields: [[100, 43], [5, 50]], intensityBit: 54 },
  fireworks: { code: 14, fields: [[5, 50]], intensityBit: 54 },
};

const bitLength = (v: number) => (v ? Math.floor(Math.log2(v)) + 1 : 0);

const step = (v: number | undefined, max: number) => clamp(Math.round(v ?? 5), 1, max);

/** A white-only effect's colour temperature: kelvin in tens, above 10 000 K offset with a flag; green/magenta sent neutral. */
function putWhite(p: Uint8Array, kelvin: number | undefined, flagBit: number, gmBit: number, cctBit: number) {
  const tens = clamp(Math.round((kelvin ?? 5600) / 10), 80, 2000);
  setBits(p, flagBit, 1, tens > 1000 ? 1 : 0);
  setBits(p, gmBit, 7, 10);
  setBits(p, cctBit, 10, tens > 1000 ? tens - 1000 : tens);
}
const whiteOf = (p: Uint8Array, flagBit: number, cctBit: number) => (getBits(p, cctBit, 10) + (getBits(p, flagBit, 1) ? 1000 : 0)) * 10;

interface Layout {
  intensityBit: number;
  encode(p: Uint8Array, o: EffectSettings, trigger: boolean): void;
  /** Null when the packet is not a form this layout makes (another colour mode). */
  decode(p: Uint8Array): EffectSettings | null;
}

/**
 * Faulty bulb and Pulsing (#292): intensity at 46, frequency at 56, colour mode at 60 (0 white,
 * 1 colour). White: temperature flag 20, speed 23, trigger 27, green/magenta 29, kelvin at 36.
 * Colour: speed 24, trigger 28, saturation 30, hue 37. Trigger 2 = automatic.
 */
const BULB: Layout = {
  intensityBit: 46,
  encode(p, o) {
    const color = o.color ?? { h: 0, s: 1 };
    if ("kelvin" in color) {
      putWhite(p, color.kelvin, 20, 29, 36);
      setBits(p, 23, 4, step(o.speed, 11));
      setBits(p, 27, 2, 2);
      setBits(p, 60, 4, 0);
    } else {
      setBits(p, 24, 4, step(o.speed, 11));
      setBits(p, 28, 2, 2);
      setBits(p, 30, 7, clamp(Math.round(color.s * 100), 0, 100));
      setBits(p, 37, 9, clamp(Math.round(color.h), 0, 360));
      setBits(p, 60, 4, 1);
    }
    setBits(p, 56, 4, step(o.frequency, 11));
  },
  decode(p) {
    const mode = getBits(p, 60, 4);
    if (mode === 0) return { frequency: getBits(p, 56, 4), speed: getBits(p, 23, 4), color: { kelvin: whiteOf(p, 20, 36) } };
    if (mode === 1) return { frequency: getBits(p, 56, 4), speed: getBits(p, 24, 4), color: { h: Math.min(360, getBits(p, 37, 9)), s: Math.min(100, getBits(p, 30, 7)) / 100 } };
    return null;
  },
};

/** The other MC effects (#300) share intensity at 54 and frequency at 50; their own field sits below. */
function simple(field: (p: Uint8Array, o: EffectSettings) => void, read: (p: Uint8Array) => EffectSettings, freqMax: number): Layout {
  return {
    intensityBit: 54,
    encode(p, o) { field(p, o); setBits(p, 50, 4, step(o.frequency, freqMax)); },
    decode(p) { return { ...read(p), frequency: getBits(p, 50, 4) }; },
  };
}
const tone = simple((p, o) => setBits(p, 40, 10, clamp(o.choice ?? 0, 0, 2)), (p) => ({ choice: getBits(p, 40, 10) }), 11);

/** Effects with options, from Sidus Link 2.0.42's effect classes (decompiled with Aputure's permission). */
const LAYOUTS: Partial<Record<EffectId, Layout>> = {
  faulty_bulb: BULB,
  pulsing: BULB,
  paparazzi: simple((p, o) => putWhite(p, o.kelvin, 30, 33, 40), (p) => ({ kelvin: whiteOf(p, 30, 40) }), 10),
  lightning: {
    intensityBit: 54,
    // Trigger 1 strikes once now; 2 is the automatic pattern.
    encode(p, o, trigger) { putWhite(p, o.kelvin, 24, 33, 40); setBits(p, 27, 4, step(o.speed, 11)); setBits(p, 31, 2, trigger ? 1 : 2); setBits(p, 50, 4, step(o.frequency, 11)); },
    decode(p) { return { kelvin: whiteOf(p, 24, 40), speed: getBits(p, 27, 4), frequency: getBits(p, 50, 4) }; },
  },
  tv: tone,
  fire: tone,
  cop_car: simple((p, o) => setBits(p, 46, 4, clamp(o.choice ?? 2, 0, 4)), (p) => ({ choice: getBits(p, 46, 4) }), 10),
  party_lights: simple((p, o) => setBits(p, 43, 7, clamp(Math.round((o.saturation ?? 1) * 100), 0, 100)), (p) => ({ saturation: Math.min(100, getBits(p, 43, 7)) / 100 }), 11),
  fireworks: simple((p, o) => setBits(p, 42, 8, clamp(o.choice ?? 0, 0, 2)), (p) => ({ choice: getBits(p, 42, 8) }), 11),
};

/**
 * Run a built-in effect at an intensity 0..1, with its options where it has them (missing ones take
 * Sidus Link's defaults), or the app's preset. `trigger` fires one Lightning strike now.
 */
export function effect(id: EffectId, i: number, settings?: EffectSettings, trigger = false) {
  const layout = LAYOUTS[id];
  if (layout) {
    const p = new Uint8Array(10);
    setBits(p, 8, 1, 1);
    layout.encode(p, effectSettingsOf(id, settings), trigger);
    setBits(p, layout.intensityBit, 10, Math.round(clamp(i, 0, 1) * 1000));
    p[8] = GEN1[id].code;
    return finish(p, EFFECT_CMD);
  }
  const e = GEN1[id];
  const p = new Uint8Array(10);
  for (const [value, bit] of e.fields) setBits(p, bit, bitLength(value), value);
  setBits(p, 8, 1, 1);
  setBits(p, e.intensityBit, 10, Math.round(clamp(i, 0, 1) * 1000));
  p[8] = e.code;
  return finish(p, EFFECT_CMD);
}

/** Stop the running effect: the light returns to plain white. */
export function effectOff() { const p = new Uint8Array(10); p[8] = EFFECT_STOP; return finish(p, EFFECT_CMD); }

/**
 * A report of a running effect (or of the stop), or null. Effects with options come back with them;
 * the preset-only ones with a mode field (codes 6–10) only in mode 1, the one the presets use.
 */
export function parseEffect(p: Uint8Array): { effect: EffectId | null; on: boolean; intensity: number; settings?: EffectSettings } | null {
  if (p.length !== 10 || p[0] !== checksum(p) || (p[9] & 0x7f) !== (EFFECT_CMD & 0x7f)) return null;
  if (p[8] === EFFECT_STOP) return { effect: null, on: getBits(p, 8, 1) === 1, intensity: 0 };
  const hit = (Object.entries(GEN1) as [EffectId, (typeof GEN1)[EffectId]][]).find(([, e]) => e.code === p[8]);
  if (!hit) return null;
  const [id, e] = hit;
  const on = getBits(p, 8, 1) === 1;
  const layout = LAYOUTS[id];
  if (layout) {
    const settings = layout.decode(p);
    return settings ? { effect: id, on, intensity: Math.min(1000, getBits(p, layout.intensityBit, 10)) / 1000, settings } : null;
  }
  if (e.intensityBit === 46 && getBits(p, 60, 4) !== 1) return null;
  return { effect: id, on, intensity: Math.min(1000, getBits(p, e.intensityBit, 10)) / 1000 };
}

/** The curve values Sidus Link sends (its White screen: Linear, Exponential, Logarithmic, S). */
const CURVE_VALUE: Record<Curve, number> = { linear: 0, exp: 1, log: 2, s: 3 };

/**
 * The light's dimming curve (#289): its own command, type 0x08, the curve in byte 8. From Sidus Link
 * 2.0.42 (decompiled with Aputure's permission). The light does not report it back.
 */
export function curve(c: Curve) { const p = new Uint8Array(10); p[8] = CURVE_VALUE[c]; return finish(p, CMD.CURVE); }

/**
 * Program → Continue (#289): the light runs it by itself, fade in to the target (curve, up to 25.5 s),
 * hold (1023 tenths = for ever), fade out (curve, time). Type 0x15; layout from Sidus Link 2.0.42's
 * ProgramContinueProtocol (decompiled with Aputure's permission): fade-out curve at 9 (3 bits) and
 * time at 12 (8, tenths), hold at 20 (10), fade-in curve at 30 (3) and time at 33 (8), then white
 * (G/M + 10 at 41, 6 bits; K/10 at 47, 10 bits, bit 8 set above 10000 K) or colour (saturation at
 * 41, 7; hue at 48, 9), intensity 0..1000 at 57, base type at 67 (0 white, 1 colour), light type at 69.
 */
export function programFade(o: {
  intensity: number; fadeInMs: number; curve: Curve;
  white?: { kelvin: number; gm: number }; colour?: { h: number; s: number };
  /** null: hold for ever. */
  holdMs?: number | null; fadeOutMs?: number; fadeOutCurve?: Curve;
}) {
  const p = new Uint8Array(10);
  const tenths = (ms: number) => clamp(Math.round(ms / 100), 0, 255);
  setBits(p, 9, 3, CURVE_VALUE[o.fadeOutCurve ?? "linear"]);
  setBits(p, 12, 8, tenths(o.fadeOutMs ?? 0));
  setBits(p, 20, 10, o.holdMs == null ? 1023 : clamp(Math.round(o.holdMs / 100), 0, 1000));
  setBits(p, 30, 3, CURVE_VALUE[o.curve]);
  setBits(p, 33, 8, tenths(o.fadeInMs));
  if (o.colour) {
    setBits(p, 41, 7, clamp(Math.round(o.colour.s * 100), 0, 100));
    setBits(p, 48, 9, clamp(Math.round(o.colour.h), 0, 360));
    setBits(p, 67, 2, 1);
    setBits(p, 69, 3, 1);
  } else {
    const w = o.white ?? { kelvin: 5600, gm: 0 };
    let t = clamp(Math.round(w.kelvin / 10), 80, 2000);
    if (t > 1000) { setBits(p, 8, 1, 1); t -= 1000; }
    setBits(p, 47, 10, t);
    setBits(p, 41, 6, clamp(Math.round(w.gm) + 10, 0, 20));
  }
  setBits(p, 57, 10, Math.round(clamp(o.intensity, 0, 1) * 1000));
  return finish(p, PROGRAM_CONTINUE);
}
const PROGRAM_CONTINUE = 0x95;
