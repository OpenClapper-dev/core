import type { ShotState } from "@openclapper/vocab";
import { api, ApiError, type Photo, type Shot } from "./api";
import { log } from "./log";
import { isOfflineMode } from "./net";
import { store } from "./storage";
import type { PendingEdit, PendingUpload, ShotTags } from "./types";

/**
 * What the phone can show and change without the server. Queued shots (the upload queue) appear
 * as shots with local photos; edits of uploaded shots made offline wait in `pendingEdits.v1` and
 * are applied on top of the server's copy until flush() has sent them. Screens call editShot /
 * setPosition and don't care which of the three cases it is.
 */

export type ShotPatch = Partial<ShotTags> & { state?: ShotState };

/** A queued shot in the shape the screens use: photos point at the files in the queue. */
export function queuedToShot(entry: PendingUpload): Shot {
  const m = entry.metadata;
  const at = m.photos.map((p) => p.timestamp).sort()[0] ?? new Date().toISOString();
  return {
    id: m.id,
    project_id: m.project_id,
    project_name: store.loadProjects().find((p) => p.id === m.project_id)?.name ?? null,
    location_id: m.location_id,
    location_name: m.location_id ? store.loadLocations().find((l) => l.id === m.location_id)?.name ?? null : null,
    spot_id: m.spot_id ?? null,
    spot_name: m.spot_id ? store.loadSpots().find((x) => x.id === m.spot_id)?.name ?? null : null,
    name: m.name,
    int_ext: m.int_ext,
    light: m.light,
    artificial: m.artificial,
    weather: m.weather,
    shot_size: m.shot_size ?? null,
    camera_support: m.camera_support ?? null,
    movement: m.movement ?? [],
    state: m.state ?? "unreviewed",
    extra: m.extra ?? {},
    description: null,
    position_from_location: false,
    location_position: null,
    captured_at: at,
    created_at: at,
    updated_at: null,
    photos: m.photos.map((p): Photo => ({
      id: p.id, shot_id: m.id, ordinal: p.ordinal, timestamp: p.timestamp, lat: p.lat, lon: p.lon, gps_accuracy_m: p.gps_accuracy_m,
      position_corrected: !!p.position_corrected, preset_id: p.preset_id, preset_name: (p.framing?.preset_name as string | undefined) ?? null,
      lens_mm: p.lens_mm, width: p.width, height: p.height, framing: p.framing, device: p.device, image_url: "", created_at: p.timestamp,
      local_uri: entry.files[p.id],
    })),
    layers: [],
    bakes: [],
    sketches: [],
    queued: true,
  };
}

/** The queued shots of a project, newest first. */
export const queuedShots = (projectId: string | null): Shot[] =>
  store.loadPending().filter((p) => p.metadata.project_id === projectId).map(queuedToShot);

/** A server shot with the edits still waiting for the server applied. */
export function withEdits(shot: Shot, edits: PendingEdit[] = store.loadEdits()): Shot {
  const e = edits.find((x) => x.shotId === shot.id);
  if (!e) return shot;
  let photos = shot.photos;
  for (const p of e.positions) {
    photos = photos.map((ph) => (p.all || ph.id === p.photoId ? { ...ph, lat: p.lat, lon: p.lon, position_corrected: true } : ph));
  }
  const loc = e.patch.location_id !== undefined ? store.loadLocations().find((l) => l.id === e.patch.location_id) : undefined;
  const spot = e.patch.spot_id !== undefined ? store.loadSpots().find((x) => x.id === e.patch.spot_id) : undefined;
  return {
    ...shot, ...e.patch, photos,
    location_name: e.patch.location_id === undefined ? shot.location_name : loc?.name ?? null,
    spot_name: e.patch.spot_id === undefined ? shot.spot_name : spot?.name ?? null,
  };
}

/** Changes of this shot wait on the phone for the server. */
export const isWaiting = (shotId: string) => store.loadEdits().some((e) => e.shotId === shotId);

/** Network trouble (or offline mode): keep the change on the phone. A 4xx is the server saying no. */
const deferrable = (e: unknown) =>
  !(e instanceof ApiError) || e.status === 0 || e.status === 401 || e.status === 408 || e.status === 429 || e.status >= 500;

function queueEdit(shotId: string, change: { patch?: ShotPatch; position?: PendingEdit["positions"][number] }) {
  const all = store.loadEdits();
  const i = all.findIndex((e) => e.shotId === shotId);
  const cur: PendingEdit = i >= 0 ? all[i] : { shotId, patch: {}, positions: [], at: new Date().toISOString() };
  const next: PendingEdit = { ...cur, patch: { ...cur.patch, ...change.patch }, positions: change.position ? [...cur.positions, change.position] : cur.positions };
  store.saveEdits(i >= 0 ? all.map((e, j) => (j === i ? next : e)) : [...all, next]);
  log("info", "edit kept on the phone", { shot: shotId, fields: Object.keys(change.patch ?? {}), position: !!change.position });
}

function updateQueued(shotId: string, fn: (p: PendingUpload) => PendingUpload): Shot | null {
  const q = store.loadPending();
  const i = q.findIndex((p) => p.metadata.id === shotId);
  if (i < 0) return null;
  // Parts already on the server keep their tags there: finish with a PATCH after the upload.
  const next = { ...fn(q[i]), editedAfterSend: q[i].sent ? true : q[i].editedAfterSend };
  q[i] = next;
  store.savePending(q);
  return queuedToShot(next);
}

/**
 * Change tags or the review state. Queued: rewrites the queue entry. Uploaded: PATCH, or kept on
 * the phone when offline (also when older offline edits of this shot still wait, so order holds).
 * Throws only when the server rejects the change.
 */
export async function editShot(shot: Shot, patch: ShotPatch): Promise<Shot> {
  if (shot.queued) {
    const r = updateQueued(shot.id, (p) => ({ ...p, metadata: { ...p.metadata, ...patch } }));
    if (r) return r;
    // Uploaded meanwhile: fall through to the server copy.
  }
  const waiting = store.loadEdits().some((e) => e.shotId === shot.id);
  if (!isOfflineMode() && !waiting) {
    try { return await api.patchShot(shot.id, patch); } catch (e) { if (!deferrable(e)) throw e; }
  }
  queueEdit(shot.id, { patch });
  return withEdits({ ...shot, ...patch });
}

/** Set a photo's position by hand (or all photos of the shot), with the same three cases as editShot. */
export async function setPosition(shot: Shot, photoId: string, lat: number, lon: number, all: boolean): Promise<Shot> {
  if (shot.queued) {
    const r = updateQueued(shot.id, (p) => ({
      ...p,
      metadata: { ...p.metadata, photos: p.metadata.photos.map((ph) => (all || ph.id === photoId ? { ...ph, lat, lon, position_corrected: true } : ph)) },
    }));
    if (r) return r;
  }
  const waiting = store.loadEdits().some((e) => e.shotId === shot.id);
  if (!isOfflineMode() && !waiting) {
    try { return await api.patchPhotoPosition(photoId, lat, lon, all); } catch (e) { if (!deferrable(e)) throw e; }
  }
  queueEdit(shot.id, { position: { photoId, lat, lon, all } });
  return withEdits(shot, store.loadEdits());
}

/**
 * Send the edits kept on the phone, oldest first (part of flush). A rejected edit is dropped and
 * logged (the server's copy stays); a network error stops and keeps the rest for next time.
 */
export async function flushEdits(): Promise<{ sent: number; lastError?: string }> {
  let sent = 0;
  let lastError: string | undefined;
  for (const e of store.loadEdits()) {
    try {
      if (Object.keys(e.patch).length) await api.patchShot(e.shotId, e.patch);
      for (const p of e.positions) await api.patchPhotoPosition(p.photoId, p.lat, p.lon, p.all);
      sent++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (deferrable(err)) return { sent, lastError: msg };
      lastError = msg;
      log("warn", "kept edit rejected, dropped", { shot: e.shotId, error: msg });
    }
    // Changed while it was being sent: keep it (resending is harmless, the PATCHes are idempotent).
    store.saveEdits(store.loadEdits().filter((x) => !(x.shotId === e.shotId && JSON.stringify(x) === JSON.stringify(e))));
  }
  return { sent, lastError };
}

/** Point waiting edits at the server's location or spot id where a name clashed (like the upload queue). */
export function remapEdits(field: "location_id" | "spot_id", remap: Record<string, string>) {
  if (Object.keys(remap).length === 0) return;
  store.saveEdits(store.loadEdits().map((e) => {
    const from = e.patch[field];
    const to = from ? remap[from] : undefined;
    return to ? { ...e, patch: { ...e.patch, [field]: to } } : e;
  }));
}
