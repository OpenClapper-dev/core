/**
 * Blackmagic camera control over Bluetooth LE (#318): the SDI Camera Control Protocol's messages,
 * carried by the Blackmagic Camera Service. From Blackmagic's own documents ("Blackmagic Camera
 * Control", Aug 2025, protocol v1.6.2; the Pocket Cinema Camera manual's developer section, v1.5).
 * Shared: the phone encodes and decodes, the Studio names parameters and builds commands.
 */

export const BMD_SERVICE = "291d567a-6d75-11e6-8b77-86f30ca893d3";
export const BMD_OUTGOING = "5dd3465f-1aee-4299-8493-d2eca2f8e1bb";
export const BMD_INCOMING = "b864e140-76a0-416a-bf30-5876504537d9";
export const BMD_TIMECODE = "6d8f2110-86f1-41bf-9afb-451d87e976c8";
export const BMD_STATUS = "7fe8691d-95dc-4fc5-8abd-ca74339b51b9";
export const BMD_DEVICE_NAME = "ffac0c52-c9fb-41a0-b063-cc76282eb89c";
export const BMD_PROTOCOL_VERSION = "8f1fd018-b508-456f-8f82-3d392bee2706";

/** Data types: void/boolean, signed integers, UTF-8 (no terminator), fixed16 (signed 5.11). */
export const CCU_TYPE = { bool: 0, int8: 1, int16: 2, int32: 3, int64: 4, string: 5, fixed16: 128 } as const;
export type CcuType = (typeof CCU_TYPE)[keyof typeof CCU_TYPE];
/** Assign a value, or offset it (a non-zero offset on a boolean toggles it). */
export type CcuOperation = 0 | 1;

export interface CcuMessage {
  category: number;
  parameter: number;
  type: CcuType;
  operation: CcuOperation;
  /** Numbers as the type holds them (fixed16 as real values, e.g. 0.5); a string for UTF-8; [] for void. */
  data: number[] | string;
}

/** Broadcast: every camera on the link. */
export const CCU_BROADCAST = 255;
const SIZE: Record<number, number> = { 0: 1, 1: 1, 2: 2, 3: 4, 4: 8, 128: 2 };

/** One message: header (destination, length, command 0, reserved), command, data padded to 32 bits. */
export function encodeCcu(m: CcuMessage, destination = CCU_BROADCAST): Uint8Array {
  const body: number[] = [];
  if (typeof m.data === "string") body.push(...new TextEncoder().encode(m.data));
  else {
    const size = SIZE[m.type] ?? 1;
    for (const v of m.data) {
      const n = m.type === CCU_TYPE.fixed16 ? Math.round(v * 2048) : Math.round(v);
      const big = BigInt.asUintN(size * 8, BigInt(n));
      for (let i = 0; i < size; i++) body.push(Number((big >> BigInt(8 * i)) & 0xffn));
    }
  }
  const len = 4 + body.length;
  const out = [destination & 0xff, len, 0, 0, m.category, m.parameter, m.type, m.operation, ...body];
  while (out.length % 4) out.push(0);
  return Uint8Array.from(out);
}

/** Every message in a notification (the camera may send several back to back); malformed tails are dropped. */
export function decodeCcu(b: Uint8Array): CcuMessage[] {
  const out: CcuMessage[] = [];
  let i = 0;
  while (i + 8 <= b.length) {
    const len = b[i + 1];
    if (len < 4 || i + 4 + len > b.length) break;
    const category = b[i + 4], parameter = b[i + 5], type = b[i + 6] as CcuType, operation = (b[i + 7] & 1) as CcuOperation;
    const raw = b.subarray(i + 8, i + 4 + len);
    let data: number[] | string;
    if (type === CCU_TYPE.string) data = new TextDecoder().decode(raw);
    else {
      const size = SIZE[type] ?? 1;
      data = [];
      for (let j = 0; j + size <= raw.length; j += size) {
        let v = 0n;
        for (let k = size - 1; k >= 0; k--) v = (v << 8n) | BigInt(raw[j + k]);
        const n = Number(BigInt.asIntN(size * 8, v));
        data.push(type === CCU_TYPE.fixed16 ? n / 2048 : n);
      }
    }
    out.push({ category, parameter, type, operation, data });
    i += 4 + len + ((4 - ((4 + len) % 4)) % 4);
  }
  return out;
}

/** Camera Status flags (the Status characteristic). */
export const BMD_STATUS_FLAGS = { powerOn: 0x01, connected: 0x02, paired: 0x04, versionsVerified: 0x08, initialPayload: 0x10, ready: 0x20 } as const;

/** The Timecode characteristic: 32-bit BCD HH:MM:SS:FF (09:12:53:10 = 0x09125310), little-endian. */
export function timecodeOf(b: Uint8Array): string | null {
  if (b.length < 4) return null;
  const v = (b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)) >>> 0;
  const hex = v.toString(16).padStart(8, "0");
  return `${hex.slice(0, 2)}:${hex.slice(2, 4)}:${hex.slice(4, 6)}:${hex.slice(6, 8)}`;
}

/** "c.p", the key a parameter's state is kept under. */
export const ccuKey = (category: number, parameter: number) => `${category}.${parameter}`;

/** The documented parameters, by key: name and data type (for the Studio's readout and controls). */
export const CCU_PARAMS: Record<string, { name: string; type: CcuType }> = {
  "0.0": { name: "Focus", type: 128 }, "0.1": { name: "Instant autofocus", type: 0 }, "0.2": { name: "Aperture (f-stop)", type: 128 },
  "0.3": { name: "Aperture (normalised)", type: 128 }, "0.4": { name: "Aperture (ordinal)", type: 2 }, "0.5": { name: "Instant auto aperture", type: 0 },
  "0.6": { name: "Optical image stabilisation", type: 0 }, "0.7": { name: "Zoom (mm)", type: 2 }, "0.8": { name: "Zoom (normalised)", type: 128 },
  "0.9": { name: "Continuous zoom", type: 128 },
  "1.0": { name: "Video mode", type: 1 }, "1.1": { name: "Gain (old)", type: 1 }, "1.2": { name: "White balance", type: 2 }, "1.3": { name: "Auto white balance", type: 0 },
  "1.4": { name: "Restore auto white balance", type: 0 }, "1.5": { name: "Exposure (µs)", type: 3 }, "1.6": { name: "Exposure (ordinal)", type: 2 },
  "1.7": { name: "Dynamic range", type: 1 }, "1.8": { name: "Sharpening", type: 1 }, "1.9": { name: "Recording format", type: 2 },
  "1.10": { name: "Auto exposure mode", type: 1 }, "1.11": { name: "Shutter angle", type: 3 }, "1.12": { name: "Shutter speed", type: 3 },
  "1.13": { name: "Gain (dB)", type: 1 }, "1.14": { name: "ISO", type: 3 }, "1.15": { name: "Display LUT", type: 1 }, "1.16": { name: "ND filter", type: 128 },
  "2.0": { name: "Mic level", type: 128 }, "2.1": { name: "Headphone level", type: 128 }, "2.2": { name: "Headphone mix", type: 128 }, "2.3": { name: "Speaker level", type: 128 },
  "2.4": { name: "Audio input type", type: 1 }, "2.5": { name: "Audio input levels", type: 128 }, "2.6": { name: "Phantom power", type: 0 },
  "3.0": { name: "Overlay enables", type: 2 }, "3.1": { name: "Frame guide style (old)", type: 1 }, "3.2": { name: "Frame guide opacity (old)", type: 128 }, "3.3": { name: "Overlays", type: 1 },
  "4.0": { name: "Display brightness", type: 128 }, "4.1": { name: "Exposure and focus tools", type: 2 }, "4.2": { name: "Zebra level", type: 128 },
  "4.3": { name: "Peaking level", type: 128 }, "4.4": { name: "Colour bars", type: 1 }, "4.5": { name: "Focus assist", type: 1 }, "4.6": { name: "Program return feed", type: 1 },
  "4.7": { name: "Timecode source", type: 1 },
  "5.0": { name: "Tally brightness", type: 128 }, "5.1": { name: "Front tally brightness", type: 128 }, "5.2": { name: "Rear tally brightness", type: 128 },
  "6.0": { name: "Reference source", type: 1 }, "6.1": { name: "Reference offset", type: 3 },
  "7.0": { name: "Real time clock", type: 3 }, "7.1": { name: "Language", type: 5 }, "7.2": { name: "Timezone", type: 3 }, "7.3": { name: "Location", type: 4 },
  "8.0": { name: "Lift", type: 128 }, "8.1": { name: "Gamma", type: 128 }, "8.2": { name: "Gain", type: 128 }, "8.3": { name: "Offset", type: 128 },
  "8.4": { name: "Contrast", type: 128 }, "8.5": { name: "Luma mix", type: 128 }, "8.6": { name: "Colour (hue, saturation)", type: 128 }, "8.7": { name: "Reset colour correction", type: 0 },
  "10.0": { name: "Codec", type: 1 }, "10.1": { name: "Transport", type: 1 }, "10.2": { name: "Playback control", type: 1 }, "10.3": { name: "Still capture", type: 0 },
  "11.0": { name: "Pan/tilt velocity", type: 128 }, "11.1": { name: "Memory preset", type: 1 },
  "12.0": { name: "Reel", type: 2 }, "12.1": { name: "Scene tags", type: 1 }, "12.2": { name: "Scene", type: 5 }, "12.3": { name: "Take", type: 1 },
  "12.4": { name: "Good take", type: 0 }, "12.5": { name: "Camera id", type: 5 }, "12.6": { name: "Camera operator", type: 5 }, "12.7": { name: "Director", type: 5 },
  "12.8": { name: "Project name", type: 5 }, "12.9": { name: "Lens type", type: 5 }, "12.10": { name: "Lens iris", type: 5 }, "12.11": { name: "Lens focal length", type: 5 },
  "12.12": { name: "Lens distance", type: 5 }, "12.13": { name: "Lens filter", type: 5 }, "12.14": { name: "Slate mode", type: 1 }, "12.15": { name: "Slate target", type: 5 },
};

/** Exposure and focus tools (4.1) bits; protocol v1.6.2's second value names the outputs (TARGET_DISPLAYS). */
export const TOOL_BITS = { zebra: 0x1, focusAssist: 0x2, falseColor: 0x4 } as const;
export const TARGET_DISPLAYS = { lcd: 0x1, hdmi: 0x2, evf: 0x4, mainSdi: 0x8, frontSdi: 0x10 } as const;

/** Camera state as the phone proxy reports it (Telemetry.camera). */
export interface CameraTelemetry {
  /** The last value the camera reported per parameter, by ccuKey. */
  params: Record<string, number[] | string>;
  timecode?: string;
  /** Camera Status flags (BMD_STATUS_FLAGS). */
  status?: number;
  protocolVersion?: string;
  /** The latest incoming messages, newest first, as "c.p type op: data" with the raw bytes (the probe of #318). */
  log: string[];
}
