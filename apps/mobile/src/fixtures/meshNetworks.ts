import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { api } from "../api";
import { scopedKey } from "../kv";
import { log } from "../log";
import { store } from "../storage";
import { hexOf, k2, k4, ofHex } from "./mesh/crypto";
import { SeqAllocator } from "./mesh/seq";
import type { NetworkKeys } from "./mesh/session";

/**
 * The Bluetooth Mesh networks the phone provisions lights into (#212). The record (name, IV index,
 * next free address) is kept on the phone and synced like the fixtures; the keys never leave the
 * phone: they live in the secure store, so a network made on another phone shows here without them.
 */
export interface MeshNetwork {
  id: string;
  name: string;
  ivIndex: number;
  /** The next unicast address to hand out; the phone itself is 0x0001. */
  nextUnicast: number;
  createdAt: string;
  synced: boolean;
}

/** Secrets of one network: keys as hex, the device key of each provisioned light by unicast address. */
/** What a light says about itself in its composition data: maker, product, firmware version, elements. */
export interface NodeInfo { cid: number; pid: number; vid: number; elements: number }

interface Secrets { netKey: string; appKey: string; nodes: Record<string, { devKey: string; configured: boolean; info?: NodeInfo }> }

/** The phone's own address in every network it provisions. */
export const PHONE_UNICAST = 0x0001;
export const NET_KEY_INDEX = 0;
export const APP_KEY_INDEX = 0;

const secretKey = (id: string) => scopedKey(`openclapper.mesh.${id}`);

function readSecrets(id: string): Secrets | null {
  try {
    const raw = SecureStore.getItem(secretKey(id));
    const s = raw ? (JSON.parse(raw) as Secrets) : null;
    return s && typeof s.netKey === "string" && typeof s.appKey === "string" ? { ...s, nodes: s.nodes ?? {} } : null;
  } catch {
    return null;
  }
}

/** Throws when the secure store refuses: losing a key would lock the lights out, so this must not fail quietly. */
function writeSecrets(id: string, s: Secrets) { SecureStore.setItem(secretKey(id), JSON.stringify(s)); }

let networks: MeshNetwork[] = store.loadMeshNetworks();
function commit(next: MeshNetwork[]) { networks = next; store.saveMeshNetworks(networks); }

export const getMeshNetworks = () => networks;
export const hasKeys = (networkId: string) => readSecrets(networkId) !== null;

/** A network's record changed (next address, IV index): save here, then push. */
export async function saveMeshNetwork(n: MeshNetwork) {
  commit(networks.some((x) => x.id === n.id) ? networks.map((x) => (x.id === n.id ? { ...n, synced: false } : x)) : [...networks, { ...n, synced: false }]);
  try {
    await api.putMeshNetwork(n);
    commit(networks.map((x) => (x.id === n.id ? { ...x, synced: true } : x)));
  } catch (err) {
    log("warn", "mesh network sync failed; retried on the next sync", { network: n.id, error: err });
  }
}

/** Push unsynced records, then take the server's list; ours win for networks the phone has keys of. */
export async function syncMeshNetworks() {
  for (const n of networks.filter((x) => !x.synced)) {
    try { await api.putMeshNetwork(n); } catch (err) { log("warn", "mesh network push refused", { network: n.id, error: err }); }
  }
  try {
    const server = await api.listMeshNetworks();
    const mine = networks.filter((x) => !x.synced && !server.some((s) => s.id === x.id));
    commit([...server, ...mine]);
  } catch (err) {
    log("info", "mesh network sync skipped", { error: err });
  }
}

/** The network to provision into: the first one this phone has keys for, or a new one. */
export async function ensureNetwork(): Promise<MeshNetwork> {
  const own = networks.find((n) => hasKeys(n.id));
  if (own) return own;
  const n: MeshNetwork = { id: Crypto.randomUUID(), name: "Lights", ivIndex: 0, nextUnicast: PHONE_UNICAST + 1, createdAt: new Date().toISOString(), synced: false };
  // Keys first: a record without keys is useless, keys without a record can be found again.
  writeSecrets(n.id, { netKey: hexOf(Crypto.getRandomBytes(16)), appKey: hexOf(Crypto.getRandomBytes(16)), nodes: {} });
  log("info", "mesh network created", { network: n.id });
  await saveMeshNetwork(n);
  return n;
}

/** Keep a provisioned light's device key, before anything else happens with it. */
export function rememberNode(networkId: string, unicast: number, devKey: Uint8Array, configured = false, info?: NodeInfo) {
  const s = readSecrets(networkId);
  if (!s) throw new Error("the network's keys are not on this phone");
  writeSecrets(networkId, { ...s, nodes: { ...s.nodes, [String(unicast)]: { devKey: hexOf(devKey), configured, info } } });
}

export function nodeState(networkId: string, unicast: number): { configured: boolean; info: NodeInfo | null } | null {
  const n = readSecrets(networkId)?.nodes[String(unicast)];
  return n ? { configured: n.configured, info: n.info ?? null } : null;
}

export const netKeyOf = (networkId: string) => { const s = readSecrets(networkId); return s ? ofHex(s.netKey) : null; };

/** What a session needs, or null without keys. */
export function networkKeys(n: MeshNetwork): NetworkKeys | null {
  const s = readSecrets(n.id);
  if (!s) return null;
  const netKey = ofHex(s.netKey), appKey = ofHex(s.appKey);
  return {
    netKey, net: k2(netKey), appKey, aid: k4(appKey), ivIndex: n.ivIndex, src: PHONE_UNICAST,
    devKeyOf: (u) => { const d = readSecrets(n.id)?.nodes[String(u)]; return d ? ofHex(d.devKey) : undefined; },
  };
}

export const appKeyOf = (networkId: string) => { const s = readSecrets(networkId); return s ? ofHex(s.appKey) : null; };

const allocators = new Map<string, SeqAllocator>();

/**
 * The network's sequence numbers, saved in the kv store before each block is used. One allocator
 * per network for the app's lifetime: two would each reserve a block and could hand out the same
 * number, which every light drops as a replay.
 */
export function seqFor(networkId: string): SeqAllocator {
  let a = allocators.get(networkId);
  if (!a) { a = new SeqAllocator({ load: () => store.loadMeshSeq(networkId), save: (v) => store.saveMeshSeq(networkId, v) }); allocators.set(networkId, a); }
  return a;
}
