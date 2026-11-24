import { aes, bytes, ccmDecrypt, ccmEncrypt, u16be, u24be, u32be } from "./crypto.ts";

/** What k2 derives from a NetKey (crypto.ts). */
export interface NetCredentials { nid: number; encKey: Uint8Array; privKey: Uint8Array }

export interface NetworkMessage {
  /** A control message (transport opcodes, proxy configuration) rather than an access message. */
  ctl: boolean;
  ttl: number;
  seq: number;
  src: number;
  dst: number;
  /** The lower transport PDU. */
  transport: Uint8Array;
}

/** Proxy configuration messages use the proxy nonce; everything else the network nonce. */
export type NonceKind = "network" | "proxy";

function nonce(kind: NonceKind, m: Pick<NetworkMessage, "ctl" | "ttl" | "seq" | "src">, ivIndex: number) {
  const second = kind === "proxy" ? 0 : ((m.ctl ? 0x80 : 0) | (m.ttl & 0x7f));
  return bytes([kind === "proxy" ? 0x03 : 0x00, second], u24be(m.seq), u16be(m.src), [0, 0], u32be(ivIndex));
}

/** The network MIC is 64 bits for control messages, 32 for access messages (§3.4.4). */
export const netMicLen = (ctl: boolean): 4 | 8 => (ctl ? 8 : 4);

function pecb(privKey: Uint8Array, ivIndex: number, privacyRandom: Uint8Array) {
  return aes(privKey, bytes([0, 0, 0, 0, 0], u32be(ivIndex), privacyRandom.subarray(0, 7)));
}

/**
 * A network PDU (§3.4.4): IVI/NID, the obfuscated CTL/TTL/SEQ/SRC, then DST and the transport PDU
 * encrypted with the network key. `micLen` is only for the proxy filter's sake (see proxy.ts).
 */
export function encodeNetworkPdu(k: NetCredentials, ivIndex: number, m: NetworkMessage, kind: NonceKind = "network", micLen = netMicLen(m.ctl)): Uint8Array {
  const sealed = ccmEncrypt(k.encKey, nonce(kind, m, ivIndex), bytes(u16be(m.dst), m.transport), micLen as 4 | 8);
  const p = pecb(k.privKey, ivIndex, sealed);
  const header = bytes([(m.ctl ? 0x80 : 0) | (m.ttl & 0x7f)], u24be(m.seq), u16be(m.src)).map((v, i) => v ^ p[i]);
  return bytes([((ivIndex & 1) << 7) | (k.nid & 0x7f)], header, sealed);
}

/**
 * The message in a network PDU, or null when it is not one of ours: another NID, or a MIC that
 * does not match. The IV index's low bit picks the current or the previous index.
 */
export function decodeNetworkPdu(k: NetCredentials, ivIndex: number, pdu: Uint8Array, kind: NonceKind = "network"): NetworkMessage | null {
  if (pdu.length < 14 || (pdu[0] & 0x7f) !== k.nid) return null;
  const iv = (pdu[0] >> 7) === (ivIndex & 1) ? ivIndex : ivIndex - 1;
  if (iv < 0) return null;
  const sealed = pdu.subarray(7);
  const p = pecb(k.privKey, iv, sealed);
  const h = pdu.subarray(1, 7).map((v, i) => v ^ p[i]);
  const m = { ctl: (h[0] & 0x80) !== 0, ttl: h[0] & 0x7f, seq: (h[1] << 16) | (h[2] << 8) | h[3], src: (h[4] << 8) | h[5] };
  for (const micLen of kind === "proxy" ? [8, 4] as const : [netMicLen(m.ctl)]) {
    const plain = ccmDecrypt(k.encKey, nonce(kind, m, iv), sealed, micLen);
    if (plain && plain.length >= 2) return { ...m, dst: (plain[0] << 8) | plain[1], transport: plain.subarray(2) };
  }
  return null;
}
