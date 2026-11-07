import type { Link } from "../types.ts";
import { OP, accessPdu } from "./access.ts";
import { aesCmac, beaconKey, bytes, k2, k3, k4, u16be, u32be } from "./crypto.ts";
import { encodeAccessMessage, Inbox, type Keys, type Received } from "./message.ts";
import { decodeNetworkPdu, encodeNetworkPdu } from "./network.ts";
import { PDU, proxyChunks, ProxyReassembler } from "./proxy.ts";
import { SeqAllocator } from "./seq.ts";

/**
 * A simulated Aputure light acting as GATT proxy and mesh node, for the tests (#212, #213): it
 * sends its beacon, answers the proxy filter, and handles configuration and Telink messages the
 * way the protocol requires. Not used by the app.
 */
export interface FakeNodeOptions {
  netKey: Uint8Array;
  ivIndex: number;
  unicast: number;
  devKey: Uint8Array;
  /** Composition Data page 0. */
  composition: Uint8Array;
  /** Ignore this many access requests before answering (tests the repeats). */
  dropFirst?: number;
  mtu?: number;
  /** Start configured with this AppKey (skips AppKey Add in driver tests). */
  appKey?: Uint8Array;
  /** Reported in status replies to Telink 0x26 status requests (10-byte payload). */
  status?: Uint8Array;
}

export class FakeProxyNode {
  readonly received: Received[] = [];
  readonly filter: { type: number | null; addresses: number[] } = { type: null, addresses: [] };
  appKey: Uint8Array | null = null;
  readonly binds: string[] = [];
  /** Telink 0x26 payloads received, as hex. */
  readonly telink: string[] = [];
  private notify: ((b: Uint8Array) => void) | null = null;
  private readonly keys: Keys;
  private readonly seq = new SeqAllocator({ load: () => ({ next: 0, reserved: 1000 }), save: () => {} });
  private readonly inbox: Inbox;
  private readonly appKeys: { key: Uint8Array; aid: number }[] = [];
  private readonly reassembler = new ProxyReassembler();
  private readonly o: FakeNodeOptions;
  private drop: number;

  constructor(o: FakeNodeOptions) {
    this.o = o;
    this.drop = o.dropFirst ?? 0;
    this.keys = { net: k2(o.netKey), ivIndex: o.ivIndex, src: o.unicast };
    this.inbox = new Inbox(this.keys, this.appKeys, () => o.devKey, this.seq);
    if (o.appKey) { this.appKey = o.appKey; this.appKeys.push({ key: o.appKey, aid: k4(o.appKey) }); }
  }

  link(): Link {
    return {
      address: "DC:2C:26:00:00:01",
      mtu: this.o.mtu ?? 23,
      write: async (_s, _c, b) => { this.onWrite(b); },
      notify: async (_s, _c, cb) => { this.notify = cb; setImmediate(() => this.emit(PDU.BEACON, this.beacon())); return () => { this.notify = null; }; },
      onDisconnect: () => () => {},
      close: async () => {},
    };
  }

  private beacon() {
    const body = bytes([0x00], k3(this.o.netKey), u32be(this.o.ivIndex));
    return bytes([0x01], body, aesCmac(beaconKey(this.o.netKey), body).subarray(0, 8));
  }

  private emit(type: number, payload: Uint8Array) {
    for (const c of proxyChunks(type, payload, this.o.mtu ?? 23)) this.notify?.(c);
  }

  private onWrite(chunk: Uint8Array) {
    const p = this.reassembler.push(chunk);
    if (!p) return;
    if (p.type === PDU.CONFIG) {
      const m = decodeNetworkPdu(this.keys.net, this.keys.ivIndex, p.payload, "proxy");
      if (!m) return;
      if (m.transport[0] === 0x00) this.filter.type = m.transport[1];
      if (m.transport[0] === 0x01) for (let i = 1; i + 1 < m.transport.length; i += 2) this.filter.addresses.push((m.transport[i] << 8) | m.transport[i + 1]);
      const status = encodeNetworkPdu(this.keys.net, this.keys.ivIndex, { ctl: true, ttl: 0, seq: this.seq.take(), src: this.o.unicast, dst: 0, transport: Uint8Array.from([0x03, this.filter.type ?? 0, ...u16be(this.filter.addresses.length)]) }, "proxy", 8);
      this.emit(PDU.CONFIG, status);
      return;
    }
    if (p.type !== PDU.NETWORK) return;
    const r = this.inbox.push(p.payload);
    if (!r || r.dst !== this.o.unicast) return;
    this.received.push(r);
    if (this.drop > 0) { this.drop--; return; }
    if (r.access.opcode === 0x26) {
      this.telink.push(Array.from(r.access.params, (x) => x.toString(16).padStart(2, "0")).join(""));
      // A status request (type 0x0e) is answered with the light's state, under the AppKey.
      if (r.access.params[9] === 0x0e && this.o.status && this.appKey) {
        for (const pdu of encodeAccessMessage(this.keys, this.seq, { dst: r.src, access: bytes([0x26], this.o.status), key: { kind: "app", key: this.appKey, aid: k4(this.appKey) } })) this.emit(PDU.NETWORK, pdu);
      }
      return;
    }
    const reply = this.answer(r);
    if (reply) for (const pdu of encodeAccessMessage(this.keys, this.seq, { dst: r.src, access: reply, key: { kind: "device", key: this.o.devKey } })) this.emit(PDU.NETWORK, pdu);
  }

  private answer(r: Received): Uint8Array | null {
    const p = r.access.params;
    switch (r.access.opcode) {
      case OP.COMPOSITION_DATA_GET: return accessPdu(OP.COMPOSITION_DATA_STATUS, bytes([0], this.o.composition));
      case OP.APPKEY_ADD: {
        this.appKey = p.slice(3, 19);
        this.appKeys.push({ key: this.appKey, aid: k4(this.appKey) });
        return accessPdu(OP.APPKEY_STATUS, bytes([0], p.subarray(0, 3)));
      }
      case OP.MODEL_APP_BIND: this.binds.push(Array.from(p.subarray(4), (x) => x.toString(16).padStart(2, "0")).join("")); return accessPdu(OP.MODEL_APP_STATUS, bytes([0], p));
      default: return null;
    }
  }
}

