/**
 * What image uploads and image delivery share: a body size check before anything is read, the stored
 * type taken from the file's own bytes, and conditional GETs answered like HTTP says.
 */
import { HttpError } from "@openclapper/service-kit";

export type ImageType = "image/jpeg" | "image/png" | "image/webp" | "image/heic";

/**
 * Refuses a body whose declared length is above `max` before `formData()` reads it into memory.
 * A request without content-length (chunked) is read; the per-file checks still hold then.
 */
export function assertBodySize(request: Request, max: number): void {
  const raw = request.headers.get("content-length");
  if (raw === null) return;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new HttpError(400, "bad content-length");
  if (n > max) throw new HttpError(413, `request too large (at most ${Math.floor(max / (1024 * 1024))} MB)`);
}

/** JPEG, PNG, WebP or HEIC by its magic bytes, else null. The type a client declares is never trusted. */
export function sniffImageType(head: Uint8Array): ImageType | null {
  const at = (i: number, ...bytes: number[]) => bytes.every((b, k) => head[i + k] === b);
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp"; // RIFF....WEBP
  // An ISO media file whose brand is one of HEIF's still-image ones: ....ftypheic
  if (at(4, 0x66, 0x74, 0x79, 0x70)) { const brand = String.fromCharCode(...head.slice(8, 12)); if (["heic", "heix", "mif1", "msf1", "hevc", "heim", "heis"].includes(brand)) return "image/heic"; }
  return null;
}

/**
 * The pixel size of a JPEG, PNG or WebP from its header, or null when it cannot be read. Enough to refuse a picture
 * over a size limit without decoding it.
 */
export function imageSize(b: Uint8Array): { width: number; height: number } | null {
  const u16 = (i: number) => (b[i] << 8) | b[i + 1], le16 = (i: number) => b[i] | (b[i + 1] << 8), le24 = (i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
  const u32 = (i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  const type = sniffImageType(b.subarray(0, 16));
  if (type === "image/png" && b.length >= 24) return { width: u32(16), height: u32(20) };
  if (type === "image/jpeg") {
    for (let i = 2; i + 9 < b.length;) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { width: u16(i + 7), height: u16(i + 5) };
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      i += 2 + u16(i + 2);
    }
    return null;
  }
  if (type === "image/webp" && b.length >= 30) {
    const chunk = String.fromCharCode(...b.subarray(12, 16));
    if (chunk === "VP8X") return { width: le24(24) + 1, height: le24(27) + 1 };
    if (chunk === "VP8 ") return { width: le16(26) & 0x3fff, height: le16(28) & 0x3fff };
    if (chunk === "VP8L") { const v = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24); return { width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1 }; }
  }
  return null;
}

export const imageExt = (type: string) => (type === "image/png" ? "png" : type === "image/webp" ? "webp" : type === "image/heic" ? "heic" : "jpg");

/**
 * R2 answers a failed precondition with the object but no body, for If-None-Match (304) and If-Match
 * (412) alike. True when it was If-Match (or If-Unmodified-Since without it) that failed (RFC 9110 13.2.2).
 */
export function preconditionFailed(request: Request, obj: R2Object): boolean {
  const ifMatch = request.headers.get("If-Match");
  if (ifMatch !== null) {
    if (ifMatch.trim() === "*") return false;
    return !ifMatch.split(",").map((t) => t.trim()).includes(obj.httpEtag);
  }
  const since = request.headers.get("If-Unmodified-Since");
  if (since !== null && !Number.isNaN(Date.parse(since))) return Math.floor(obj.uploaded.getTime() / 1000) > Math.floor(Date.parse(since) / 1000);
  return false;
}
