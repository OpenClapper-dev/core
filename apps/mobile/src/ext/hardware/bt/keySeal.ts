import { gcm } from "@noble/ciphers/aes.js";
import { scryptAsync } from "@noble/hashes/scrypt.js";

/**
 * Mesh key backups (#303): a network's secrets sealed with a key derived from the owner's recovery
 * passphrase, so the server keeps them without being able to read them. scrypt for the derivation
 * (memory-hard: a stolen backup cannot be brute-forced on GPUs cheaply), AES-GCM for the seal, the
 * network id as associated data so a blob cannot be passed off as another network's.
 */

/** scrypt cost: 2^15 × 8 × 128 B = 32 MB, a few seconds on a phone, done once per restore or passphrase. */
export const KDF = { n: 2 ** 15, r: 8, p: 1 } as const;
export const PASSPHRASE_MIN = 12;

export interface RecoveryKey { salt: string; n: number; r: number; p: number; key: string }

interface Sealed { v: 1; kdf: "scrypt"; salt: string; n: number; r: number; p: number; iv: string; ct: string }

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (s: string) => {
  if (!/^(?:[0-9a-f]{2})*$/.test(s)) throw new Error("not hex");
  return Uint8Array.from(s.match(/../g) ?? [], (x) => Number.parseInt(x, 16));
};
const utf8 = (s: string) => new TextEncoder().encode(s);

/** The key behind a passphrase; `salt` comes from a backup when restoring, fresh otherwise. */
export async function deriveRecoveryKey(passphrase: string, salt: Uint8Array, kdf: { n: number; r: number; p: number } = KDF): Promise<RecoveryKey> {
  const key = await scryptAsync(utf8(passphrase.normalize("NFC")), salt, { N: kdf.n, r: kdf.r, p: kdf.p, dkLen: 32, asyncTick: 20 });
  return { salt: hex(salt), n: kdf.n, r: kdf.r, p: kdf.p, key: hex(key) };
}

/** Seals `plaintext` for network `networkId`; `iv` must be 12 fresh random bytes. */
export function seal(k: RecoveryKey, networkId: string, plaintext: string, iv: Uint8Array): string {
  const ct = gcm(unhex(k.key), iv, utf8(networkId)).encrypt(utf8(plaintext));
  const s: Sealed = { v: 1, kdf: "scrypt", salt: k.salt, n: k.n, r: k.r, p: k.p, iv: hex(iv), ct: hex(ct) };
  return JSON.stringify(s);
}

/** What a restore needs before asking for the passphrase: the blob's KDF parameters. */
export function sealedParams(blob: string): { salt: Uint8Array; n: number; r: number; p: number } {
  const s = JSON.parse(blob) as Partial<Sealed>;
  if (s.v !== 1 || s.kdf !== "scrypt" || typeof s.salt !== "string" || !s.n || !s.r || !s.p) throw new Error("not a key backup this app can read");
  return { salt: unhex(s.salt), n: s.n, r: s.r, p: s.p };
}

/** Opens a blob; null when the passphrase (key) is wrong or the blob belongs to another network. */
export function open(k: RecoveryKey, networkId: string, blob: string): string | null {
  const s = JSON.parse(blob) as Sealed;
  try {
    return new TextDecoder().decode(gcm(unhex(k.key), unhex(s.iv), utf8(networkId)).decrypt(unhex(s.ct)));
  } catch {
    return null;
  }
}
