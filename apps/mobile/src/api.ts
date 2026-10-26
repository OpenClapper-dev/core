import { File } from "expo-file-system";
import { getSession, getToken, setSession } from "./auth";
import { API_URL, isConfigured } from "./config";
import { log } from "./log";
import { isOfflineMode, markOnline } from "./net";
import type { DeviceSpecs, Extra, FieldDefinition, Framing, Presentation } from "@openclapper/vocab";
import { stepsOf, type ResolvedStep, type ShotStep } from "@openclapper/vocab";
import type { Fixture } from "./fixtures/types";
import type { LocationEntry, Preset, ProjectEntry, ShotMetadata, ShotTags, SpotEntry, LayoutEntry } from "./types";

export class ApiError extends Error {
  constructor(public status: number, message: string, public body: unknown = null) {
    super(message);
  }
}

/** The session token as a bearer header (every request, images and the preview socket included). */
function headers(extra: Record<string, string> = {}): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}`, ...extra } : { ...extra };
}

/**
 * A web page instead of the API: a Wi-Fi login page, or a login proxy in front of the server. Neither
 * means the session is gone.
 */
function isWebPage(res: Response): boolean {
  return res.redirected || (res.headers.get("content-type") ?? "").includes("text/html") || (!!res.url && !res.url.startsWith(API_URL));
}
const WEB_PAGE = "the server answered with a web page (a Wi-Fi login?)";

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!isConfigured) throw new ApiError(0, "API not configured in this build");
  if (isOfflineMode()) throw new ApiError(0, "offline mode is on");
  if (!getToken()) throw new ApiError(401, "not signed in");
  const started = Date.now();
  const method = init.method ?? "GET";
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, headers: headers(init.headers as Record<string, string>) });
  } catch (err) {
    log("warn", "api network error", { method, path, ms: Date.now() - started, error: err });
    markOnline(false);
    throw err;
  }
  markOnline(true);
  log(res.ok ? "debug" : "warn", "api", { method, path, status: res.status, ms: Date.now() - started });
  if (res.status === 401) {
    setSession(null); // the session is gone; the app shows the sign-in screen, the queue stays
    throw new ApiError(401, "session expired, please sign in again");
  }
  if (isWebPage(res)) throw new ApiError(0, WEB_PAGE);
  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
  if (!res.ok) {
    const msg = (body as { error?: string } | null)?.error ?? `HTTP ${res.status}`;
    throw new ApiError(res.status, msg, body);
  }
  return body as T;
}

/**
 * Sign in with email and password. Not through call(): there is no session yet, and a 401 here is a
 * wrong password, not an expired session.
 */
export async function signIn(email: string, password: string): Promise<void> {
  if (!isConfigured) throw new ApiError(0, "API not configured in this build");
  const res = await fetch(`${API_URL}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ email, password, client: "mobile" }) });
  if (isWebPage(res)) throw new ApiError(0, WEB_PAGE);
  const body = (await res.json().catch(() => null)) as { token?: string; user?: { id: string; email: string }; error?: string } | null;
  if (!res.ok || !body?.token || !body.user) throw new ApiError(res.status, body?.error ?? `HTTP ${res.status}`, body);
  log("info", "signed in", { email: body.user.email });
  setSession({ token: body.token, email: body.user.email, userId: body.user.id });
}

/** Changes the signed-in user's password (issue #148); every other session of the account ends, this one stays. A wrong current password is a 403. */
export const changePassword = (current: string, password: string) =>
  call<null>("/api/auth/password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ current, password }) });

/** Ends the session on the server (best effort: offline, the token just stays unused) and on the phone. */
export async function signOut(): Promise<void> {
  const session = getSession();
  setSession(null);
  if (session && isConfigured) await fetch(`${API_URL}/api/auth/logout`, { method: "POST", headers: { Authorization: `Bearer ${session.token}` } }).catch(() => {});
}

interface ServerPreset {
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
}

function fromServer(s: ServerPreset): Preset {
  return {
    id: s.id,
    name: s.name,
    cameraId: s.camera_id ?? null,
    formatId: s.format_id ?? null,
    sensorWidthMm: s.sensor_width_mm,
    sensorHeightMm: s.sensor_height_mm,
    speedboosterFactor: s.speedbooster_factor,
    lensMinMm: s.lens_min_mm ?? null,
    lensMaxMm: s.lens_max_mm ?? null,
    createdAt: s.created_at,
    synced: true,
  };
}

interface ServerFixture {
  id: string; label: string; kind_id: string; address: string;
  mesh_network_id: string | null; mesh_unicast: number | null; mesh_elements: number | null; created_at: string;
}

function fixtureFromServer(s: ServerFixture): Fixture {
  return {
    id: s.id, label: s.label, kindId: s.kind_id, address: s.address, createdAt: s.created_at, synced: true,
    mesh: s.mesh_network_id && s.mesh_unicast != null ? { networkId: s.mesh_network_id, unicast: s.mesh_unicast, elements: s.mesh_elements ?? 1 } : null,
  };
}

export interface Photo {
  id: string;
  shot_id: string;
  ordinal: number;
  timestamp: string;
  /** Both null when captured without a position. */
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
  /** camera (phone capture), upload or drawn (made in the Studio: no rig, lens_mm 0). Absent on queued shots = camera. */
  source?: "camera" | "upload" | "drawn";
  /** Re-framings made in the Studio (issue #29); absent on queued shots. */
  framings?: Framing[];
  /** The framing every view shows; null/absent = as captured. */
  root_framing_id?: string | null;
  image_url: string;
  created_at: string;
  /** A file on the phone (queued shots, which have no image on the server yet). */
  local_uri?: string;
}

/** The unit of scouting metadata: one photo, or a whole sequence. */
export interface Shot {
  id: string;
  project_id: string;
  project_name: string | null;
  location_id: string | null;
  location_name: string | null;
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
  state: "unreviewed" | "approved" | "archived";
  extra: Extra;
  /** Markdown subset, written in the Studio. */
  description: string | null;
  /** Maps use the location's pin instead of the photos' GPS (set in the Studio; the photos keep theirs). */
  position_from_location: boolean;
  /** The location's pin, null when it has none. */
  location_position: { lat: number; lon: number } | null;
  captured_at: string;
  created_at: string;
  updated_at: string | null;
  /** Ordered; never empty. */
  photos: Photo[];
  /** Drawings over single photos (Studio-made); the phone shows their renders. */
  overlays: Overlay[];
  /** Free canvases on the shot (floor plans, diagrams); the phone shows their renders. */
  sketches: Sketch[];
  /** The stored progression (issue #266), raw rows; absent or empty = the photos are the steps (queued shots never have any). */
  steps?: ShotStep[];
  /** Only on the phone: still in the upload queue (see localShots.ts). */
  queued?: boolean;
}
/** A drawing + look over one photo, as a flattened render the size of the photo (issue #12). */
export interface Overlay { id: string; photo_id: string; shot_id: string; name: string; description: string | null; presentation: Presentation; position: number; render_url: string | null; created_at: string; updated_at: string | null }
/** A sketch of the shot (floor plan, lighting diagram, …), rendered on white. */
export interface Sketch { id: string; shot_id: string; name: string; kind: string | null; description: string | null; aspect: number; position: number; render_url: string | null; created_at: string; updated_at: string | null }
/** Either kind, for strips and the viewer. */
export type Composed = ({ type: "overlay" } & Overlay) | ({ type: "sketch" } & Sketch);

/** A shooting day of a project with its planned shots in order (planned in the Studio). */
export interface DayShot { shot_id: string; planned_time: string | null; notes: string | null }
export interface ShootingDay { id: string; project_id: string; date: string; title: string | null; notes: string | null; updated_at: string | null; shots: DayShot[] }

/** The photo that stands for the shot in lists, maps and filters: the first one. */
export const cover = (s: Shot): Photo => s.photos[0];
/** The steps a shot shows (issue #266): its stored progression, else its photos. Strips, badges and Step-through count these. */
export type Step = ResolvedStep<Photo, Overlay>;
export const steps = (s: Shot): Step[] => stepsOf({ photos: s.photos, overlays: s.overlays ?? [], steps: s.steps });
export const seqCount = (s: Shot): number => steps(s).length;
/**
 * Where a shot is on a map: the location's pin when the shot is synced to it (and the pin is set),
 * else the cover photo, else the first photo with a position; null when none has one.
 */
export function positionOf(s: Shot): { lat: number; lon: number } | null {
  if (s.position_from_location && s.location_position) return s.location_position;
  const p = [cover(s), ...s.photos].find((x) => x.lat !== null && x.lon !== null);
  return p ? { lat: p.lat!, lon: p.lon! } : null;
}

/** Locations and projects share this shape as far as the app is concerned. */
interface ServerNamed { id: string; name: string; created_at: string; field_ids?: string[]; project_id?: string }
const namedFromServer = (l: ServerNamed) => ({ id: l.id, name: l.name, createdAt: l.created_at, synced: true });

type Cursor = { before: string; before_id: string } | null;
interface ShotsPage { shots: Shot[]; next: Cursor }

/** Headers for <Image> requests to the API (the session token). */
export const imageHeaders = (): Record<string, string> => headers();
export const imageUri = (photo: Photo) => `${API_URL}${photo.image_url}`;
/** Absolute URL of an overlay or sketch render; null before the Studio saved one. */
export const renderUri = (item: { render_url: string | null }) => (item.render_url ? `${API_URL}${item.render_url}` : null);

export const api = {
  /** Every shot of one project, newest first. */
  listShots: async (projectId: string): Promise<Shot[]> => {
    const all: Shot[] = [];
    let cursor: Cursor = null;
    for (;;) {
      const q: string = `?limit=500&project_id=${projectId}${cursor ? `&before=${encodeURIComponent(cursor.before)}&before_id=${cursor.before_id}` : ""}`;
      const page: ShotsPage = await call<ShotsPage>(`/api/shots${q}`);
      all.push(...page.shots);
      if (!page.next) break;
      cursor = page.next;
    }
    return all;
  },
  /** Correct a photo's position by hand; allInShot moves every photo of its shot. */
  patchPhotoPosition: (id: string, lat: number, lon: number, allInShot: boolean) =>
    call<{ shot: Shot }>(`/api/photos/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ lat, lon, all_in_shot: allInShot }) }).then((r) => r.shot),
  deleteShot: (id: string) => call<{ deleted: string }>(`/api/shots/${id}`, { method: "DELETE" }),
  patchShot: (id: string, patch: Partial<ShotTags> & { state?: Shot["state"]; project_id?: string }) =>
    call<{ shot: Shot }>(`/api/shots/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) }).then((r) => r.shot),

  listLocations: async (): Promise<LocationEntry[]> => {
    const r = await call<{ locations: ServerNamed[] }>("/api/locations");
    return r.locations.map((l): LocationEntry => ({ ...namedFromServer(l), projectId: l.project_id ?? "" }));
  },
  /** Upsert; a 409 means another location of the project already has this name (ApiError.body.existing_id). */
  putLocation: (l: LocationEntry) =>
    call<{ location: ServerNamed }>(`/api/locations/${l.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ project_id: l.projectId, name: l.name }),
    }),

  listSpots: async (): Promise<SpotEntry[]> => {
    const r = await call<{ spots: { id: string; location_id: string; name: string; created_at: string }[] }>("/api/spots");
    return r.spots.map((x) => ({ id: x.id, locationId: x.location_id, name: x.name, createdAt: x.created_at, synced: true }));
  },
  /** Upsert; a 409 means the location already has a spot with this name (ApiError.body.existing_id). */
  putSpot: (x: SpotEntry) =>
    call<{ spot: unknown }>(`/api/spots/${x.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ location_id: x.locationId, name: x.name }),
    }),

  /** Viewfinder layouts (issue #49), made in the Studio; since #68 the phone also edits their look and options. */
  listLayouts: () => call<{ layouts: LayoutEntry[] }>("/api/viewfinder-layouts").then((r) => r.layouts.map((l) => ({ id: l.id, name: l.name, layout: l.layout }))),

  /** Device specs (issue #68): the phone keeps its own record current once the Studio saved it. */
  listDevices: () => call<{ devices: { id: string; name: string; specs: DeviceSpecs }[] }>("/api/devices").then((r) => r.devices),
  putDeviceSpecs: (id: string, specs: DeviceSpecs) => call<unknown>(`/api/devices/${id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ specs }) }),

  putLayout: (id: string, l: { name: string; layout: unknown }) => call<unknown>(`/api/viewfinder-layouts/${id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(l) }),

  listDays: (projectId: string) => call<{ days: ShootingDay[] }>(`/api/days?project_id=${projectId}`).then((r) => r.days),
  listFields: () => call<{ fields: FieldDefinition[] }>("/api/fields").then((r) => r.fields),

  listProjects: async (): Promise<ProjectEntry[]> => {
    const r = await call<{ projects: ServerNamed[] }>("/api/projects");
    return r.projects.map((p): ProjectEntry => ({ ...namedFromServer(p), fieldIds: p.field_ids ?? [] }));
  },
  /** Upsert; a 409 means another project already has this name (ApiError.body.existing_id). */
  putProject: (p: ProjectEntry) =>
    call<{ project: ServerNamed }>(`/api/projects/${p.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: p.name }),
    }),
  deleteLocation: (id: string) => call<{ deleted: string }>(`/api/locations/${id}`, { method: "DELETE" }),

  health: () => call<{ ok: boolean; identity: string }>("/health"),

  listPresets: async (): Promise<Preset[]> => {
    const r = await call<{ presets: ServerPreset[] }>("/api/presets");
    return r.presets.map(fromServer);
  },

  putPreset: (p: Preset) =>
    call<{ preset: ServerPreset }>(`/api/presets/${p.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: p.name,
        camera_id: p.cameraId,
        format_id: p.formatId,
        sensor_width_mm: p.sensorWidthMm,
        sensor_height_mm: p.sensorHeightMm,
        speedbooster_factor: p.speedboosterFactor,
        lens_min_mm: p.lensMinMm,
        lens_max_mm: p.lensMaxMm,
      }),
    }),

  /** Lights (#208): fixtures of every workspace the user is in; a new one goes to the user's own. */
  listFixtures: () => call<{ fixtures: ServerFixture[] }>("/api/fixtures").then((r) => r.fixtures.map(fixtureFromServer)),
  putFixture: (f: Fixture) =>
    call<{ fixture: ServerFixture }>(`/api/fixtures/${f.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        label: f.label, kind_id: f.kindId, address: f.address,
        mesh_network_id: f.mesh?.networkId ?? null, mesh_unicast: f.mesh?.unicast ?? null, mesh_elements: f.mesh?.elements ?? null,
      }),
    }),
  deleteFixture: (id: string) => call<{ deleted: string }>(`/api/fixtures/${id}`, { method: "DELETE" }),

  deletePreset: (id: string) => call<{ deleted: string }>(`/api/presets/${id}`, { method: "DELETE" }),

  /**
   * Multipart upload of a shot and its photos. `files` maps photo id -> local file:// URI of a JPEG.
   * Idempotent on the server: photos already stored are skipped, so a retry is always safe.
   */
  uploadShot: (metadata: ShotMetadata, files: Record<string, string>) => {
    const form = new FormData();
    form.append("metadata", JSON.stringify(metadata));
    // Expo's global fetch is the WinterCG implementation: it rejects React Native's
    // {uri,name,type} descriptors but accepts an expo-file-system File directly.
    for (const p of metadata.photos) form.append(`photo.${p.id}`, new File(files[p.id]) as unknown as Blob, `${p.id}.jpg`);
    return call<{ shot: Shot; duplicate?: boolean }>("/api/shots", { method: "POST", body: form });
  },
};
