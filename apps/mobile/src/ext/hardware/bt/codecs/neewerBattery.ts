import { checksum, frame } from "./neewer.ts";

/**
 * The NEEWER PS099S V-mount battery (#210), decoded from an HCI snoop of the NEEWER app (#207).
 * Same service as the lights (codecs/neewer.ts), but its own frames carry no address:
 * `78 <tag> <len> <payload> <checksum>`. The app polls the readout once a second; the reply is 85
 * bytes, split over several notifications at a small MTU.
 */
const PREFIX = 0x78;

/** A frame without the address. */
export function shortFrame(tag: number, payload: number[]): Uint8Array {
  const body = [PREFIX, tag, payload.length, ...payload];
  return Uint8Array.from([...body, checksum(body)]);
}

/** Ask for the readout: `78 cd 01 00`, every second. */
export const pollFrame = () => shortFrame(0xcd, [0x00]);

/** What the app sends on connect: a short status, the hello the lights get too, the info query. */
export const batteryHelloFrames = (address: string): Uint8Array[] => [
  shortFrame(0xcd, [0x01]),
  frame(0x95, address, []),
  shortFrame(0x80, []),
];

/** The readout's tag; shorter replies with this tag (the status on connect) mean something else. */
const READOUT = 0x18;
const READOUT_MIN_LEN = 0x20;

export interface Readout {
  /** 0..100 */
  charge: number;
  volts: number;
  amps: number;
  /** volts × amps: the battery reports current, not power. */
  watts: number;
  /** Feeding a load. */
  discharging: boolean;
}

/**
 * The readout in a complete frame, or null. Offsets from the frame's first byte: charge at 4,
 * pack voltage in mV at 5–6 and current in mA at 7–8 (both big-endian), state at 10 (2 =
 * discharging). Checked against a 100 W load: 6 520 mA at 15.50 V.
 */
export function parseReadout(b: Uint8Array): Readout | null {
  if (b.length < 4 || b[0] !== PREFIX || b[1] !== READOUT || b[2] < READOUT_MIN_LEN) return null;
  const end = 3 + b[2];
  if (b.length <= end || b[end] !== checksum(b.subarray(0, end))) return null;
  const mv = (b[5] << 8) | b[6];
  const ma = (b[7] << 8) | b[8];
  return { charge: b[4], volts: mv / 1000, amps: ma / 1000, watts: (mv * ma) / 1e6, discharging: b[10] === 2 };
}

/** The model name in the info reply (tag 0x00), e.g. "PS099S". */
export function batteryModel(b: Uint8Array): string | null {
  if (b[0] !== PREFIX || b[1] !== 0x00) return null;
  const m = /PS\d{3}[A-Z]?/.exec(String.fromCharCode(...b.subarray(3).filter((x) => x >= 0x20 && x < 0x7f)));
  return m ? m[0] : null;
}

/**
 * Joins notifications into frames. A frame starts with 0x78 and says its length; the rest of a long
 * reply arrives in the following notifications. The bare `78 78` the battery answers the hello
 * with is not a frame and is dropped, as is a notification that neither starts nor continues one.
 */
export class FrameAssembler {
  private buf: number[] = [];

  push(chunk: Uint8Array): Uint8Array[] {
    if (chunk.length === 2 && chunk[0] === PREFIX && chunk[1] === PREFIX) return [];
    if (!this.buf.length) {
      if (chunk[0] !== PREFIX) return [];
      // The info reply's third byte is not its length (`78 00 13` on a 16-byte frame): a single
      // notification whose last byte checks out is a frame on its own.
      const declared = chunk.length >= 3 ? 4 + chunk[2] : Infinity;
      if (declared > chunk.length && chunk.length >= 4 && chunk[chunk.length - 1] === checksum(chunk.subarray(0, chunk.length - 1))) return [chunk];
    }
    this.buf.push(...chunk);
    const out: Uint8Array[] = [];
    for (;;) {
      const start = this.buf.indexOf(PREFIX);
      if (start < 0) { this.buf = []; break; }
      if (start > 0) this.buf.splice(0, start);
      if (this.buf.length < 3) break;
      const total = 3 + this.buf[2] + 1;
      if (this.buf.length < total) break;
      out.push(Uint8Array.from(this.buf.splice(0, total)));
    }
    return out;
  }

  private stuck = false;

  /**
   * Called once per poll: a partial frame that was already waiting at the previous call lost a
   * notification and is dropped, so it cannot shift every later one. A reply arriving right now
   * is left alone.
   */
  dropStale() {
    if (this.stuck) this.buf = [];
    this.stuck = this.buf.length > 0;
  }
}
