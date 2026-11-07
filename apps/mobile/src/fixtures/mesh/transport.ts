import { bytes, ccmDecrypt, ccmEncrypt, u16be, u24be, u32be } from "./crypto.ts";

/**
 * Upper and lower transport (Mesh Profile 1.0.1 §3.5–3.6) for the phone's mesh client (#211):
 * access messages encrypted with an application key (AKF 1, the AID) or a node's device key
 * (configuration), split into 12-byte segments when longer than one PDU, and the incoming side.
 */

export type KeyKind = "app" | "device";

/** The largest upper transport PDU that fits one unsegmented lower PDU (§3.5.2.1). */
export const UNSEGMENTED_MAX = 15;
const SEGMENT = 12;

function accessNonce(kind: KeyKind, seq: number, src: number, dst: number, ivIndex: number, szmic: boolean) {
  return bytes([kind === "app" ? 0x01 : 0x02, szmic ? 0x80 : 0x00], u24be(seq), u16be(src), u16be(dst), u32be(ivIndex));
}

/** The access PDU encrypted for the upper transport, with its TransMIC (32-bit unless szmic). */
export function encryptAccess(key: Uint8Array, kind: KeyKind, a: { seq: number; src: number; dst: number; ivIndex: number; szmic?: boolean }, access: Uint8Array): Uint8Array {
  return ccmEncrypt(key, accessNonce(kind, a.seq, a.src, a.dst, a.ivIndex, !!a.szmic), access, a.szmic ? 8 : 4);
}

export function decryptAccess(key: Uint8Array, kind: KeyKind, a: { seq: number; src: number; dst: number; ivIndex: number; szmic?: boolean }, upper: Uint8Array): Uint8Array | null {
  return ccmDecrypt(key, accessNonce(kind, a.seq, a.src, a.dst, a.ivIndex, !!a.szmic), upper, a.szmic ? 8 : 4);
}

/** AKF and AID as the first byte carries them: device key = AKF 0, AID 0. */
export interface KeyRef { akf: boolean; aid: number }

/**
 * Lower transport PDUs for an upper PDU sent with sequence number `seq`: one unsegmented PDU, or
 * segments whose network messages take `seq`, `seq + 1`, … in order (the first one's seq is the
 * SeqAuth the upper transport was encrypted with).
 */
export function lowerPdus(upper: Uint8Array, ref: KeyRef, seq: number, opts: { forceSegmented?: boolean; szmic?: boolean } = {}): Uint8Array[] {
  const first = (ref.akf ? 0x40 : 0) | (ref.aid & 0x3f);
  if (upper.length <= UNSEGMENTED_MAX && !opts.forceSegmented) return [bytes([first], upper)];
  const seqZero = seq & 0x1fff;
  const segN = Math.ceil(upper.length / SEGMENT) - 1;
  if (segN > 31) throw new Error("access message too long for 32 segments");
  const out: Uint8Array[] = [];
  for (let segO = 0; segO <= segN; segO++) {
    out.push(bytes(
      [0x80 | first, (opts.szmic ? 0x80 : 0) | (seqZero >> 6), ((seqZero & 0x3f) << 2) | (segO >> 3), ((segO & 7) << 5) | segN],
      upper.subarray(segO * SEGMENT, (segO + 1) * SEGMENT),
    ));
  }
  return out;
}

/** A Segment Acknowledgment (control opcode 0x00) for the segments set in `blockAck`. */
export const segmentAck = (seqZero: number, blockAck: number, onBehalfOfFriend = false) =>
  bytes([0x00, (onBehalfOfFriend ? 0x80 : 0) | ((seqZero >> 6) & 0x7f), (seqZero & 0x3f) << 2], u32be(blockAck >>> 0));

export interface Incoming {
  /** Complete upper transport PDU, still encrypted. */
  upper: Uint8Array;
  ref: KeyRef;
  szmic: boolean;
  /** The sequence number the upper PDU was encrypted with. */
  seqAuth: number;
  src: number;
  dst: number;
  /** For a segmented message: what to acknowledge (all segments received). */
  ack: { seqZero: number; blockAck: number } | null;
}

/** The full sequence number a SeqZero belongs to, from a segment's own (later) sequence number. */
export function seqAuthOf(seq: number, seqZero: number): number {
  let s = (seq & ~0x1fff) | seqZero;
  if (s > seq) s -= 0x2000;
  return s;
}

/**
 * Collects the lower transport PDUs of access messages (CTL 0) and hands out complete ones.
 * Segments are kept per source and SeqZero; a message is complete when every segment arrived,
 * whatever their order. Control PDUs (CTL 1) are not passed here.
 */
export class Reassembler {
  private open = new Map<string, { parts: (Uint8Array | null)[]; ref: KeyRef; szmic: boolean; seqAuth: number }>();

  push(m: { seq: number; src: number; dst: number; transport: Uint8Array }): Incoming | null {
    const t = m.transport;
    const ref = { akf: (t[0] & 0x40) !== 0, aid: t[0] & 0x3f };
    if (!(t[0] & 0x80)) return { upper: t.subarray(1), ref, szmic: false, seqAuth: m.seq, src: m.src, dst: m.dst, ack: null };
    if (t.length < 5) return null;
    const szmic = (t[1] & 0x80) !== 0;
    const seqZero = ((t[1] & 0x7f) << 6) | (t[2] >> 2);
    const segO = ((t[2] & 3) << 3) | (t[3] >> 5);
    const segN = t[3] & 0x1f;
    if (segO > segN) return null;
    const key = `${m.src}:${seqZero}`;
    let entry = this.open.get(key);
    if (!entry || entry.parts.length !== segN + 1) {
      entry = { parts: Array.from({ length: segN + 1 }, () => null), ref, szmic, seqAuth: seqAuthOf(m.seq, seqZero) };
      this.open.set(key, entry);
    }
    entry.parts[segO] = t.subarray(4);
    if (entry.parts.some((p) => p === null)) return null;
    this.open.delete(key);
    return {
      upper: bytes(...(entry.parts as Uint8Array[])), ref: entry.ref, szmic: entry.szmic, seqAuth: entry.seqAuth, src: m.src, dst: m.dst,
      ack: { seqZero, blockAck: segN === 31 ? 0xffffffff : (2 ** (segN + 1)) - 1 },
    };
  }
}
