import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { sha256 } from "@noble/hashes/sha2.js";
import { api } from "../api";
import { deviceId } from "../device";
import { scopedKey } from "../kv";
import { log } from "../log";
import { deriveRecoveryKey, open, seal, sealedParams, type RecoveryKey } from "./keySeal";
import { adoptMeshNetwork, getMeshNetworks, heldHere, importSecrets, onSecretsChanged, saveMeshNetwork, secretsJson, seqFor, type MeshNetwork } from "./meshNetworks";

/**
 * Mesh key recovery (#303). With a recovery passphrase set, every change to a network's keys goes to
 * the server sealed (keySeal.ts); a phone without the keys restores them with the passphrase and takes
 * the network over. The phone keeps only the derived key, never the passphrase.
 */

/** A restore starts this far above the old phone's last pushed sequence floor: what it may have used offline since. */
export const RESTORE_MARGIN = 1 << 20;

interface Recovery extends RecoveryKey {
  /** Per network: a hash of the secrets last backed up, so an unchanged network is not uploaded again. */
  done: Record<string, string>;
}

const recoveryKey = () => scopedKey("openclapper.meshRecovery");

function readRecovery(): Recovery | null {
  try {
    const raw = SecureStore.getItem(recoveryKey());
    return raw ? (JSON.parse(raw) as Recovery) : null;
  } catch {
    return null;
  }
}
const writeRecovery = (r: Recovery) => SecureStore.setItem(recoveryKey(), JSON.stringify(r));

export const hasPassphrase = () => readRecovery() !== null;

const digest = (s: string) => Array.from(sha256(new TextEncoder().encode(s)), (b) => b.toString(16).padStart(2, "0")).join("");

/** Seals and uploads one network's keys if they changed since the last backup (or `force`). */
export async function backupNetwork(networkId: string, force = false): Promise<boolean> {
  const r = readRecovery();
  const n = getMeshNetworks().find((x) => x.id === networkId);
  const plain = secretsJson(networkId);
  if (!r || !n || !plain || !heldHere(n)) return false;
  const h = digest(`${r.salt}:${plain}`);
  if (!force && r.done[networkId] === h && n.backupAt) return false;
  const saved = await api.putKeyBackup(networkId, seal(r, networkId, plain, Crypto.getRandomBytes(12)), deviceId());
  adoptMeshNetwork({ ...n, backupAt: saved.backupAt, holder: saved.holder });
  writeRecovery({ ...(readRecovery() ?? r), done: { ...(readRecovery() ?? r).done, [networkId]: h } });
  log("info", "mesh keys backed up", { network: networkId });
  return true;
}

/** Every network this phone holds; on each sync of the lights, and after the passphrase changes. */
export async function backupAll(force = false) {
  for (const n of getMeshNetworks().filter(heldHere)) {
    try { await backupNetwork(n.id, force); } catch (err) { log("warn", "mesh key backup failed; retried on the next sync", { network: n.id, error: err }); }
  }
}

// A paired light or a new network: back it up right away (offline: on the next sync).
onSecretsChanged((id) => { void backupNetwork(id).catch((err) => log("info", "mesh key backup deferred", { network: id, error: err })); });

/** Sets or changes the passphrase (fresh salt), then reseals every network this phone holds. */
export async function setPassphrase(passphrase: string) {
  const k = await deriveRecoveryKey(passphrase, Crypto.getRandomBytes(16));
  writeRecovery({ ...k, done: {} });
  await backupAll(true);
}

export type RestoreResult = "restored" | "wrong-passphrase" | "no-backup";

/**
 * Restores a network's keys on this phone and takes the network over: the old phone is refused from
 * now on, and this one counts on from above everything the old one may have used.
 */
export async function restoreNetwork(n: MeshNetwork, passphrase: string): Promise<RestoreResult> {
  const blob = await api.getKeyBackup(n.id);
  if (!blob) return "no-backup";
  const p = sealedParams(blob);
  const k = await deriveRecoveryKey(passphrase, p.salt, p);
  const plain = open(k, n.id, blob);
  if (plain === null) return "wrong-passphrase";
  const claimed = await api.claimMeshNetwork(n.id, deviceId());
  importSecrets(n.id, plain);
  // The restored passphrase becomes this phone's: later changes are backed up with it.
  writeRecovery({ ...k, done: { [n.id]: digest(`${k.salt}:${plain}`) } });
  await startAbove(claimed);
  log("info", "mesh keys restored", { network: n.id });
  return "restored";
}

/** This phone still has the keys but another phone took the network over: take it back. */
export async function takeBack(n: MeshNetwork) {
  await startAbove(await api.claimMeshNetwork(n.id, deviceId()));
  log("info", "mesh network taken back", { network: n.id });
}

/** Skips this phone's sequence numbers past the last holder's, then records the new holder and floor. */
async function startAbove(claimed: MeshNetwork) {
  const seq = seqFor(claimed.id);
  const start = Math.max(seq.reserved, claimed.seqFloor) + RESTORE_MARGIN;
  seq.skipTo(start);
  const local = getMeshNetworks().find((x) => x.id === claimed.id);
  // The server's counters (next free address, IV index) and the local ones: whichever is further.
  const merged: MeshNetwork = {
    ...claimed,
    nextUnicast: Math.max(claimed.nextUnicast, local?.nextUnicast ?? 0),
    ivIndex: Math.max(claimed.ivIndex, local?.ivIndex ?? 0),
    holder: deviceId(),
    seqFloor: start,
  };
  adoptMeshNetwork(merged);
  await saveMeshNetwork(merged);
}
