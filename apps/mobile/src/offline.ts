import { File } from "expo-file-system";
import { dataDir, kv as Storage } from "./kv";
import { imageHeaders, imageUri, renderUri, type Overlay, type Photo, type Shot, type ShootingDay, type Sketch } from "./api";
import { API_URL } from "./config";
import { log } from "./log";

/**
 * Shooting days made available offline: the day, its shots (with all metadata) and every photo
 * image are stored on the phone, so the day can be worked through without a connection.
 * New captures work offline anyway (they queue); this covers browsing the plan.
 */
export interface OfflineDay { day: ShootingDay; shots: Shot[]; projectName: string; savedAt: string }

const KEY = "offlineDays.v1";
const dir = dataDir("offline-photos");

function readAll(): Record<string, OfflineDay> {
  try { const raw = Storage.getItemSync(KEY); return raw ? (JSON.parse(raw) as Record<string, OfflineDay>) : {}; } catch { return {}; }
}
const writeAll = (v: Record<string, OfflineDay>) => Storage.setItemSync(KEY, JSON.stringify(v));

export const offlineDays = (): OfflineDay[] => Object.values(readAll()).sort((a, b) => a.day.date.localeCompare(b.day.date));
export const offlineDay = (id: string): OfflineDay | null => readAll()[id] ?? null;

const photoFile = (id: string) => new File(dir, `${id}.jpg`);
// Renders change when the dashboard saves again, so the file carries the version from render_url (?v=…).
const renderVersion = (item: { render_url: string | null }) => (item.render_url?.split("v=")[1] ?? "").replace(/[^0-9A-Za-z]/g, "").slice(0, 24);
const renderFile = (item: { id: string; render_url: string | null }) => new File(dir, `r-${item.id}-${renderVersion(item)}.jpg`);
const rendersOf = (shots: Shot[]): (Overlay | Sketch)[] => shots.flatMap((s) => [...s.overlays, ...s.sketches]).filter((r) => !!r.render_url);

/** Local copy of a photo if one was saved for an offline day, else null. */
export function offlinePhotoUri(photo: Photo): string | null {
  try { const f = photoFile(photo.id); return f.exists ? f.uri : null; } catch { return null; }
}
/** Local copy of an overlay or sketch render (this exact version), else null. */
export function offlineRenderUri(item: { id: string; render_url: string | null }): string | null {
  if (!item.render_url) return null;
  try { const f = renderFile(item); return f.exists ? f.uri : null; } catch { return null; }
}
/** Download one render and drop older versions of it. */
async function fetchRender(item: Overlay | Sketch) {
  const f = renderFile(item);
  if (f.exists) return;
  await File.downloadFileAsync(renderUri(item)!, f, { headers: imageHeaders(), idempotent: true });
  try { for (const old of dir.list()) if (old instanceof File && old.name.startsWith(`r-${item.id}-`) && old.name !== f.name) old.delete(); } catch { /* best effort */ }
}

/** Save a day and download its photos. Reports progress as (done, total). Throws if a download fails. */
export async function saveDayOffline(day: ShootingDay, shots: Shot[], projectName: string, onProgress?: (done: number, total: number) => void): Promise<OfflineDay> {
  if (!dir.exists) dir.create({ intermediates: true });
  const planned = day.shots.map((ds) => shots.find((s) => s.id === ds.shot_id)).filter((s): s is Shot => !!s);
  const photos = planned.flatMap((s) => s.photos);
  const renders = rendersOf(planned);
  const total = photos.length + renders.length;
  let done = 0;
  onProgress?.(0, total);
  for (const p of photos) {
    if (!photoFile(p.id).exists) await File.downloadFileAsync(imageUri(p), photoFile(p.id), { headers: imageHeaders(), idempotent: true });
    onProgress?.(++done, total);
  }
  for (const r of renders) { await fetchRender(r); onProgress?.(++done, total); }
  const entry: OfflineDay = { day, shots: planned, projectName, savedAt: new Date().toISOString() };
  writeAll({ ...readAll(), [day.id]: entry });
  log("info", "day saved offline", { day: day.id, shots: planned.length, photos: photos.length, api: API_URL });
  return entry;
}

/** Remove a day's offline copy; photos still used by another offline day or project stay. */
export function removeOfflineDay(id: string) {
  const all = readAll();
  const gone = all[id];
  if (!gone) return;
  delete all[id];
  writeAll(all);
  deleteUnused(gone.shots);
}

/** Delete the local photos and renders of these shots unless an offline day or project still uses them. */
function deleteUnused(shots: Shot[]) {
  const kept = [...Object.values(readAll()), ...Object.values(readProjects())].flatMap((d) => d.shots);
  const keep = new Set(kept.flatMap((s) => s.photos.map((p) => p.id)));
  const keepRenders = new Set(rendersOf(kept).map((r) => r.id));
  for (const s of shots) {
    for (const p of s.photos) {
      if (keep.has(p.id)) continue;
      try { const f = photoFile(p.id); if (f.exists) f.delete(); } catch { /* best effort */ }
    }
    for (const r of [...s.overlays, ...s.sketches]) {
      if (keepRenders.has(r.id)) continue;
      try { for (const f of dir.list()) if (f instanceof File && f.name.startsWith(`r-${r.id}-`)) f.delete(); } catch { /* best effort */ }
    }
  }
}

// ---------- Whole projects ----------

/**
 * A project kept on the phone: every shot with its metadata and photos, so Shots and Review work
 * without a connection. Refreshed in the background whenever the project's shots load online
 * (only new photos are downloaded).
 */
export interface OfflineProject { projectId: string; projectName: string; shots: Shot[]; savedAt: string; bytes: number }

const PROJECTS_KEY = "offlineProjects.v1";
function readProjects(): Record<string, OfflineProject> {
  try { const raw = Storage.getItemSync(PROJECTS_KEY); return raw ? (JSON.parse(raw) as Record<string, OfflineProject>) : {}; } catch { return {}; }
}
const writeProjects = (v: Record<string, OfflineProject>) => Storage.setItemSync(PROJECTS_KEY, JSON.stringify(v));
export const offlineProject = (projectId: string | null): OfflineProject | null => (projectId ? readProjects()[projectId] ?? null : null);

/** Download progress of a project copy, for the Offline screen. */
export interface ProjectProgress { projectId: string; done: number; total: number }
let progress: ProjectProgress | null = null;
const progressListeners = new Set<() => void>();
export const projectProgress = () => progress;
export function onProjectProgress(cb: () => void): () => void { progressListeners.add(cb); return () => { progressListeners.delete(cb); }; }
const setProgress = (p: ProjectProgress | null) => { progress = p; for (const cb of progressListeners) cb(); };

let running: Promise<OfflineProject> | null = null;

/**
 * Store a project's shots and download the photos not on the phone yet. Photos of shots that left
 * the project are deleted (unless an offline day uses them). One copy runs at a time.
 */
export function saveProjectOffline(projectId: string, projectName: string, shots: Shot[]): Promise<OfflineProject> {
  if (running) return running;
  running = (async () => {
    if (!dir.exists) dir.create({ intermediates: true });
    const photos = shots.flatMap((s) => s.photos);
    const missing = photos.filter((p) => !photoFile(p.id).exists);
    const renders = rendersOf(shots).filter((r) => !renderFile(r).exists);
    const total = missing.length + renders.length;
    setProgress({ projectId, done: 0, total });
    let done = 0;
    for (const p of missing) {
      await File.downloadFileAsync(imageUri(p), photoFile(p.id), { headers: imageHeaders(), idempotent: true });
      setProgress({ projectId, done: ++done, total });
    }
    for (const r of renders) { await fetchRender(r); setProgress({ projectId, done: ++done, total }); }
    let bytes = 0;
    for (const p of photos) { try { bytes += photoFile(p.id).size ?? 0; } catch { /* size unknown */ } }
    const before = readProjects()[projectId];
    const entry: OfflineProject = { projectId, projectName, shots, savedAt: new Date().toISOString(), bytes };
    writeProjects({ ...readProjects(), [projectId]: entry });
    if (before) deleteUnused(before.shots.filter((s) => !shots.some((x) => x.id === s.id)));
    log("info", "project saved offline", { project: projectId, shots: shots.length, downloaded: missing.length });
    return entry;
  })().finally(() => { running = null; setProgress(null); });
  return running;
}

/** Stop keeping a project on the phone; photos an offline day still uses stay. */
export function removeOfflineProject(projectId: string) {
  const all = readProjects();
  const gone = all[projectId];
  if (!gone) return;
  delete all[projectId];
  writeProjects(all);
  deleteUnused(gone.shots);
}
