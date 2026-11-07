import type { Link } from "../types.ts";
import { hexOf } from "./crypto.ts";
import { encodeAccessMessage, Inbox, type Keys, type Outgoing, type Received } from "./message.ts";
import type { NetCredentials } from "./network.ts";
import { addAddresses, parseFilterStatus, parseSecureBeacon, PDU, PROXY_DATA_IN, PROXY_DATA_OUT, PROXY_SERVICE, proxyChunks, ProxyReassembler, setFilterType } from "./proxy.ts";
import type { SeqAllocator } from "./seq.ts";

/** Everything the phone holds about one mesh network, for a session. */
export interface NetworkKeys {
  netKey: Uint8Array;
  net: NetCredentials;
  appKey: Uint8Array;
  aid: number;
  ivIndex: number;
  /** The phone's own address in the network. */
  src: number;
  devKeyOf(unicast: number): Uint8Array | undefined;
}

export interface SessionOptions {
  log?: (level: "debug" | "info" | "warn", event: string, data?: unknown) => void;
  /** How long to wait for the proxy's beacon and filter status after connecting. */
  setupWaitMs?: number;
  /** NetMIC of the proxy filter messages (see proxy.ts). */
  filterMicLen?: 4 | 8;
  /** The IV index changed (from the proxy's beacon): store it with the network. */
  onIvIndex?: (iv: number) => void;
}

export class MeshTimeout extends Error {}

/**
 * One connection to a mesh network through a proxy node (#212, #213): any light of the network
 * relays for all of them. On start it reads the IV index from the proxy's beacon and sets the
 * proxy filter so replies reach the phone; then access messages go out and come back.
 */
export class MeshSession {
  private readonly link: Link;
  private readonly keys: Keys;
  private readonly net: NetworkKeys;
  private readonly seq: SeqAllocator;
  private readonly o: SessionOptions;
  private readonly inbox: Inbox;
  private readonly proxy = new ProxyReassembler();
  private readonly waiters = new Set<{ match: (r: Received) => boolean; done: (r: Received) => void }>();
  private readonly listeners = new Set<(r: Received) => void>();
  private beaconSeen: (() => void) | null = null;
  private filterSeen: (() => void) | null = null;
  private stopNotify: (() => void) | null = null;

  constructor(link: Link, net: NetworkKeys, seq: SeqAllocator, o: SessionOptions = {}) {
    this.link = link;
    this.net = net;
    this.seq = seq;
    this.o = o;
    this.keys = { net: net.net, ivIndex: net.ivIndex, src: net.src };
    this.inbox = new Inbox(this.keys, [{ key: net.appKey, aid: net.aid }], (u) => net.devKeyOf(u), seq);
  }

  get ivIndex() { return this.keys.ivIndex; }

  async start(): Promise<void> {
    const wait = this.o.setupWaitMs ?? 2500;
    const beacon = this.until(wait, (r) => { this.beaconSeen = r; });
    this.stopNotify = await this.link.notify(PROXY_SERVICE, PROXY_DATA_OUT, (b) => this.onChunk(b));
    if (!(await beacon)) this.o.log?.("warn", "mesh: no beacon from the proxy; using the stored IV index", { iv: this.keys.ivIndex });
    // Accept list, then the phone's own address: without it the proxy forwards no reply.
    const micLen = this.o.filterMicLen ?? 8;
    let status = this.until(wait, (r) => { this.filterSeen = r; });
    await this.writeProxy(PDU.CONFIG, setFilterType(this.keys.net, this.keys.ivIndex, { seq: this.seq.take(), src: this.keys.src, micLen }));
    if (!(await status)) this.o.log?.("warn", "mesh: the proxy did not confirm the filter type", { micLen });
    status = this.until(wait, (r) => { this.filterSeen = r; });
    await this.writeProxy(PDU.CONFIG, addAddresses(this.keys.net, this.keys.ivIndex, { seq: this.seq.take(), src: this.keys.src, micLen }, [this.keys.src]));
    if (!(await status)) this.o.log?.("warn", "mesh: the proxy did not confirm the address", { micLen });
  }

  /** Send without waiting for an answer. */
  async send(m: Outgoing): Promise<void> {
    for (const pdu of encodeAccessMessage(this.keys, this.seq, m)) await this.writeProxy(PDU.NETWORK, pdu);
  }

  /** Send and wait for the matching answer; repeats (with fresh sequence numbers) on silence. */
  async request(m: Outgoing, match: (r: Received) => boolean, timeoutMs = 3000, tries = 3): Promise<Received> {
    for (let i = 0; i < tries; i++) {
      const got = new Promise<Received | null>((resolve) => {
        const w = { match, done: (r: Received) => { this.waiters.delete(w); resolve(r); } };
        this.waiters.add(w);
        setTimeout(() => { if (this.waiters.delete(w)) resolve(null); }, timeoutMs);
      });
      await this.send(m);
      const r = await got;
      if (r) return r;
      this.o.log?.("debug", "mesh: no answer, repeating", { dst: m.dst, try: i + 1 });
    }
    throw new MeshTimeout(`no answer from 0x${m.dst.toString(16).padStart(4, "0")}`);
  }

  /** Messages nobody waits for (status reports of the lights, #213). */
  onMessage(cb: (r: Received) => void): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  async close() { this.stopNotify?.(); this.stopNotify = null; }

  private until(ms: number, set: (resolve: () => void) => void): Promise<boolean> {
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(false), ms);
      set(() => { clearTimeout(t); resolve(true); });
    });
  }

  private async writeProxy(type: number, payload: Uint8Array) {
    for (const chunk of proxyChunks(type, payload, this.link.mtu)) await this.link.write(PROXY_SERVICE, PROXY_DATA_IN, chunk, false);
  }

  private onChunk(b: Uint8Array) {
    const p = this.proxy.push(b);
    if (!p) return;
    if (p.type === PDU.BEACON) {
      const beacon = parseSecureBeacon(this.net.netKey, p.payload);
      if (!beacon) return;
      if (beacon.ivIndex !== this.keys.ivIndex) {
        this.o.log?.("info", "mesh: IV index from the beacon", { from: this.keys.ivIndex, to: beacon.ivIndex });
        this.keys.ivIndex = beacon.ivIndex;
        this.o.onIvIndex?.(beacon.ivIndex);
      }
      this.beaconSeen?.(); this.beaconSeen = null;
    } else if (p.type === PDU.CONFIG) {
      const st = parseFilterStatus(this.keys.net, this.keys.ivIndex, p.payload);
      if (st) { this.o.log?.("debug", "mesh: filter status", st); this.filterSeen?.(); this.filterSeen = null; }
    } else if (p.type === PDU.NETWORK) {
      const r = this.inbox.push(p.payload);
      if (!r) return;
      if (r.ack) for (const a of r.ack) void this.writeProxy(PDU.NETWORK, a);
      this.o.log?.("debug", "mesh: message", { src: r.src, opcode: r.access.opcode.toString(16), params: hexOf(r.access.params) });
      const w = [...this.waiters].find((x) => x.match(r));
      if (w) w.done(r); else for (const cb of this.listeners) cb(r);
    }
  }
}
