import { randomUUID } from "expo-crypto";
import { binFiles, canCall, getFile, listFiles, moveFiles, putFile, type FileRec, type PhotoFacts } from "../api";
import { log } from "../log";
import { currentProject } from "../projects";
import { settings } from "../settings";
import { persisted } from "../store";
import { onSync } from "../sync";
import { fetchImage, isCached } from "./cache";
import { editQueued, onUploaded, queue, queuedUri, type QueuedPhoto } from "./queue";
import { stateOf, type QueueState } from "./steps";

/**
 * What Media shows of a project: its photos, collections and folders from the server, kept on the
 * phone (so Media opens at once and works offline), with the photos still in the queue merged in.
 */
export interface Library { projectId: string; files: FileRec[]; loaded: string }
const store = persisted<Library | null>("library.v1", null);

/** A photo as Media shows it, from the server or still on the phone. */
export interface MediaPhoto {
  id: string; name: string; container: string | null; taken: string | null;
  width: number; height: number;
  photo: PhotoFacts | null;
  /** In the queue: where it stands, and its local thumbnail. */
  queued: { state: QueueState; error: string | null; uri: string | null } | null;
}
export interface Holder { id: string; type: "folder" | "collection"; name: string; container: string | null; color: number | string; created: string }

let loading: Promise<void> | null = null;
const loadListeners = new Set<(busy: boolean) => void>();
export const onLoading = (cb: (busy: boolean) => void) => { loadListeners.add(cb); return () => { loadListeners.delete(cb); }; };

/** Loads the active project's media from the server; keeps the last copy when it cannot. */
export function loadLibrary(): Promise<void> {
  if (loading) return loading;
  const project = currentProject();
  if (!project || !canCall() || !project.synced) return Promise.resolve();
  for (const cb of loadListeners) cb(true);
  loading = (async () => {
    try {
      const root = { project_id: project.id };
      const [photos, holders] = await Promise.all([listFiles(root, { type: "photo" }), listFiles(root, { type: "folder,collection", body: true })]);
      store.set({ projectId: project.id, files: [...holders.filter((f) => !f.fixed), ...photos], loaded: new Date().toISOString() });
      if (settings.get().keepProject) void keepOnPhone();
    } catch (e) { log("warn", "media load failed", e); }
  })().finally(() => { loading = null; for (const cb of loadListeners) cb(false); });
  return loading;
}
onSync(loadLibrary);
// A photo whose preview reached the server is now one of the project's: reload to show its server facts.
let reloadTimer: ReturnType<typeof setTimeout> | undefined;
onUploaded((_id, done) => {
  // Until the reload, the photo that just left the queue is shown from what the phone knows of it.
  if (done) store.set((l) => (l && l.projectId === done.meta.project_id && !l.files.some((f) => f.id === done.id) ? { ...l, files: [...l.files, asFile(done)] } : l));
  clearTimeout(reloadTimer); reloadTimer = setTimeout(() => void loadLibrary(), 1500);
});

function asFile(q: QueuedPhoto): FileRec {
  const m = q.meta;
  return {
    id: q.id, project_id: m.project_id, type: "photo", name: m.name, container: m.container ?? null, internal_of: null, fixed: null,
    created_at: q.added, updated_at: q.added, created_by: null, deleted_at: null, body_version: 1,
    photo: { origin: m.origin, media_type: m.media_type ?? null, taken_at: m.taken_at ?? q.added, width: m.width, height: m.height, stored: { thumbnail: 1, preview: 1, original: 1 }, angle_of_view: null, device_id: m.device_id ?? null },
  };
}

/** The library of the active project, with queued photos merged in. */
export function useLibrary(): { photos: MediaPhoto[]; holders: Holder[]; loaded: string | null } {
  const lib = store.use();
  const q = queue.use();
  const project = currentProject();
  const files = lib && lib.projectId === project?.id ? lib.files : [];
  const queued = q.filter((x) => x.meta.project_id === project?.id);
  const qIds = new Set(queued.map((x) => x.id));
  const photos: MediaPhoto[] = [
    ...files.filter((f) => f.type === "photo" && !qIds.has(f.id)).map((f): MediaPhoto => ({ id: f.id, name: f.name, container: f.container, taken: f.photo?.taken_at ?? f.created_at, width: f.photo?.width ?? 0, height: f.photo?.height ?? 0, photo: f.photo ?? null, queued: null })),
    ...queued.map(fromQueue),
  ].sort((a, b) => (a.taken ?? "").localeCompare(b.taken ?? ""));
  const holders = files.filter((f) => f.type === "folder" || f.type === "collection").map((f): Holder => ({ id: f.id, type: f.type as Holder["type"], name: f.name, container: f.container, color: (f.body?.color as number | string | undefined) ?? 1, created: f.created_at }));
  return { photos, holders, loaded: lib && lib.projectId === project?.id ? lib.loaded : null };
}

function fromQueue(x: QueuedPhoto): MediaPhoto {
  return { id: x.id, name: x.meta.name, container: x.meta.container ?? null, taken: x.meta.taken_at ?? x.added, width: x.meta.width, height: x.meta.height, photo: null, queued: { state: stateOf(x), error: x.error, uri: queuedUri(x) } };
}

/** Whether the server knows the photo already (its first step went through). */
const announced = (id: string) => { const x = queue.get().find((q) => q.id === id); return !x || x.step !== "meta"; };

/** Applies a change to the copy on the phone at once (the server's answer replaces it at the next load). */
function patch(ids: string[], change: Partial<FileRec>) {
  store.set((l) => (l ? { ...l, files: l.files.map((f) => (ids.includes(f.id) ? { ...f, ...change } : f)) } : l));
}

export async function renamePhoto(id: string, name: string) {
  const n = name.trim().slice(0, 120);
  if (!n) return;
  editQueued(id, { name: n });
  patch([id], { name: n });
  const project = currentProject();
  if (announced(id) && project) await putFile(id, { type: "photo", project_id: project.id, name: n });
}

/** Puts photos into a collection or folder (null: the top level), on the server and in the queue. */
export async function placePhotos(ids: string[], container: string | null) {
  for (const id of ids) editQueued(id, { container });
  patch(ids, { container });
  const sent = ids.filter(announced);
  if (sent.length) await moveFiles(sent, container);
}

/** A new collection of these photos, in a random one of the eight colours, where they are. */
export async function makeCollection(ids: string[], name: string, container: string | null): Promise<string> {
  const project = currentProject();
  if (!project) throw new Error("no project");
  const id = randomUUID();
  const file = await putFile(id, { type: "collection", project_id: project.id, name, container, body: { color: 1 + Math.floor(Math.random() * 8), order: "time" } });
  store.set((l) => (l ? { ...l, files: [file, ...l.files] } : l));
  await placePhotos(ids, id);
  return id;
}

export async function binPhoto(id: string) {
  await binFiles([id]);
  store.set((l) => (l ? { ...l, files: l.files.filter((f) => f.id !== id) } : l));
}

/** The body of a photo (its EXIF readout), loaded for the photo's facts. */
export const photoFile = (id: string) => getFile(id);

let keeping: Promise<void> | null = null;
/** Downloads the thumbnails and previews of the project's photos not on the phone yet (Setup, Offline). */
export function keepOnPhone(): Promise<void> {
  if (keeping) return keeping;
  keeping = (async () => {
    const lib = store.get();
    if (!lib) return;
    for (const f of lib.files.filter((x) => x.type === "photo" && x.photo?.stored.preview)) {
      if (!settings.get().keepProject) return;
      try {
        if (!isCached(f.id, "thumbnail")) await fetchImage(f.id, "thumbnail");
        if (!isCached(f.id, "preview")) await fetchImage(f.id, "preview");
      } catch (e) { log("warn", "keep on phone stopped", e); return; }
    }
  })().finally(() => { keeping = null; });
  return keeping;
}
