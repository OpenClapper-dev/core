import { File } from "expo-file-system";
import { dataDir } from "./kv";
import * as Crypto from "expo-crypto";
import { log } from "./log";
import { store } from "./storage";
import type { CaptureDraft, DraftPhoto } from "./types";

/**
 * Sequence mode: every photo taken while it is on belongs to one shot. Photos are copied out of
 * the camera's temp files right away and the draft is persisted, so nothing is lost if the app
 * is killed mid-sequence; the badge picks up where it left off on the next launch.
 */
const dir = dataDir("draft-photos");

export function startSequence(): CaptureDraft {
  const d: CaptureDraft = { shotId: Crypto.randomUUID(), photos: [] };
  store.saveSequence(d);
  log("info", "sequence start", { shot: d.shotId });
  return d;
}

/** Moves a captured photo out of the camera's temp cache into app storage (drafts survive restarts). */
export function keepPhoto(photo: DraftPhoto): DraftPhoto {
  if (!dir.exists) dir.create({ intermediates: true });
  const dest = new File(dir, `${photo.meta.id}.jpg`);
  new File(photo.uri).copySync(dest, { overwrite: true });
  try { new File(photo.uri).delete(); } catch { /* temp file */ }
  return { ...photo, uri: dest.uri };
}

/** Adds a photo (moving its temp file into draft storage) and returns the updated draft. */
export function addToSequence(d: CaptureDraft, photo: DraftPhoto): CaptureDraft {
  const kept = keepPhoto(photo);
  const next: CaptureDraft = { ...d, photos: [...d.photos, { ...kept, meta: { ...kept.meta, ordinal: d.photos.length } }] };
  store.saveSequence(next);
  log("info", "sequence photo", { shot: d.shotId, n: next.photos.length });
  return next;
}

/** Deletes a draft's local files (after they were queued, or on discard). */
/** A stored draft, minus photos whose files are gone; null when none are left. */
export function restoreDraft(d: CaptureDraft | null): CaptureDraft | null {
  if (!d) return null;
  const photos = d.photos.filter((p) => { try { return new File(p.uri).exists; } catch { return false; } });
  return photos.length ? { ...d, photos: photos.map((p, i) => ({ ...p, meta: { ...p.meta, ordinal: i } })) } : null;
}

export function deleteDraftFiles(d: CaptureDraft) {
  for (const p of d.photos) { try { const f = new File(p.uri); if (f.exists) f.delete(); } catch { /* best effort */ } }
}
