import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { randomUUID } from "expo-crypto";
import { readExif, readoutOf, takenAt, uprightSize, type Exif } from "@openclapper/model";
import { device } from "../device";
import type { Lens } from "../lenses";
import { log } from "../log";
import { enqueue, queueFile } from "./queue";

/**
 * How a picture becomes a queued photo, the same for a capture and an import (docs/rewrite/03-capture.md,
 * "Import on the phone"): the original is kept untouched, the preview (about 2048 px) and thumbnail
 * (about 400 px) are made here, the EXIF is read (the server computes the angle of view from it).
 */
const PREVIEW = 2048, THUMB = 400;


/** Makes an upright JPEG of at most `edge` px on its long side (the manipulator applies the EXIF orientation). */
async function derive(uri: string, upright: { width: number; height: number }, edge: number, quality: number) {
  const fit = upright.width >= upright.height ? { width: Math.min(edge, upright.width) } : { height: Math.min(edge, upright.height) };
  const ref = await ImageManipulator.manipulate(uri).resize(fit).renderAsync();
  try { return await ref.saveAsync({ compress: quality, format: SaveFormat.JPEG }); } finally { ref.release(); }
}

/** Preview and thumbnail next to the original in the queue folder; the upright size, corrected by what the preview came out as. */
async function derivatives(id: string, original: File, guess: { width: number; height: number }) {
  const preview = await derive(original.uri, guess, PREVIEW, 0.86);
  // Should the orientation have been read wrong, the decoded picture knows better.
  const upright = (preview.width >= preview.height) === (guess.width >= guess.height) ? guess : { width: guess.height, height: guess.width };
  const thumb = await derive(preview.uri, { width: preview.width, height: preview.height }, THUMB, 0.8);
  const p = queueFile(`${id}-preview.jpg`), t = queueFile(`${id}-thumbnail.jpg`);
  new File(preview.uri).move(p);
  new File(thumb.uri).move(t);
  return { upright, preview: p.name, thumbnail: t.name };
}

/** The size of a picture from its EXIF, else by decoding it. */
async function sizeOf(uri: string, exif: Exif): Promise<{ width: number; height: number }> {
  const w = exif.PixelXDimension, h = exif.PixelYDimension;
  if (typeof w === "number" && typeof h === "number" && w > 0 && h > 0) return uprightSize(w, h, exif.Orientation);
  const ref = await ImageManipulator.manipulate(uri).renderAsync();
  try { return { width: ref.width, height: ref.height }; } finally { ref.release(); }
}

/**
 * The lens's 35 mm equivalent (Camera2, camera-optics) against what the photo's EXIF says (#426): a difference over
 * 10 % goes to the debug log, so a phone whose optics read wrong shows up there. Nothing is changed by it.
 */
function checkEquivalent(lens: Lens | null, exif: Exif) {
  const tag = Number(exif.FocalLengthIn35mmFilm);
  if (!lens || !Number.isFinite(tag) || tag <= 0) return;
  if (!lens.focal35) { log("warn", "lens has no equivalent, the photo says", { lens: lens.name, exif35: tag }); return; }
  const off = Math.abs(tag - lens.focal35) / lens.focal35;
  if (off > 0.1) log("warn", "lens equivalent differs from the photo's EXIF", { lens: lens.name, focal35: lens.focal35, exif35: tag, off: Math.round(off * 100) / 100 });
}

/** A photo just taken: the camera's JPEG, its size as delivered, the lens it was taken with. */
/** `more`: the folder or collection it goes into (collection mode, the folder for new photos) and the frame on the screen as a fact. */
export async function addCapture(projectId: string, jpeg: Uint8Array, size: { width: number; height: number }, lens: Lens | null, more: { container?: string | null; frame?: Record<string, unknown> | null } = {}): Promise<string> {
  const id = randomUUID();
  const original = queueFile(`${id}-original.jpg`);
  original.write(jpeg);
  const exif = readExif(jpeg);
  checkEquivalent(lens, exif);
  const d = await derivatives(id, original, uprightSize(size.width, size.height, exif.Orientation));
  const readout = readoutOf(exif);
  enqueue({
    id, original: original.name, preview: d.preview, thumbnail: d.thumbnail, step: "meta", rejections: 0, stuck: false, error: null, added: new Date().toISOString(),
    meta: {
      project_id: projectId, origin: "capture", media_type: "image/jpeg", taken_at: new Date().toISOString(), width: d.upright.width, height: d.upright.height,
      // No name: the server gives one from the project's naming pattern when the photo arrives.
      container: more.container ?? null, exif,
      ...(more.frame ? { frame: more.frame } : {}),
      readout: { ...readout, ...(lens ? { lens: `${lens.name}${lens.focal35 ? ` · ${lens.focal35} mm` : ""}` } : {}) },
      device_id: device.get().file?.id ?? null,
    },
  });
  return id;
}

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heic" };
const TYPE_OF: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", heif: "image/heic" };

/** Pictures from the phone's gallery or files: the same pipeline, with their own time and no device. */
export async function addImports(projectId: string, picked: { uri: string; name: string; mimeType?: string | null; lastModified?: number | null }[], container: string | null = null): Promise<{ added: number; failed: string[] }> {
  let added = 0;
  const failed: string[] = [];
  for (const a of picked) {
    try {
      const ext = (a.name.split(".").pop() ?? "").toLowerCase();
      const type = (a.mimeType && EXT[a.mimeType] ? (a.mimeType === "image/heif" ? "image/heic" : a.mimeType) : TYPE_OF[ext]) ?? null;
      if (!type) { failed.push(a.name); continue; }
      const id = randomUUID();
      const original = queueFile(`${id}-original.${EXT[type]}`);
      new File(a.uri).copy(original);
      const exif = type === "image/jpeg" ? readExif(new Uint8Array(await original.arrayBuffer())) : {};
      const d = await derivatives(id, original, await sizeOf(original.uri, exif));
      enqueue({
        id, original: original.name, preview: d.preview, thumbnail: d.thumbnail, step: "meta", rejections: 0, stuck: false, error: null, added: new Date().toISOString(),
        meta: {
          project_id: projectId, origin: "import", media_type: type, width: d.upright.width, height: d.upright.height,
          taken_at: takenAt(exif) ?? (a.lastModified ? new Date(a.lastModified).toISOString() : new Date().toISOString()),
          ...(a.name.replace(/\.[^.]+$/, "").trim() ? { name: a.name.replace(/\.[^.]+$/, "").trim().slice(0, 120) } : {}), container, exif, readout: readoutOf(exif), device_id: null,
        },
      });
      added++;
    } catch (e) { log("warn", "import failed", { name: a.name, error: e }); failed.push(a.name); }
  }
  return { added, failed };
}
