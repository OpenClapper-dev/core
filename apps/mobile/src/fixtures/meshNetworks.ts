import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { api, ApiError } from "../api";
import { deviceId } from "../device";
import { scopedKey } from "../kv";
import { log } from "../log";
import { store } from "../storage";
import { hexOf, k2, k4, ofHex } from "./mesh/crypto";
import { SeqAllocator } from "./mesh/seq";
import type { NetworkKeys } from "./mesh/session";

/**
 * The Bluetooth Mesh networks the phone provisions lights into (#212). The record (name, IV index,
 * next free address, holder) is kept on the phone and synced like the fixtures; the keys live in the
 * secure store and leave the phone only sealed with the recovery passphrase (#303, keyBackup.ts).
 * One phone at a time controls a network (its `holder`): both would send from the same address.
 */
export interface MeshNetwork {
  id: string;
  name: string;
  ivIndex: number;
  /** The next unicast address to hand out; the phone itself is 0x0001. */
  nextUnicast: number;
  /** The device id of the phone that controls the network; null before #303 or before its first sync. */
  holder: string | null;
  /** How far the holder has counted its sequence numbers, as last pushed; a restore starts above it. */
  seqFloor: number;
  /** When the sealed keys were last stored on the server; null without a backup. */
  backupAt: string | null;
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

let secretsChanged: ((networkId: string) => void) | null = null;
/** keyBackup.ts listens, to back up every change (a new network, a paired light). */
export function onSecretsChanged(fn: (networkId: string) => void) { secretsChanged = fn; }

/** Throws when the secure store refuses: losing a key would lock the lights out, so this must not fail quietly. */
function writeSecrets(id: string, s: Secrets) {
  SecureStore.setItem(secretKey(id), JSON.stringify(s));
  secretsChanged?.(id);
}

/** A network's secrets as stored, for sealing them (keyBackup.ts). */
export const secretsJson = (id: string): string | null => { const s = readSecrets(id); return s ? JSON.stringify(s) : null; };

/** Stores restored secrets; throws when they are not a network's keys. */
export function importSecrets(id: string, json: string) {
  const s = JSON.parse(json) as Secrets;
  if (typeof s.netKey !== "string" || typeof s.appKey !== "string" || typeof s.nodes !== "object") throw new Error("the backup does not hold a network's keys");
  writeSecrets(id, { netKey: s.netKey, appKey: s.appKey, nodes: s.nodes ?? {} });
}

// Records saved before #303 lack the holder fields.
let networks: MeshNetwork[] = store.loadMeshNetworks().map((n) => ({ ...n, holder: n.holder ?? null, seqFloor: n.seqFloor ?? 0, backupAt: n.backupAt ?? null }));
function commit(next: MeshNetwork[]) { networks = next; store.saveMeshNetworks(networks); }

export const getMeshNetworks = () => networks;
export const hasKeys = (networkId: string) => readSecrets(networkId) !== null;

/** Another phone took the network over (a restore there): this one keeps its keys but must not send. */
export const heldElsewhere = (n: MeshNetwork) => n.holder != null && n.holder !== deviceId();
/** This phone has the keys and may use them. */
export const heldHere = (n: MeshNetwork) => hasKeys(n.id) && !heldElsewhere(n);

/** Replaces the local record without pushing (the server's answer to a claim). */
export function adoptMeshNetwork(n: MeshNetwork) {
  commit(networks.some((x) => x.id === n.id) ? networks.map((x) => (x.id === n.id ? n : x)) : [...networks, n]);
}

/** A network's record changed (next address, IV index): save here, then push. */
export async function saveMeshNetwork(n: MeshNetwork) {
  commit(networks.some((x) => x.id === n.id) ? networks.map((x) => (x.id === n.id ? { ...n, synced: false } : x)) : [...networks, { ...n, synced: false }]);
  try {
    await api.putMeshNetwork(n, holderFor(n));
    commit(networks.map((x) => (x.id === n.id ? { ...x, synced: true } : x)));
  } catch (err) {
    if (await lostTo409(n, err)) return;
    log("warn", "mesh network sync failed; retried on the next sync", { network: n.id, error: err });
  }
}

/** The holder a write names: this phone when it has the keys (a phone without them only renames). */
const holderFor = (n: MeshNetwork) => (hasKeys(n.id) ? deviceId() : null);

/** 409: another phone holds the network now. Take the server's record, which says so, and stop pushing. */
async function lostTo409(n: MeshNetwork, err: unknown): Promise<boolean> {
  if (!(err instanceof ApiError) || err.status !== 409) return false;
  log("warn", "mesh network is in use on another phone", { network: n.id });
  try {
    const server = (await api.listMeshNetworks()).find((x) => x.id === n.id);
    if (server) adoptMeshNetwork(server);
  } catch { /* the next sync brings it */ }
  return true;
}

/** Push unsynced records, then take the server's list; ours win for networks the phone has keys of. */
export async function syncMeshNetworks() {
  for (const n of networks.filter((x) => !x.synced)) {
    try { await api.putMeshNetwork(n, holderFor(n)); } catch (err) { if (!(await lostTo409(n, err))) log("warn", "mesh network push refused", { network: n.id, error: err }); }
  }
  try {
    const server = await api.listMeshNetworks();
    const mine = networks.filter((x) => !x.synced && !server.some((s) => s.id === x.id));
    commit([...server, ...mine]);
  } catch (err) {
    log("info", "mesh network sync skipped", { error: err });
  }
}

/** The network to provision into: the first one this phone holds, or a new one. */
export async function ensureNetwork(): Promise<MeshNetwork> {
  const own = networks.find(heldHere);
  if (own) return own;
  const n: MeshNetwork = {
    id: Crypto.randomUUID(), name: "Lights", ivIndex: 0, nextUnicast: PHONE_UNICAST + 1,
    holder: deviceId(), seqFloor: 0, backupAt: null, createdAt: new Date().toISOString(), synced: false,
  };
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

/** What a session needs, or null without keys or while another phone holds the network. */
export function networkKeys(n: MeshNetwork): NetworkKeys | null {
  if (heldElsewhere(n)) return null;
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
  if (!a) {
    a = new SeqAllocator({ load: () => store.loadMeshSeq(networkId), save: (v) => { store.saveMeshSeq(networkId, v); raiseFloor(networkId, v.reserved); } });
    allocators.set(networkId, a);
  }
  return a;
}

/**
 * Tells the server how far this phone has counted, every FLOOR_STEP numbers (#303). A phone that
 * restores the keys starts RESTORE_MARGIN above it, which covers what was used offline since.
 */
const FLOOR_STEP = 4096;
function raiseFloor(networkId: string, reserved: number) {
  const n = networks.find((x) => x.id === networkId);
  if (!n || heldElsewhere(n) || reserved < n.seqFloor + FLOOR_STEP) return;
  void saveMeshNetwork({ ...n, seqFloor: reserved });
}
