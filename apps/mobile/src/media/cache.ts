import { File } from "expo-file-system";
import { authHeaders, imageUrl, type ImageSize } from "../api";
import { dataDir } from "../kv";
import { log } from "../log";

/**
 * Thumbnails and previews kept on the phone, by photo id: those of photos sent from here (moved over
 * from the queue), and those of the project kept on the device for Media without a connection
 * (Setup, Offline). An image not in here is loaded from the server (and cached by the image view).
 */
type Small = Exclude<ImageSize, "original">;
const dir = () => { const d = dataDir("images"); if (!d.exists) d.create({ intermediates: true }); return d; };
const fileOf = (id: string, size: Small) => new File(dir(), `${id}-${size}.jpg`);

/** Moves a file into the cache (the queue's thumbnail and preview, once uploaded). */
export function cacheImage(id: string, size: Small, from: File) {
  try { const to = fileOf(id, size); if (to.exists) to.delete(); if (from.exists) from.move(to); } catch (e) { log("warn", "cache move failed", { id, size, error: e }); }
}

/** Where an image is shown from: the phone's copy, else the server. */
export function imageSource(id: string, size: Small): { uri: string; headers?: Record<string, string> } {
  const f = fileOf(id, size);
  return f.exists ? { uri: f.uri } : { uri: imageUrl(id, size), headers: authHeaders() };
}

export const isCached = (id: string, size: Small) => fileOf(id, size).exists;

/** Downloads an image into the cache unless it is there. */
export async function fetchImage(id: string, size: Small): Promise<void> {
  const f = fileOf(id, size);
  if (f.exists) return;
  await File.downloadFileAsync(imageUrl(id, size), f, { headers: authHeaders(), idempotent: true });
}

/** Bytes of the images kept on the phone. */
export function cacheBytes(): number {
  let bytes = 0;
  try { for (const f of dir().list()) if (f instanceof File) bytes += f.size ?? 0; } catch { /* no folder yet */ }
  return bytes;
}
