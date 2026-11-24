import { randomUUID } from "expo-crypto";
import type { PresetBody, PropertyDef } from "@openclapper/model";
import { binFiles, canCall, getFile, listFiles, moveFiles, putFile, type FileRec, type PhotoFacts } from "../api";
import { log } from "../log";
import { currentProject } from "../projects";
import { settings } from "../settings";
import { persisted } from "../store";
import { onSync } from "../sync";
import { fetchImage, isCached } from "./cache";
import { editQueued, onUploaded, queue, queuedName, queuedUri, type QueuedPhoto } from "./queue";
import { stateOf, type QueueState } from "./steps";

/**
 * What Media shows of a project: its photos, collections and folders from the server, kept on the
 * phone (so Media opens at once and works offline), with the photos still in the queue merged in.
 */
export interface Library { projectId: string; files: FileRec[]; loaded: string }
const store = persisted<Library | null>("library.v1", null);

/** A canvas as Media shows it: a tile of its thumbnail. */
export interface MediaCanvas { id: string; name: string; container: string | null; updated: string; file: FileRec }
/** The project's canvases, newest change first. */
export function useCanvases(): MediaCanvas[] {
  const lib = store.use();
  const project = currentProject();
  if (!lib || lib.projectId !== project?.id) return [];
  return lib.files.filter((f) => f.type === "canvas" && !f.internal_of).map((f) => ({ id: f.id, name: f.name, container: f.container, updated: f.updated_at ?? f.created_at, file: f })).sort((a, b) => b.updated.localeCompare(a.updated));
}
/** The project's optics presets, by id (a canvas's frames are measured with them). */
export function usePresets(): Map<string, PresetBody> {
  const lib = store.use();
  return new Map((lib?.files ?? []).filter((f) => f.type === "preset" && f.body).map((f) => [f.id, f.body as unknown as PresetBody]));
}

/** The project's property definitions, as Media loaded them. */
export function useDefinitions(): { id: string; name: string; def: PropertyDef }[] {
  const lib = store.use();
  const project = currentProject();
  if (!lib || lib.projectId !== project?.id) return [];
  return lib.files.filter((f) => f.type === "property" && f.body).map((f) => ({ id: f.id, name: f.name, def: f.body as unknown as PropertyDef })).sort((a, b) => a.def.order - b.def.order);
}
/** The project's shots, sets or locations (docs/features/shots.md), by name. */
export function usePlaces(type: "shot" | "set" | "location"): FileRec[] {
  const lib = store.use();
  const project = currentProject();
  if (!lib || lib.projectId !== project?.id) return [];
  return lib.files.filter((f) => f.type === type && !f.internal_of).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}
/** Every file of the loaded library, by id (a shot's pictures, a reference's name). */
export function useLibraryMap(): Map<string, FileRec> {
  const lib = store.use();
  return new Map((lib?.files ?? []).map((f) => [f.id, f]));
}
/** Puts a file the server answered with into the copy on the phone (a shot after its lists changed). */
export const takeFile = (file: FileRec) => store.set((l) => (l ? { ...l, files: l.files.some((f) => f.id === file.id) ? l.files.map((f) => (f.id === file.id ? { ...f, ...file, values: file.values ?? f.values } : f)) : [file, ...l.files] } : l));

/** A file of the loaded library by id (for the names of references). */
export const libraryFile = (id: string) => store.get()?.files.find((f) => f.id === id) ?? null;
/** Stored values of a file of the library. */
export const storedValues = (id: string): Record<string, unknown> => store.get()?.files.find((f) => f.id === id)?.values ?? {};
/** Applies values the server answered with to the copy on the phone. */
export const takeValues = (id: string, values: Record<string, unknown>) => store.set((l) => (l ? { ...l, files: l.files.map((f) => (f.id === id ? { ...f, values } : f)) } : l));

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
      // Photos with their property values; folders, collections and the property definitions with their bodies.
      // Canvases without their bodies (those can be large): a canvas's page loads its own.
      // Shots, sets and locations with their lists (references) and bodies; canvases made inside a shot too (internal).
      const [photos, holders, places] = await Promise.all([
        listFiles(root, { type: "photo,canvas", values: true, refs: true, internal: true }),
        listFiles(root, { type: "folder,collection,property,preset", body: true }),
        listFiles(root, { type: "shot,set,location", body: true, refs: true, values: true }),
      ]);
      store.set({ projectId: project.id, files: [...holders.filter((f) => !f.fixed), ...photos, ...places], loaded: new Date().toISOString() });
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
    id: q.id, project_id: m.project_id, type: "photo", name: m.name ?? "Photo", container: m.container ?? null, internal_of: null, fixed: null,
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
  return { id: x.id, name: queuedName(x), container: x.meta.container ?? null, taken: x.meta.taken_at ?? x.added, width: x.meta.width, height: x.meta.height, photo: null, queued: { state: stateOf(x), error: x.error, uri: queuedUri(x) } };
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
