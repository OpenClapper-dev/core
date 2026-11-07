import { aesCmac, beaconKey, bytes, k3, u16be } from "./crypto.ts";
import { decodeNetworkPdu, encodeNetworkPdu, type NetCredentials } from "./network.ts";

/**
 * The Mesh Proxy protocol (Mesh Profile 1.0.1 §6) over the GATT proxy service 0x1828 (#211):
 * PDUs split to the connection's MTU, the proxy filter the phone must set before any reply
 * reaches it, and the Secure Network Beacon that tells the IV index.
 */
export const PROXY_SERVICE = "00001828-0000-1000-8000-00805f9b34fb";
export const PROXY_DATA_IN = "00002add-0000-1000-8000-00805f9b34fb";
export const PROXY_DATA_OUT = "00002ade-0000-1000-8000-00805f9b34fb";

export const PDU = { NETWORK: 0, BEACON: 1, CONFIG: 2, PROVISIONING: 3 } as const;
const SAR = { COMPLETE: 0, FIRST: 1, CONTINUATION: 2, LAST: 3 } as const;

/** The writes for one proxy PDU at this MTU: 3 bytes go to the ATT header, 1 to the proxy header. */
export function proxyChunks(type: number, payload: Uint8Array, mtu: number): Uint8Array[] {
  const room = Math.max(1, mtu - 4);
  if (payload.length <= room) return [bytes([(SAR.COMPLETE << 6) | type], payload)];
  const out: Uint8Array[] = [];
  for (let o = 0; o < payload.length; o += room) {
    const sar = o === 0 ? SAR.FIRST : o + room >= payload.length ? SAR.LAST : SAR.CONTINUATION;
    out.push(bytes([(sar << 6) | type], payload.subarray(o, o + room)));
  }
  return out;
}

/** Joins notifications from Proxy Data Out into whole PDUs. */
export class ProxyReassembler {
  private buf: number[] | null = null;
  private type = 0;

  push(chunk: Uint8Array): { type: number; payload: Uint8Array } | null {
    if (!chunk.length) return null;
    const sar = chunk[0] >> 6, type = chunk[0] & 0x3f, body = Array.from(chunk.subarray(1));
    if (sar === SAR.COMPLETE) { this.buf = null; return { type, payload: Uint8Array.from(body) }; }
    if (sar === SAR.FIRST) { this.buf = body; this.type = type; return null; }
    if (!this.buf || type !== this.type) { this.buf = null; return null; }
    this.buf.push(...body);
    if (sar === SAR.CONTINUATION) return null;
    const payload = Uint8Array.from(this.buf);
    this.buf = null;
    return { type, payload };
  }
}

export const FILTER = { ACCEPT_LIST: 0, REJECT_LIST: 1 } as const;
const CFG = { SET_FILTER_TYPE: 0x00, ADD_ADDRESSES: 0x01, FILTER_STATUS: 0x03 } as const;

export interface ProxyConfigOpts {
  seq: number;
  src: number;
  /**
   * The NetMIC length: 8 per the specification (a control message). The one reference client for
   * these lights used 4; if a light ignores the filter, try 4 (#213).
   */
  micLen?: 4 | 8;
}

function configPdu(k: NetCredentials, ivIndex: number, o: ProxyConfigOpts, transport: number[]) {
  return encodeNetworkPdu(k, ivIndex, { ctl: true, ttl: 0, seq: o.seq, src: o.src, dst: 0, transport: Uint8Array.from(transport) }, "proxy", o.micLen ?? 8);
}

/** First message after connecting: an accept list (the Telink proxy ignores a reject list). */
export const setFilterType = (k: NetCredentials, ivIndex: number, o: ProxyConfigOpts, type: number = FILTER.ACCEPT_LIST) =>
  configPdu(k, ivIndex, o, [CFG.SET_FILTER_TYPE, type]);

/** Then the addresses whose traffic the proxy forwards to the phone: its own, at least. */
export const addAddresses = (k: NetCredentials, ivIndex: number, o: ProxyConfigOpts, addresses: number[]) =>
  configPdu(k, ivIndex, o, [CFG.ADD_ADDRESSES, ...addresses.flatMap(u16be)]);

/** A Filter Status from the proxy, or null. */
export function parseFilterStatus(k: NetCredentials, ivIndex: number, pdu: Uint8Array): { type: number; listSize: number } | null {
  const m = decodeNetworkPdu(k, ivIndex, pdu, "proxy");
  if (!m || !m.ctl || m.transport[0] !== CFG.FILTER_STATUS || m.transport.length < 4) return null;
  return { type: m.transport[1], listSize: (m.transport[2] << 8) | m.transport[3] };
}

export interface Beacon { keyRefresh: boolean; ivUpdate: boolean; ivIndex: number }

/**
 * A Secure Network Beacon of this network, authenticated with its beacon key; null for another
 * network or a forged one. The proxy sends one right after the connection: the phone's IV index.
 */
export function parseSecureBeacon(netKey: Uint8Array, payload: Uint8Array): Beacon | null {
  if (payload.length !== 22 || payload[0] !== 0x01) return null;
  const netId = payload.subarray(2, 10);
  if (!k3(netKey).every((v, i) => v === netId[i])) return null;
  const auth = aesCmac(beaconKey(netKey), payload.subarray(1, 14)).subarray(0, 8);
  if (!auth.every((v, i) => v === payload[14 + i])) return null;
  const f = payload[1];
  return { keyRefresh: (f & 1) !== 0, ivUpdate: (f & 2) !== 0, ivIndex: ((payload[10] << 24) | (payload[11] << 16) | (payload[12] << 8) | payload[13]) >>> 0 };
}
