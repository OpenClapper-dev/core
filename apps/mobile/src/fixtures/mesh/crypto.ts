import { cmac, ecb } from "@noble/ciphers/aes.js";

/**
 * Bluetooth Mesh security toolbox (Mesh Profile 1.0.1 §3.8.2), for the Aputure lights (#211).
 * AES-CMAC comes from @noble/ciphers; AES-CCM is built here on AES-ECB (RFC 3610 with a 13-byte
 * nonce), because noble has no CCM. Checked against the specification's sample data (§8).
 */

export const bytes = (...parts: (Uint8Array | number[])[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
export const utf8 = (s: string) => Uint8Array.from(Array.from(s, (c) => c.charCodeAt(0)));
export const hexOf = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
export const ofHex = (s: string) => Uint8Array.from(s.match(/../g) ?? [], (h) => parseInt(h, 16));
export const u16be = (v: number) => [(v >> 8) & 0xff, v & 0xff];
export const u24be = (v: number) => [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
export const u32be = (v: number) => [(v >>> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];

/** One AES-128 block. */
export const aes = (key: Uint8Array, block: Uint8Array): Uint8Array => ecb(key, { disablePadding: true }).encrypt(block);

export const aesCmac = (key: Uint8Array, msg: Uint8Array): Uint8Array => cmac(msg, key);

/** s1: the salt generation function. */
export const s1 = (m: Uint8Array | string) => aesCmac(new Uint8Array(16), typeof m === "string" ? utf8(m) : m);

/** k1: derives a key from N, a salt and P (beacon and identity keys). */
export const k1 = (n: Uint8Array, salt: Uint8Array, p: Uint8Array) => aesCmac(aesCmac(salt, n), p);

/** k2: the NetKey's NID, encryption key and privacy key (P = 0x00 for flooding). */
export function k2(n: Uint8Array, p: Uint8Array = Uint8Array.of(0)): { nid: number; encKey: Uint8Array; privKey: Uint8Array } {
  const t = aesCmac(s1("smk2"), n);
  const t1 = aesCmac(t, bytes(p, [1]));
  const t2 = aesCmac(t, bytes(t1, p, [2]));
  const t3 = aesCmac(t, bytes(t2, p, [3]));
  return { nid: t1[15] & 0x7f, encKey: t2, privKey: t3 };
}

/** k3: the 64-bit Network ID. */
export const k3 = (n: Uint8Array) => aesCmac(aesCmac(s1("smk3"), n), bytes(utf8("id64"), [1])).subarray(8);

/** k4: the AppKey's 6-bit AID. */
export const k4 = (n: Uint8Array) => aesCmac(aesCmac(s1("smk4"), n), bytes(utf8("id6"), [1]))[15] & 0x3f;

/** The key that authenticates Secure Network Beacons. */
export const beaconKey = (netKey: Uint8Array) => k1(netKey, s1("nkbk"), bytes(utf8("id128"), [1]));

const ctrBlock = (nonce: Uint8Array, i: number) => bytes([0x01], nonce, u16be(i));

function cbcMac(key: Uint8Array, nonce: Uint8Array, msg: Uint8Array, micLen: number): Uint8Array {
  // B0: flags (no additional data, M, L = 2), the nonce, the message length.
  let x = aes(key, bytes([(((micLen - 2) / 2) << 3) | 0x01], nonce, u16be(msg.length)));
  for (let o = 0; o < msg.length; o += 16) {
    const block = new Uint8Array(16);
    block.set(msg.subarray(o, o + 16));
    for (let i = 0; i < 16; i++) block[i] ^= x[i];
    x = aes(key, block);
  }
  return x.subarray(0, micLen);
}

function ctrXor(key: Uint8Array, nonce: Uint8Array, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length);
  for (let o = 0; o < data.length; o += 16) {
    const s = aes(key, ctrBlock(nonce, o / 16 + 1));
    for (let i = 0; i < 16 && o + i < data.length; i++) out[o + i] = data[o + i] ^ s[i];
  }
  return out;
}

/** AES-CCM with a 13-byte nonce: ciphertext followed by a 4- or 8-byte MIC. */
export function ccmEncrypt(key: Uint8Array, nonce: Uint8Array, plain: Uint8Array, micLen: 4 | 8): Uint8Array {
  const t = cbcMac(key, nonce, plain, micLen);
  const s0 = aes(key, ctrBlock(nonce, 0));
  return bytes(ctrXor(key, nonce, plain), t.map((v, i) => v ^ s0[i]));
}

/** The plaintext, or null when the MIC does not match (wrong key, or not for us). */
export function ccmDecrypt(key: Uint8Array, nonce: Uint8Array, sealed: Uint8Array, micLen: 4 | 8): Uint8Array | null {
  if (sealed.length < micLen) return null;
  const plain = ctrXor(key, nonce, sealed.subarray(0, sealed.length - micLen));
  const t = cbcMac(key, nonce, plain, micLen);
  const s0 = aes(key, ctrBlock(nonce, 0));
  const mic = sealed.subarray(sealed.length - micLen);
  let diff = 0;
  for (let i = 0; i < micLen; i++) diff |= (t[i] ^ s0[i]) ^ mic[i];
  return diff === 0 ? plain : null;
}
