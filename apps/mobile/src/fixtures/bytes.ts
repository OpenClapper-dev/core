/** Byte helpers for the drivers: hex for the debug log, base64 for the Bluetooth library. */

export const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(" ");

export function fromHex(s: string): Uint8Array {
  const clean = s.replace(/[^0-9a-f]/gi, "");
  if (clean.length % 2) throw new Error(`odd hex length: ${s}`);
  return Uint8Array.from(clean.match(/../g) ?? [], (h) => parseInt(h, 16));
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Hand-written: Hermes's atob/btoa work on strings, and this keeps the codecs testable in Node. */
export function toBase64(b: Uint8Array): string {
  let out = "";
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < b.length ? B64[(n >> 6) & 63] : "=") + (i + 2 < b.length ? B64[n & 63] : "=");
  }
  return out;
}

export function fromBase64(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, "");
  const out: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const c = [0, 1, 2, 3].map((k) => B64.indexOf(clean[i + k] ?? "A"));
    const n = (c[0] << 18) | (c[1] << 12) | (c[2] << 6) | c[3];
    out.push((n >> 16) & 255);
    if (i + 2 < clean.length) out.push((n >> 8) & 255);
    if (i + 3 < clean.length) out.push(n & 255);
  }
  return Uint8Array.from(out);
}
