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
