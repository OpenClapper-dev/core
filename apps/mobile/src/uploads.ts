import { Directory, File, Paths } from "expo-file-system";
import { api, ApiError, type Shot } from "./api";
import { flushEdits, remapEdits } from "./localShots";
import { log } from "./log";
import { isOfflineMode } from "./net";
import { syncLocations, syncProjects, syncSpots } from "./namedSync";
import { store } from "./storage";
import type { PendingUpload, ShotMetadata } from "./types";

const dir = new Directory(Paths.document, "pending-photos");
/** Photos per request; the server caps one upload at 60. */
const UPLOAD_CHUNK = 12;
/** Rejections (4xx) after which a shot stops being retried automatically; it is kept, never deleted. */
const MAX_REJECTIONS = 3;

function ensureDir() {
  if (!dir.exists) dir.create({ intermediates: true });
}

const deleteFiles = (uris: string[]) => {
  for (const uri of uris) { try { const f = new File(uri); if (f.exists) f.delete(); } catch { /* best effort */ } }
};

/**
 * Copy the temp captures (photo id -> temp file URI) into app storage and enqueue the shot.
 * Throws if a photo cannot be stored (nothing is queued then, and partial copies are removed).
 */
export function enqueue(metadata: ShotMetadata, tempUris: Record<string, string>): PendingUpload {
  ensureDir();
  const files: Record<string, string> = {};
  try {
    for (const p of metadata.photos) {
      const dest = new File(dir, `${p.id}.jpg`);
      // copy() is async in this SDK; the caller deletes the temp file right after, so the copy must be complete here.
      new File(tempUris[p.id]).copySync(dest, { overwrite: true });
      if (!dest.exists) throw new Error("could not store the photo for upload");
      files[p.id] = dest.uri;
    }
  } catch (err) {
    deleteFiles(Object.values(files));
    throw err;
  }
  const entry: PendingUpload = { metadata, files, attempts: 0 };
  store.savePending([...store.loadPending(), entry]);
  log("info", "queued", { shot: metadata.id, photos: metadata.photos.length, project: metadata.project_id });
  return entry;
}

/** The first part is on its way (from now on the server's tags may be fixed; see editedAfterSend). */
function markSent(shotId: string) {
  store.savePending(store.loadPending().map((p) => (p.metadata.id === shotId && !p.sent ? { ...p, sent: true } : p)));
}
function setEdited(shotId: string, v: boolean) {
  store.savePending(store.loadPending().map((p) => (p.metadata.id === shotId ? { ...p, editedAfterSend: v } : p)));
}

const rejected = (err: unknown) => err instanceof ApiError && err.status >= 400 && err.status < 500 && ![401, 403, 408, 429].includes(err.status);

/**
 * The PATCH after an upload. Its photos are already safe on the server, so a rejection must not
 * leave the shot stuck: retry without the extra fields (stale definitions on the phone), then give
 * up on the tags with a log entry. Network errors still throw (the upload is retried later).
 */
async function followUp(id: string, patch: Parameters<typeof api.patchShot>[1]): Promise<Shot | null> {
  try { return await api.patchShot(id, patch); } catch (err) { if (!rejected(err)) throw err; log("warn", "follow-up patch rejected, retrying without extra", { shot: id, error: String(err) }); }
  const { extra: _, ...rest } = patch;
  try { return await api.patchShot(id, rest); } catch (err) { if (!rejected(err)) throw err; log("warn", "follow-up patch rejected, tags left as uploaded", { shot: id, error: String(err) }); }
  return null;
}

const uploadedListeners = new Set<(shot: Shot) => void>();
/** Called with the server's copy of each shot that just left the queue. */
export function onUploaded(cb: (shot: Shot) => void): () => void {
  uploadedListeners.add(cb);
  return () => { uploadedListeners.delete(cb); };
}

function remove(entry: PendingUpload) {
  store.savePending(store.loadPending().filter((p) => p.metadata.id !== entry.metadata.id));
  deleteFiles(Object.values(entry.files));
}

/** Throw away a queued shot on purpose (Setup → Uploads), photos included. */
export function discardPending(shotId: string) {
  const entry = store.loadPending().find((p) => p.metadata.id === shotId);
  if (entry) { log("warn", "upload discarded by user", { shot: shotId, error: entry.lastError }); remove(entry); notify(); }
}

/** Point queued shots at the server's id where a locally created location/project clashed by name. */
function remapPending(field: "location_id" | "spot_id" | "project_id", remap: Record<string, string>) {
  if (Object.keys(remap).length === 0) return;
  store.savePending(store.loadPending().map((p) => {
    const to = p.metadata[field] ? remap[p.metadata[field]] : undefined;
    return to ? { ...p, metadata: { ...p.metadata, [field]: to } } : p;
  }));
}

/**
 * Store the server list, but keep entries created on the phone while the sync ran (they were not
 * part of this round and are pushed next time).
 */
function mergeServerList<T extends { id: string; synced: boolean }>(server: T[], localNow: T[], remap: Record<string, string>): T[] {
  const late = localNow.filter((l) => !l.synced && !server.some((s) => s.id === l.id) && !remap[l.id]);
  return [...server, ...late];
}

export interface FlushResult { uploaded: number; remaining: number; lastError?: string }

const listeners = new Set<() => void>();
/** Called after every flush (projects, locations or the active project may have changed in storage). */
export function onFlushed(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
function notify() { for (const cb of listeners) cb(); }

let flushing: Promise<FlushResult> | null = null;

/** The shot being uploaded right now (photos sent so far), for the Uploads screen and the sync indicator. */
export interface FlushProgress { shotId: string; done: number; total: number }
let progress: FlushProgress | null = null;
const progressListeners = new Set<() => void>();
/** Called when a flush starts, after each uploaded part, and when it ends. */
export function onFlushProgress(cb: () => void): () => void {
  progressListeners.add(cb);
  return () => { progressListeners.delete(cb); };
}
function setProgress(p: FlushProgress | null) { progress = p; for (const cb of progressListeners) cb(); }
export const flushState = () => ({ flushing: !!flushing, progress });

/**
 * Upload everything in the queue, oldest first. Safe to call repeatedly. Shots the server
 * rejected MAX_REJECTIONS times are skipped unless `includeStuck` (the manual retry).
 */
export function flush(opts: { includeStuck?: boolean } = {}): Promise<FlushResult> {
  if (flushing) return flushing;
  // Offline mode: nothing leaves the phone until it is switched off.
  if (isOfflineMode()) return Promise.resolve({ uploaded: 0, remaining: store.loadPending().length, lastError: "offline mode is on" });
  flushing = (async () => {
    let uploaded = 0;
    let lastError: string | undefined;
    // Projects, locations and spots first, so a shot never arrives before what it references.
    const projects = await syncProjects(store.loadProjects());
    if (projects) {
      store.saveProjects(mergeServerList(projects.items, store.loadProjects(), projects.remap));
      remapPending("project_id", projects.remap);
      const active = store.loadActiveProjectId();
      if (active && projects.remap[active]) store.saveActiveProjectId(projects.remap[active]);
    }
    try { store.saveFields(await api.listFields()); } catch { /* offline: keep the cached definitions */ }
    try { store.saveLayouts(await api.listLayouts()); } catch { /* offline: keep the cached layouts */ }
    const locations = await syncLocations(store.loadLocations());
    if (locations) {
      store.saveLocations(mergeServerList(locations.items, store.loadLocations(), locations.remap));
      remapPending("location_id", locations.remap);
      remapEdits("location_id", locations.remap);
      // Spots made under a location that was just adopted point at the server's location.
      if (Object.keys(locations.remap).length) store.saveSpots(store.loadSpots().map((x) => (locations.remap[x.locationId] ? { ...x, locationId: locations.remap[x.locationId] } : x)));
    }
    const spots = await syncSpots(store.loadSpots());
    if (spots) {
      store.saveSpots(mergeServerList(spots.items, store.loadSpots(), spots.remap));
      remapPending("spot_id", spots.remap);
      remapEdits("spot_id", spots.remap);
    }
    for (const queued of store.loadPending()) {
      let entry = queued;
      if (entry.stuck && !opts.includeStuck) continue;
      const missing = entry.metadata.photos.filter((p) => !entry.files[p.id] || !new File(entry.files[p.id]).exists);
      if (missing.length) {
        // Upload what is left rather than losing the whole shot for one missing file.
        log("error", "queued photos missing on disk", { shot: entry.metadata.id, missing: missing.length });
        lastError = `${missing.length} photo(s) of a queued shot were missing on the phone`;
        if (missing.length === entry.metadata.photos.length) { remove(entry); continue; }
        entry = { ...entry, metadata: { ...entry.metadata, photos: entry.metadata.photos.filter((p) => !missing.includes(p)) } };
        store.savePending(store.loadPending().map((p) => (p.metadata.id === entry.metadata.id ? entry : p)));
      }
      try {
        // Big sequences go in parts; the server adds missing photos to the existing shot.
        const total = entry.metadata.photos.length;
        // From the first request on, the server may hold the tags it got: later edits need a PATCH.
        markSent(entry.metadata.id);
        let server: Shot | null = null;
        for (let i = 0; i < total; i += UPLOAD_CHUNK) {
          setProgress({ shotId: entry.metadata.id, done: i, total });
          server = (await api.uploadShot({ ...entry.metadata, photos: entry.metadata.photos.slice(i, i + UPLOAD_CHUNK) }, entry.files)).shot;
        }
        // Tags, state or positions changed on the phone after that: bring the server up to date. An
        // edit made while the PATCH runs sets the flag again, so loop until it stays clear.
        let latest = store.loadPending().find((p) => p.metadata.id === entry.metadata.id) ?? entry;
        while (latest.editedAfterSend) {
          setEdited(latest.metadata.id, false);
          const { id, photos, ...rest } = latest.metadata;
          const { project_id: _, ...tags } = rest;
          server = await followUp(id, { ...tags, state: latest.metadata.state ?? "unreviewed" }) ?? server;
          for (const p of photos) if (p.position_corrected && p.lat !== null && p.lon !== null) server = await api.patchPhotoPosition(p.id, p.lat, p.lon, false);
          latest = store.loadPending().find((p) => p.metadata.id === entry.metadata.id) ?? latest;
        }
        log("info", "upload ok", { shot: entry.metadata.id, photos: entry.metadata.photos.length });
        remove(latest);
        // Hand the server's copy to the lists right away, so the shot doesn't blink out until a reload.
        if (server) for (const cb of uploadedListeners) cb(server);
        store.addHistory({ id: latest.metadata.id, projectId: latest.metadata.project_id, name: latest.metadata.name, photos: latest.metadata.photos.length,
          capturedAt: latest.metadata.photos.map((p) => p.timestamp).sort()[0] ?? new Date().toISOString(), uploadedAt: new Date().toISOString() });
        uploaded++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        lastError = msg;
        log("warn", "upload failed", { shot: entry.metadata.id, attempts: entry.attempts + 1, error: msg });
        // 4xx other than 401/403/408/429 means the payload itself is rejected; retrying won't help by itself.
        const rejected = err instanceof ApiError && err.status >= 400 && err.status < 500 && ![401, 403, 408, 429].includes(err.status);
        const q = store.loadPending();
        const i = q.findIndex((p) => p.metadata.id === entry.metadata.id);
        if (i >= 0) {
          const attempts = q[i].attempts + 1;
          q[i] = { ...q[i], attempts, lastError: msg, stuck: rejected && attempts >= MAX_REJECTIONS };
          store.savePending(q);
        }
        if (!rejected) break; // network/auth problem: stop and try again later
      }
    }
    const edits = await flushEdits();
    return { uploaded, remaining: store.loadPending().length, lastError: lastError ?? edits.lastError };
  })().finally(() => { flushing = null; setProgress(null); notify(); });
  setProgress(null); // announce the start (flushing is set now)
  return flushing;
}
