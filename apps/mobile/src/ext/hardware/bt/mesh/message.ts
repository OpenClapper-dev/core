import { decryptAccess, encryptAccess, lowerPdus, Reassembler, segmentAck, type Incoming, type KeyKind } from "./transport.ts";
import { decodeNetworkPdu, encodeNetworkPdu, type NetCredentials } from "./network.ts";
import { parseAccess, type Access } from "./access.ts";
import type { SeqAllocator } from "./seq.ts";

/**
 * The phone's side of a mesh exchange, without Bluetooth (#211): an access message in, network
 * PDUs out (one per segment), and the reverse for what the nodes send back. mesh/session.ts (#213)
 * puts these into proxy PDUs on the GATT link.
 */

/** Hops a message may take; the reference client and the Telink SDK use 10. */
export const DEFAULT_TTL = 10;

export interface Keys {
  net: NetCredentials;
  ivIndex: number;
  /** The phone's own unicast address (the provisioner's). */
  src: number;
}

export interface Outgoing {
  dst: number;
  access: Uint8Array;
  /** An AppKey with its AID, or a node's device key (configuration messages). */
  key: { kind: "app"; key: Uint8Array; aid: number } | { kind: "device"; key: Uint8Array };
  ttl?: number;
}

/** Network PDUs for one access message; takes one sequence number per segment. */
export function encodeAccessMessage(k: Keys, seq: SeqAllocator, m: Outgoing): Uint8Array[] {
  const ref = m.key.kind === "app" ? { akf: true, aid: m.key.aid } : { akf: false, aid: 0 };
  // The upper PDU's length decides the segment count before any number is taken.
  const upperLen = m.access.length + 4;
  const count = upperLen <= 15 ? 1 : Math.ceil(upperLen / 12);
  const first = seq.take(count);
  const upper = encryptAccess(m.key.key, m.key.kind, { seq: first, src: k.src, dst: m.dst, ivIndex: k.ivIndex }, m.access);
  return lowerPdus(upper, ref, first).map((transport, i) =>
    encodeNetworkPdu(k.net, k.ivIndex, { ctl: false, ttl: m.ttl ?? DEFAULT_TTL, seq: first + i, src: k.src, dst: m.dst, transport }));
}

export interface Received {
  src: number;
  dst: number;
  access: Access;
  keyKind: KeyKind;
  /** A Segment Acknowledgment to send back (segmented messages to the phone). */
  ack: Uint8Array[] | null;
}

/**
 * Feeds network PDUs from the proxy; returns an access message once one is complete and decrypts
 * with one of the keys (the AppKey whose AID matches, or the source node's device key).
 */
export class Inbox {
  private readonly parts = new Reassembler();
  private readonly k: Keys;
  private readonly appKeys: { key: Uint8Array; aid: number }[];
  private readonly devKeyOf: (src: number) => Uint8Array | undefined;
  private readonly seq: SeqAllocator;

  constructor(k: Keys, appKeys: { key: Uint8Array; aid: number }[], devKeyOf: (src: number) => Uint8Array | undefined, seq: SeqAllocator) {
    this.k = k;
    this.appKeys = appKeys;
    this.devKeyOf = devKeyOf;
    this.seq = seq;
  }

  push(pdu: Uint8Array): Received | null {
    const m = decodeNetworkPdu(this.k.net, this.k.ivIndex, pdu);
    if (!m || m.ctl) return null;
    const inc = this.parts.push(m);
    return inc ? this.open(inc) : null;
  }

  private open(inc: Incoming): Received | null {
    const at = { seq: inc.seqAuth, src: inc.src, dst: inc.dst, ivIndex: this.k.ivIndex, szmic: inc.szmic };
    let plain: Uint8Array | null = null, keyKind: KeyKind = "app";
    if (inc.ref.akf) {
      for (const a of this.appKeys) if (a.aid === inc.ref.aid && (plain = decryptAccess(a.key, "app", at, inc.upper))) break;
    } else {
      const dev = this.devKeyOf(inc.src);
      keyKind = "device";
      if (dev) plain = decryptAccess(dev, "device", at, inc.upper);
    }
    const access = plain && parseAccess(plain);
    if (!access) return null;
    const ack = inc.ack && inc.dst === this.k.src
      ? [encodeNetworkPdu(this.k.net, this.k.ivIndex, { ctl: true, ttl: DEFAULT_TTL, seq: this.seq.take(), src: this.k.src, dst: inc.src, transport: segmentAck(inc.ack.seqZero, inc.ack.blockAck) })]
      : null;
    return { src: inc.src, dst: inc.dst, access, keyKind, ack };
  }
}
