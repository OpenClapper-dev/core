/** Same-origin API; the Access session cookie is sent automatically. */
import type { DeviceSpecs, ViewfinderLayout, Framing, PhotoSource, Drawing, Extra, FieldDef, FieldDefinition, FilterGroup, Presentation, ClipGroup } from "@fielder/vocab";
export type { ClipGroup } from "@fielder/vocab";
export type { FieldDefinition };
export type ShotState = "unreviewed" | "approved" | "archived";

/** One image of a shot. Rig/lens framing and GPS are per photo (a sequence can change lens). */
export interface Photo {
  id: string;
  shot_id: string;
  ordinal: number;
  timestamp: string;
  /** Both null when captured without GPS. */
  lat: number | null;
  lon: number | null;
  gps_accuracy_m: number | null;
  /** Moved by hand after capture. */
  position_corrected: boolean;
  preset_id: string | null;
  preset_name: string | null;
  lens_mm: number;
  width: number | null;
  height: number | null;
  framing: Record<string, unknown> | null;
  device: Record<string, unknown> | null;
  /** camera = captured on the phone (rig framing); upload / drawn = made on the dashboard, no rig or lens (lens_mm 0). */
  source: PhotoSource;
  /** Saved re-framings (issue #29), in order. */
  framings: Framing[];
  /** The framing every view shows; null = as captured. */
  root_framing_id: string | null;
  image_url: string;
  created_at: string;
}
/** The unit of scouting metadata: one photo, or a whole sequence. */
export interface Shot {
  id: string;
  project_id: string;
  project_name: string | null;
  location_id: string | null;
  location_name: string | null;
  /** A spot within the location (issue #44); always one of the shot's location. */
  spot_id: string | null;
  spot_name: string | null;
  name: string | null;
  int_ext: string | null;
  light: string[];
  artificial: boolean;
  weather: string | null;
  shot_size: string | null;
  camera_support: string | null;
  movement: string[];
  state: ShotState;
  extra: Extra;
  /** Markdown subset (packages/vocab markdown.ts). */
  description: string | null;
  /** Maps and filters use the place's pin instead of the photos' GPS (the photos keep theirs). */
  position_from_location: boolean;
  /** The place's pin: the spot's, else the location's; null when neither has one. */
  location_position: { lat: number; lon: number } | null;
  captured_at: string;
  created_at: string;
  updated_at: string | null;
  /** Ordered; never empty. */
  photos: Photo[];
  /** Drawings over single photos, in display order, without their drawing data (fetchOverlay has it). */
  overlays: Overlay[];
  /** Free canvases on the shot, in display order, without their drawing data (fetchSketch has it). */
  sketches: Sketch[];
}
/** A drawing + look over one photo (issue #12). `drawing` is only present when fetched alone. */
export interface Overlay {
  id: string; photo_id: string; shot_id: string; name: string; description: string | null;
  /** Set when the overlay belongs to a timeline clip (issue #31); shots never embed those. */
  timeline_id?: string | null; clip_id?: string | null;
  drawing?: Drawing; presentation: Presentation; position: number;
  /** Flattened render (photo + look + drawing, photo-sized), or null before the first save with a render. */
  render_url: string | null; created_at: string; updated_at: string | null;
}
/** A free canvas on the shot (floor plan, lighting diagram, …). */
export interface Sketch {
  /** A timeline clip's own sketch has no shot (issue #31); shots only embed their own. */
  id: string; shot_id: string; timeline_id?: string | null; clip_id?: string | null; name: string; kind: string | null; description: string | null;
  drawing?: Drawing; aspect: number; position: number; render_url: string | null; created_at: string; updated_at: string | null;
}
export interface Project { id: string; name: string; notes: string | null; created_at: string; updated_at: string | null; shot_count: number; /** Extra-field definitions the project uses, in order. */ field_ids: string[] }
export interface Preset {
  id: string;
  name: string;
  camera_id: string | null;
  format_id: string | null;
  sensor_width_mm: number;
  sensor_height_mm: number;
  speedbooster_factor: number;
  lens_min_mm: number | null;
  lens_max_mm: number | null;
  created_at: string;
  updated_at: string | null;
}
export interface Location {
  id: string;
  /** Locations belong to one project. */
  project_id: string;
  name: string;
  /** The location's pin; both null when none is set. */
  lat: number | null;
  lon: number | null;
  created_at: string;
  updated_at: string | null;
  shot_count: number;
  approved_count: number;
}
/** A named place within a location, with an optional pin (issue #44). */
export interface Spot { id: string; location_id: string; name: string; lat: number | null; lon: number | null; created_at: string; updated_at: string | null; shot_count: number }
export interface SavedView { id: string; project_id: string; name: string; filter: FilterGroup; created_at: string; updated_at: string | null }
/** null / [] / false = not specified. */
export interface ShotTags {
  name: string | null; light: string[]; artificial: boolean; weather: string | null; int_ext: string | null; location_id: string | null; spot_id: string | null; extra: Extra;
  shot_size: string | null; camera_support: string | null; movement: string[]; description: string | null; position_from_location: boolean;
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public body: unknown = null) { super(message); }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { ...init, headers: { accept: "application/json", ...(init.headers ?? {}) }, credentials: "same-origin" });
  if (res.status === 401 || res.redirected) {
    // Access session expired: reload to trigger the login redirect.
    location.reload();
    throw new ApiError(401, "session expired");
  }
  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) throw new ApiError(res.status, (body as { error?: string } | null)?.error ?? `HTTP ${res.status}`, body);
  return body as T;
}
const get = <T,>(path: string) => request<T>(path);
const send = <T,>(method: string, path: string, body?: unknown) =>
  request<T>(path, { method, headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

/** The 409 body of an upsert whose name is taken carries the id of the row that has it. */
export const existingIdOf = (err: unknown): string | undefined =>
  err instanceof ApiError && err.status === 409 ? (err.body as { existing_id?: string } | null)?.existing_id : undefined;

type Cursor = { before: string; before_id: string } | null;
interface ShotsPage { shots: Shot[]; next: Cursor }

/** Every shot of every project; the UI narrows to the active project itself, so switching projects is instant. */
export async function fetchAllShots(): Promise<Shot[]> {
  const all: Shot[] = [];
  let cursor: Cursor = null;
  for (;;) {
    const q: string = cursor ? `?limit=500&before=${encodeURIComponent(cursor.before)}&before_id=${cursor.before_id}` : "?limit=500";
    const page: ShotsPage = await get<ShotsPage>(`/api/shots${q}`);
    all.push(...page.shots);
    if (!page.next) break;
    cursor = page.next;
  }
  return all;
}

export const fetchProjects = () => get<{ projects: Project[] }>("/api/projects").then((r) => r.projects);
/** Upsert; a 409 carries body.existing_id when another project already has the name. */
export const putProject = (p: { id: string; name: string; notes: string | null }) =>
  send<{ project: Project }>("PUT", `/api/projects/${p.id}`, { name: p.name, notes: p.notes }).then((r) => r.project);
/** Listeners told when a project was created somewhere other than Library › Projects (App refreshes its list). */
const projectCreated = new Set<(p: Project) => void>();
export function onProjectCreated(cb: (p: Project) => void): () => void { projectCreated.add(cb); return () => { projectCreated.delete(cb); }; }
/**
 * Create a project by name from a picker (move a shot, bulk edit). A name that already exists
 * resolves to that project instead of failing, so typing an existing name is harmless.
 */
export async function createProjectNamed(name: string): Promise<Project> {
  try {
    const p = await putProject({ id: crypto.randomUUID(), name: name.trim(), notes: null });
    for (const cb of projectCreated) cb(p);
    return p;
  } catch (err) {
    const existing = existingIdOf(err);
    if (!existing) throw err;
    const found = (await fetchProjects()).find((p) => p.id === existing);
    if (!found) throw err;
    return found;
  }
}
export const deleteProject = (id: string) => send<{ deleted: string }>("DELETE", `/api/projects/${id}`).then(() => undefined);

export const fetchFields = () => get<{ fields: FieldDefinition[] }>("/api/fields").then((r) => r.fields);
export const putField = (id: string, projectId: string, definition: FieldDef) => send<{ field: FieldDefinition }>("PUT", `/api/fields/${id}`, { project_id: projectId, definition }).then((r) => r.field);
export const deleteField = (id: string) => send<{ deleted: string }>("DELETE", `/api/fields/${id}`).then(() => undefined);
/** Creates new keys, replaces existing ones; returns the full list. */
export const importFields = (projectId: string, fields: unknown[]) => send<{ fields: FieldDefinition[]; created: number; updated: number }>("POST", "/api/fields/import", { project_id: projectId, fields });
export const putProjectFields = (projectId: string, fieldIds: string[]) => send<{ field_ids: string[] }>("PUT", `/api/projects/${projectId}/fields`, { field_ids: fieldIds }).then((r) => r.field_ids);

/** A shooting day of a project with its planned shots in order. */
export interface DayShot { shot_id: string; planned_time: string | null; notes: string | null }
export interface ShootingDay { id: string; project_id: string; date: string; title: string | null; notes: string | null; created_at: string; updated_at: string | null; shots: DayShot[] }
export const fetchDays = (projectId: string) => get<{ days: ShootingDay[] }>(`/api/days?project_id=${projectId}`).then((r) => r.days);
export const putDay = (d: Omit<ShootingDay, "created_at" | "updated_at">) =>
  send<{ day: ShootingDay }>("PUT", `/api/days/${d.id}`, { project_id: d.project_id, date: d.date, title: d.title, notes: d.notes, shots: d.shots }).then((r) => r.day);
export const deleteDay = (id: string) => send<{ deleted: string }>("DELETE", `/api/days/${id}`).then(() => undefined);

/**
 * A rough cut of a project out of its photos (issue #12, part 2). A clip without a photo is a
 * placeholder (issue #31): `title` says what is wanted there; overlay and presentation are null.
 */
export interface TimelineClip { id: string; photo_id: string | null; shot_id: string | null; /** Seen through this overlay's render; null = the photo as is. */ overlay_id: string | null; presentation: Presentation | null; duration_ms: number; notes: string | null; title: string | null; /** A placeholder with a sketch is a sketch clip. */ sketch_id: string | null; /** The sequence block it belongs to (issue #37). */ group_id: string | null }
export interface Timeline {
  id: string; project_id: string; name: string; notes: string | null; /** Forces one presentation mode on every clip; null = per clip. */ lock_mode: Presentation["mode"] | null; created_at: string; updated_at: string | null; clips: TimelineClip[];
  /** Sequence blocks' length settings (issue #37); the server recomputes a "total" block's clip durations. */
  groups: ClipGroup[];
  /** The clips' own overlays and sketches (made inline, issue #31), without drawings; read-only for the PUT. */
  overlays: Overlay[]; sketches: Sketch[];
}
export const fetchTimelines = (projectId: string) => get<{ timelines: Timeline[] }>(`/api/timelines?project_id=${projectId}`).then((r) => r.timelines);
/** Replaces the whole timeline. Clips of photos that left the project are dropped by the server. */
export const putTimeline = (t: Omit<Timeline, "created_at" | "updated_at">) =>
  send<{ timeline: Timeline }>("PUT", `/api/timelines/${t.id}`, { project_id: t.project_id, name: t.name, notes: t.notes, lock_mode: t.lock_mode, groups: t.groups, clips: t.clips.map((c) => ({ id: c.id, photo_id: c.photo_id, overlay_id: c.overlay_id, presentation: c.presentation, duration_ms: c.duration_ms, notes: c.notes, title: c.title, sketch_id: c.sketch_id, group_id: c.group_id })) }).then((r) => r.timeline);
/** A clip's own re-frame, overlay or sketch becomes the shot's (issue #31). */
export const promoteClip = (timelineId: string, clipId: string, body: { what: "framing" | "overlay" | "sketch"; name?: string; shot_id?: string; sketch_id?: string }) =>
  send<{ timeline: Timeline; shot: Shot }>("POST", `/api/timelines/${timelineId}/clips/${clipId}/promote`, body);
export const deleteTimeline = (id: string) => send<{ deleted: string }>("DELETE", `/api/timelines/${id}`).then(() => undefined);

export const fetchPresets = () => get<{ presets: Preset[] }>("/api/presets").then((r) => r.presets);
export const putPreset = (p: Omit<Preset, "created_at" | "updated_at">) =>
  send<{ preset: Preset }>("PUT", `/api/presets/${p.id}`, {
    name: p.name, camera_id: p.camera_id, format_id: p.format_id, sensor_width_mm: p.sensor_width_mm, sensor_height_mm: p.sensor_height_mm,
    speedbooster_factor: p.speedbooster_factor, lens_min_mm: p.lens_min_mm, lens_max_mm: p.lens_max_mm,
  }).then((r) => r.preset);
export const deletePreset = (id: string) => send<{ deleted: string }>("DELETE", `/api/presets/${id}`).then(() => undefined);

/** A shot made on the dashboard (issue #27): images uploaded or drawn here, sent like a phone upload. */
export interface NewShotPhoto { id: string; blob: Blob; width: number; height: number; source: "upload" | "drawn"; timestamp: string }
export async function createShot(m: { id: string; project_id: string; name: string | null; location_id: string | null; state: ShotState; description: string | null }, photos: NewShotPhoto[]): Promise<Shot> {
  const form = new FormData();
  form.append("metadata", JSON.stringify({
    ...m, light: [], artificial: false, movement: [], extra: {},
    photos: photos.map((p, i) => ({ id: p.id, ordinal: i, timestamp: p.timestamp, source: p.source, width: p.width, height: p.height, lat: null, lon: null })),
  }));
  for (const p of photos) form.append(`photo.${p.id}`, p.blob, `${p.id}.${p.blob.type === "image/png" ? "png" : "jpg"}`);
  const r = await request<{ shot: Shot }>("/api/shots", { method: "POST", body: form });
  // The upload keeps tags of an existing shot; a description is set with a follow-up PATCH.
  return m.description ? patchShot(r.shot.id, { description: m.description }) : r.shot;
}
export const deleteShot = (id: string) => send<{ deleted: string }>("DELETE", `/api/shots/${id}`).then(() => undefined);
export const patchShot = (id: string, patch: Partial<ShotTags> & { state?: ShotState; project_id?: string }) => send<{ shot: Shot }>("PATCH", `/api/shots/${id}`, patch).then((r) => r.shot);
export type BulkSet = Partial<Omit<ShotTags, "extra">> & { state?: ShotState; project_id?: string };
/** Bulk edit: only the given fields change; `extra` is per top-level key (null clears). Sent 500 shots per request. */
export async function patchShots(ids: string[], set: BulkSet, extra: Extra = {}): Promise<Shot[]> {
  const out: Shot[] = [];
  for (let i = 0; i < ids.length; i += 500) out.push(...(await send<{ shots: Shot[] }>("PATCH", "/api/shots", { ids: ids.slice(i, i + 500), set, extra })).shots);
  return out;
}

// ---------- Framings (issue #29) ----------
export interface FramingSave { photo_id: string; name: string; rig_id: string | null; lens_mm: number; frame: { width_fraction: number; height_fraction: number; x: number; y: number }; root?: boolean }
/** Create or update a framing; `root` also makes it the photo's root. Returns the shot. */
export const putFraming = (id: string, f: FramingSave) => send<{ shot: Shot }>("PUT", `/api/framings/${id}`, f).then((r) => r.shot);
export const deleteFraming = (id: string) => send<{ shot: Shot }>("DELETE", `/api/framings/${id}`).then((r) => r.shot);
/** null = back to as captured. */
export const setRootFraming = (photoId: string, framingId: string | null) => send<{ shot: Shot }>("PUT", `/api/photos/${photoId}/root`, { framing_id: framingId }).then((r) => r.shot);

/** Correct a photo's position by hand; `allInShot` moves every photo of its shot. Returns the updated shot. */
export const patchPhotoPosition = (id: string, lat: number, lon: number, allInShot: boolean) =>
  send<{ shot: Shot }>("PATCH", `/api/photos/${id}`, { lat, lon, all_in_shot: allInShot }).then((r) => r.shot);

// ---------- Overlays and sketches ----------

/** Full overlay with its drawing. */
export const fetchOverlay = (id: string) => get<{ overlay: Overlay & { drawing: Drawing } }>(`/api/overlays/${id}`).then((r) => r.overlay);
export const fetchSketch = (id: string) => get<{ sketch: Sketch & { drawing: Drawing } }>(`/api/sketches/${id}`).then((r) => r.sketch);

/** Multipart save: the metadata JSON plus the flattened render the dashboard produced. */
async function putComposed<T>(path: string, metadata: unknown, render: Blob | null): Promise<T> {
  const form = new FormData();
  form.append("metadata", JSON.stringify(metadata));
  if (render) form.append("render", render, "render");
  return request<T>(path, { method: "PUT", body: form });
}
export interface OverlaySave { photo_id: string; name: string; description: string | null; drawing: Drawing; presentation: Presentation; position?: number }
export const putOverlay = (id: string, m: OverlaySave, render: Blob | null) => putComposed<{ overlay: Overlay & { drawing: Drawing }; shot: Shot }>(`/api/overlays/${id}`, m, render);
export const patchOverlay = (id: string, m: { name?: string; description?: string | null; position?: number }) => send<{ overlay: Overlay; shot: Shot }>("PATCH", `/api/overlays/${id}`, m);
export const deleteOverlay = (id: string) => send<{ deleted: string; shot: Shot }>("DELETE", `/api/overlays/${id}`);
export interface SketchSave { shot_id: string; name: string; kind: string | null; description: string | null; drawing: Drawing; aspect: number; position?: number }
export const putSketch = (id: string, m: SketchSave, render: Blob | null) => putComposed<{ sketch: Sketch & { drawing: Drawing }; shot: Shot }>(`/api/sketches/${id}`, m, render);
export const patchSketch = (id: string, m: { name?: string; kind?: string | null; description?: string | null; position?: number }) => send<{ sketch: Sketch; shot: Shot }>("PATCH", `/api/sketches/${id}`, m);
export const deleteSketch = (id: string) => send<{ deleted: string; shot: Shot }>("DELETE", `/api/sketches/${id}`);

// ---------- A timeline clip's own overlay and sketch (issue #31) ----------
export interface ClipOwner { timeline_id: string; clip_id: string }
export const putClipOverlay = (id: string, m: OverlaySave & ClipOwner, render: Blob | null) => putComposed<{ overlay: Overlay & { drawing: Drawing }; shot: Shot }>(`/api/overlays/${id}`, m, render);
export const putClipSketch = (id: string, m: Omit<SketchSave, "shot_id"> & ClipOwner, render: Blob | null) => putComposed<{ sketch: Sketch & { drawing: Drawing }; shot: null }>(`/api/sketches/${id}`, m, render);
export const deleteClipSketch = (id: string) => send<{ deleted: string; shot: null }>("DELETE", `/api/sketches/${id}`);
/** Copy an overlay / sketch as another clip's own (a duplicated clip gets its own drawing). */
export const copyOverlay = (from: string, to: string, owner: ClipOwner) => send<{ overlay: Overlay }>("POST", `/api/overlays/${from}/copy`, { id: to, ...owner }).then((r) => r.overlay);
export const copySketch = (from: string, to: string, owner: ClipOwner) => send<{ sketch: Sketch }>("POST", `/api/sketches/${from}/copy`, { id: to, ...owner }).then((r) => r.sketch);

export const fetchLocations = () => get<{ locations: Location[] }>("/api/locations").then((r) => r.locations);
/** Upsert; a 409 carries body.existing_id when another location already has the name. */
export const putLocation = (l: { id: string; project_id: string; name: string; lat?: number | null; lon?: number | null }) =>
  send<{ location: Location }>("PUT", `/api/locations/${l.id}`, l.lat === undefined ? { project_id: l.project_id, name: l.name } : { project_id: l.project_id, name: l.name, lat: l.lat, lon: l.lon }).then((r) => r.location);
export const deleteLocation = (id: string) => send<{ deleted: string }>("DELETE", `/api/locations/${id}`).then(() => undefined);

export const fetchSpots = () => get<{ spots: Spot[] }>("/api/spots").then((r) => r.spots);
/** Upsert; `location_id` only counts on create. A name clash within the location answers 409 + existing_id. */
export const putSpot = (s: { id: string; location_id: string; name: string; lat?: number | null; lon?: number | null }) =>
  send<{ spot: Spot }>("PUT", `/api/spots/${s.id}`, s.lat === undefined ? { location_id: s.location_id, name: s.name } : { location_id: s.location_id, name: s.name, lat: s.lat, lon: s.lon }).then((r) => r.spot);
export const deleteSpot = (id: string) => send<{ deleted: string }>("DELETE", `/api/spots/${id}`).then(() => undefined);

export const fetchViews = () => get<{ views: SavedView[] }>("/api/views").then((r) => r.views);
export const putView = (v: { id: string; project_id: string; name: string; filter: FilterGroup }) => send<{ view: SavedView }>("PUT", `/api/views/${v.id}`, { project_id: v.project_id, name: v.name, filter: v.filter }).then((r) => r.view);
export const deleteView = (id: string) => send<{ deleted: string }>("DELETE", `/api/views/${id}`).then(() => undefined);

/** A viewfinder layout made here for the phone (issue #49). */
export interface LayoutRecord { id: string; name: string; layout: ViewfinderLayout; device_id: string | null; created_at: string; updated_at: string | null }
export const fetchLayouts = () => get<{ layouts: LayoutRecord[] }>("/api/viewfinder-layouts").then((r) => r.layouts);
export const putLayout = (l: { id: string; name: string; layout: ViewfinderLayout; device_id?: string | null }) => send<{ layout: LayoutRecord }>("PUT", `/api/viewfinder-layouts/${l.id}`, { name: l.name, layout: l.layout, device_id: l.device_id }).then((r) => r.layout);
export const deleteLayout = (id: string) => send<{ deleted: string }>("DELETE", `/api/viewfinder-layouts/${id}`).then(() => undefined);

/** Device specs (issue #68): phones read out in Library › Viewfinder; the id is the phone's own. */
export interface DeviceRecord { id: string; name: string; specs: DeviceSpecs; created_at: string; updated_at: string | null }
export const fetchDevices = () => get<{ devices: DeviceRecord[] }>("/api/devices").then((r) => r.devices);
export const putDevice = (d: { id: string; name: string; specs: DeviceSpecs }) => send<{ device: DeviceRecord }>("PUT", `/api/devices/${d.id}`, { name: d.name, specs: d.specs }).then((r) => r.device);
export const deleteDevice = (id: string) => send<{ deleted: string }>("DELETE", `/api/devices/${id}`).then(() => undefined);
