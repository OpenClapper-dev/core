import { CAMERA_SUPPORTS, INT_EXT, isOneOf, LIGHT, PHOTO_SOURCES, MAX_DESCRIPTION, MOVEMENTS, fitExtra, patchExtra, pruneExtra, SHOT_SIZES, SHOT_STATES, validateExtra, validateValues, WEATHER, type Extra, type FieldDef } from "@openclapper/vocab";
import { clipLayersLeaving, composeFor, deleteClipCompose, type SketchApi } from "./compose.ts";
import { bakesFor, layersFor } from "./layers.ts";
import { framingsFor, type FramingApi } from "./framings.ts";
import { stepsFor } from "./steps.ts";
import { projectFieldDefs } from "./fields.ts";
import { locationInProject } from "./locations.ts";
import { spotUnder } from "./spots.ts";
import { assertEnum, assertIsoTimestamp, assertNumber, assertString, assertUuid, HttpError, json, readJson, type Router } from "@openclapper/service-kit";
import { fileRefCleanup } from "./files.ts";
import { binResource } from "./trash.ts";
import { assertBodySize, imageExt, imageTypeOf, preconditionFailed, type ImageType } from "./images.ts";
import type { Ctx } from "./index.ts";
import { assertAccess, assertProjectRef, assertRank, inWorkspaces } from "./tenancy.ts";

interface ShotRow {
  id: string;
  project_id: string;
  location_id: string | null;
  spot_id: string | null;
  name: string | null;
  int_ext: string | null;
  light: string;
  artificial: number;
  weather: string | null;
  shot_size: string | null;
  camera_support: string | null;
  movement: string;
  state: string;
  extra: string;
  description: string | null;
  position_from_location: number;
  captured_at: string;
  created_at: string;
  updated_at: string | null;
  project_name: string | null;
  location_name: string | null;
  location_lat: number | null;
  location_lon: number | null;
  spot_name: string | null;
  spot_lat: number | null;
  spot_lon: number | null;
}

interface PhotoRow {
  id: string;
  shot_id: string;
  ordinal: number;
  timestamp: string;
  lat: number | null;
  lon: number | null;
  gps_accuracy_m: number | null;
  position_corrected: number;
  preset_id: string | null;
  preset_name: string | null;
  lens_mm: number;
  r2_object_key: string;
  width: number | null;
  height: number | null;
  framing: string | null;
  device: string | null;
  source: string;
  root_framing_id: string | null;
  created_at: string;
}

const MAX_IMAGE_BYTES = 3 * 1024 * 1024; // "low-res reference" — generous ceiling
const MAX_PHOTOS_PER_UPLOAD = 60;
/** A shot (a sequence) holds at most this many photos across all its uploads (#224). */
export const MAX_PHOTOS_PER_SHOT = 200;
/** The largest upload body: every image at the ceiling plus room for the metadata (checked before parsing, #224). */
const MAX_UPLOAD_BYTES = MAX_PHOTOS_PER_UPLOAD * MAX_IMAGE_BYTES + 1024 * 1024;
const MAX_JSON_BYTES = 16 * 1024;
const MAX_BULK = 500;

/** The R2 key of a photo; `type` is the image type, or an extension when copying an existing object. */
export const objectKey = (photoId: string, type: ImageType | string) => `photos/${photoId}.${type.includes("/") ? imageExt(type as ImageType) : type}`;

const parseJson = <T>(s: string | null): T | null => (s ? (JSON.parse(s) as T) : null);

function photoToApi(p: PhotoRow, framings: Map<string, FramingApi[]>) {
  return {
    id: p.id,
    shot_id: p.shot_id,
    ordinal: p.ordinal,
    timestamp: p.timestamp,
    lat: p.lat,
    lon: p.lon,
    gps_accuracy_m: p.gps_accuracy_m,
    position_corrected: p.position_corrected === 1,
    preset_id: p.preset_id,
    preset_name: p.preset_name ?? null,
    lens_mm: p.lens_mm,
    width: p.width,
    height: p.height,
    framing: parseJson<Record<string, unknown>>(p.framing),
    device: parseJson<Record<string, unknown>>(p.device),
    source: p.source ?? "camera",
    /** Saved re-framings (issue #29) and the one every view shows; null = as captured. */
    framings: framings.get(p.id) ?? [],
    root_framing_id: p.root_framing_id ?? null,
    image_url: `/api/photos/${p.id}/image`,
    created_at: p.created_at,
  };
}

type Compose = Awaited<ReturnType<typeof composeFor>> & {
  framings: Map<string, FramingApi[]>; steps: Awaited<ReturnType<typeof stepsFor>>; layers: Awaited<ReturnType<typeof layersFor>>; bakes: Awaited<ReturnType<typeof bakesFor>>;
};
/** Sketches, framings, steps, layers and bakes of these shots in one go. */
async function extrasFor(env: Ctx["env"], ids: string[]): Promise<Compose> {
  const [c, framings, steps, layers, bakes] = await Promise.all([composeFor(env, ids), framingsFor(env, ids), stepsFor(env, ids), layersFor(env, ids), bakesFor(env, ids)]);
  return { ...c, framings, steps, layers, bakes };
}

function shotToApi(s: ShotRow, photos: PhotoRow[], compose: Compose) {
  return {
    id: s.id,
    project_id: s.project_id,
    project_name: s.project_name ?? null,
    // A location in the recycle bin reads as none (the shot keeps it, so a restore brings it back).
    location_id: s.location_name === null ? null : s.location_id,
    location_name: s.location_name ?? null,
    spot_id: s.spot_name === null ? null : s.spot_id ?? null,
    spot_name: s.spot_name ?? null,
    name: s.name,
    int_ext: s.int_ext,
    light: JSON.parse(s.light) as string[],
    artificial: s.artificial === 1,
    weather: s.weather,
    shot_size: s.shot_size,
    camera_support: s.camera_support,
    movement: JSON.parse(s.movement) as string[],
    state: s.state,
    extra: JSON.parse(s.extra) as Extra,
    description: s.description,
    position_from_location: s.position_from_location === 1,
    /** The place's pin: the spot's, else the location's (null when neither has one); clients use it when position_from_location is on. */
    location_position: s.spot_lat != null && s.spot_lon != null ? { lat: s.spot_lat, lon: s.spot_lon }
      : s.location_lat != null && s.location_lon != null ? { lat: s.location_lat, lon: s.location_lon } : null,
    captured_at: s.captured_at,
    created_at: s.created_at,
    updated_at: s.updated_at,
    photos: photos.map((p) => photoToApi(p, compose.framings)),
    sketches: (compose.sketches.get(s.id) ?? []) as SketchApi[],
    /** Stored steps (issue #266), raw: clients resolve them with `stepsOf`; empty = the photos are the steps. */
    steps: compose.steps.get(s.id) ?? [],
    /** The composition (epic #275): the shot's own layers in stack order (without shapes) and the stored bakes per step. */
    layers: compose.layers.get(s.id) ?? [],
    bakes: compose.bakes.get(s.id) ?? [],
  };
}

const SHOT_SQL = `SELECT s.*, pr.name AS project_name, l.name AS location_name, l.lat AS location_lat, l.lon AS location_lon,
    sp.name AS spot_name, sp.lat AS spot_lat, sp.lon AS spot_lon
  FROM shots s JOIN projects pr ON pr.id = s.project_id LEFT JOIN locations l ON l.id = s.location_id AND l.deleted_at IS NULL LEFT JOIN spots sp ON sp.id = s.spot_id AND l.id IS NOT NULL`;

/** Photos for many shots in one query (json_each keeps it to one bound parameter; D1 caps those at 100). */
async function photosFor(env: Ctx["env"], shotIds: string[]): Promise<Map<string, PhotoRow[]>> {
  const out = new Map<string, PhotoRow[]>();
  if (shotIds.length === 0) return out;
  const { results } = await env.DB.prepare(
    `SELECT ph.*, p.name AS preset_name FROM photos ph LEFT JOIN presets p ON p.id = ph.preset_id
     WHERE ph.shot_id IN (SELECT value FROM json_each(?1)) ORDER BY ph.shot_id, ph.ordinal`,
  ).bind(JSON.stringify(shotIds)).all<PhotoRow>();
  for (const p of results) out.set(p.shot_id, [...(out.get(p.shot_id) ?? []), p]);
  return out;
}

export async function loadShot(env: Ctx["env"], id: string) {
  const row = await env.DB.prepare(`${SHOT_SQL} WHERE s.id = ?1`).bind(id).first<ShotRow>();
  if (!row) return null;
  return shotToApi(row, (await photosFor(env, [id])).get(id) ?? [], await extrasFor(env, [id]));
}

/**
 * Scouting tags. All optional: a missing or empty field is stored as NULL (or [] / {} / false) so
 * shots can be uploaded untagged and completed later (PATCH). `all` = every key present (upload);
 * otherwise only the keys given are returned (patch), where null/"" clears a field.
 */
interface Tags {
  name: string | null; light: string; artificial: number; weather: string | null; int_ext: string | null; location_id: string | null; spot_id: string | null; extra: string;
  shot_size: string | null; camera_support: string | null; movement: string; description: string | null; position_from_location: number;
}

function parseTags(m: Record<string, unknown>, all: true): Tags;
function parseTags(m: Record<string, unknown>, all: false): Partial<Tags>;
function parseTags(m: Record<string, unknown>, all: boolean): Partial<Tags> {
  const out: Partial<Tags> = {};
  const want = (k: keyof Tags) => all || m[k] !== undefined;
  const blank = (v: unknown) => v === undefined || v === null || v === "";
  if (want("name")) out.name = blank(m.name) ? null : assertString(m.name, "name", 120);
  if (want("light")) {
    const v = blank(m.light) ? [] : m.light;
    if (!Array.isArray(v)) throw new HttpError(400, "light must be an array");
    for (const x of v) assertEnum(x, "light", LIGHT);
    out.light = JSON.stringify(LIGHT.filter((l) => v.includes(l))); // dedupe, canonical order
  }
  if (want("artificial")) {
    if (!blank(m.artificial) && typeof m.artificial !== "boolean") throw new HttpError(400, "artificial must be a boolean");
    out.artificial = m.artificial === true ? 1 : 0;
  }
  if (want("weather")) out.weather = blank(m.weather) ? null : assertEnum(m.weather, "weather", WEATHER);
  if (want("int_ext")) out.int_ext = blank(m.int_ext) ? null : assertEnum(m.int_ext, "int_ext", INT_EXT);
  if (want("shot_size")) out.shot_size = blank(m.shot_size) ? null : assertEnum(m.shot_size, "shot_size", SHOT_SIZES);
  if (want("camera_support")) out.camera_support = blank(m.camera_support) ? null : assertEnum(m.camera_support, "camera_support", CAMERA_SUPPORTS);
  if (want("movement")) {
    const v = blank(m.movement) ? [] : m.movement;
    if (!Array.isArray(v)) throw new HttpError(400, "movement must be an array");
    for (const x of v) assertEnum(x, "movement", MOVEMENTS);
    out.movement = JSON.stringify(MOVEMENTS.filter((x) => v.includes(x)));
  }
  if (want("position_from_location")) {
    if (!blank(m.position_from_location) && typeof m.position_from_location !== "boolean") throw new HttpError(400, "position_from_location must be a boolean");
    out.position_from_location = m.position_from_location === true ? 1 : 0;
  }
  if (want("description")) {
    if (!blank(m.description) && typeof m.description !== "string") throw new HttpError(400, "description must be a string");
    if (typeof m.description === "string" && m.description.length > MAX_DESCRIPTION) throw new HttpError(400, `description too long (max ${MAX_DESCRIPTION})`);
    out.description = blank(m.description) ? null : (m.description as string);
  }
  if (want("location_id")) out.location_id = blank(m.location_id) ? null : assertUuid(m.location_id, "location_id");
  if (want("spot_id")) out.spot_id = blank(m.spot_id) ? null : assertUuid(m.spot_id, "spot_id");
  if (want("extra")) {
    const extra = blank(m.extra) ? {} : m.extra;
    const err = validateExtra(extra);
    if (err) throw new HttpError(400, err);
    out.extra = JSON.stringify(pruneExtra(extra as Extra));
  }
  return out;
}

function optionalJson(v: unknown, field: string): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "object" || Array.isArray(v)) throw new HttpError(400, `${field} must be an object`);
  const s = JSON.stringify(v);
  if (s.length > MAX_JSON_BYTES) throw new HttpError(413, `${field} too large`);
  return s;
}

interface PhotoInput {
  id: string; ordinal: number; timestamp: string; lat: number | null; lon: number | null; gps_accuracy_m: number | null; position_corrected: number;
  preset_id: string | null; lens_mm: number; width: number | null; height: number | null; framing: string | null; device: string | null; source: string;
}

function parsePhoto(v: unknown, i: number): PhotoInput {
  if (typeof v !== "object" || v === null) throw new HttpError(400, `photos[${i}] must be an object`);
  const p = v as Record<string, unknown>;
  const optNum = (x: unknown, f: string, o: { min: number; max: number }) => (x === undefined || x === null ? null : assertNumber(x, f, o));
  // Captured without GPS: no position at all (half a position is dropped too).
  const lat = optNum(p.lat, `photos[${i}].lat`, { min: -90, max: 90 });
  const lon = optNum(p.lon, `photos[${i}].lon`, { min: -180, max: 180 });
  const located = lat !== null && lon !== null;
  // Uploaded and drawn images have no lens: lens_mm is optional for them and stored as 0.
  const source = isOneOf(PHOTO_SOURCES, p.source) ? p.source : "camera";
  return {
    source,
    id: assertUuid(p.id, `photos[${i}].id`),
    ordinal: assertNumber(p.ordinal, `photos[${i}].ordinal`, { min: 0, max: 10_000 }),
    timestamp: assertIsoTimestamp(p.timestamp, `photos[${i}].timestamp`),
    lat: located ? lat : null,
    lon: located ? lon : null,
    gps_accuracy_m: located ? optNum(p.gps_accuracy_m, `photos[${i}].gps_accuracy_m`, { min: 0, max: 100_000 }) : null,
    // Set on the phone before the upload (a queued shot corrected by hand).
    position_corrected: located && p.position_corrected === true ? 1 : 0,
    preset_id: p.preset_id == null ? null : assertUuid(p.preset_id, `photos[${i}].preset_id`),
    lens_mm: source === "camera" ? assertNumber(p.lens_mm, `photos[${i}].lens_mm`, { min: 1, max: 2000 }) : 0,
    width: optNum(p.width, `photos[${i}].width`, { min: 1, max: 20_000 }),
    height: optNum(p.height, `photos[${i}].height`, { min: 1, max: 20_000 }),
    framing: optionalJson(p.framing, `photos[${i}].framing`),
    device: optionalJson(p.device, `photos[${i}].device`),
  };
}

/**
 * Projects of another workspace are out of reach for a move: rigs, extra fields and the recycle bin
 * all assume a shot stays in its workspace.
 */
const CROSS_WORKSPACE = "a shot cannot move to a project of another workspace";

/** Interactive edits may only pick a location of the shot's (new) project. */
async function assertLocationOf(env: Ctx["env"], id: string, projectId: string) {
  if ((await locationInProject(env, id, projectId, false)) !== id) throw new HttpError(400, "location_id is not a location of the shot's project");
}

export function registerShotRoutes(r: Router<Ctx>) {
  // Newest first, keyset-paginated on (captured_at, id). Pass ?before=<captured_at>&before_id=<id>.
  // Optional filters: ?project_id=<uuid>&state=approved&location_id=<uuid>
  r.on("GET", "/api/shots", async ({ env, url, tenant }) => {
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 100) || 100, 1), 500);
    const before = url.searchParams.get("before");
    const beforeId = url.searchParams.get("before_id") ?? "";
    const args: unknown[] = [tenant.wsList];
    const where: string[] = ["s.deleted_at IS NULL", inWorkspaces("pr.workspace_id", 1)];
    if (before) { args.push(before, beforeId); where.push(`(s.captured_at < ?${args.length - 1} OR (s.captured_at = ?${args.length - 1} AND s.id < ?${args.length}))`); }
    const project = url.searchParams.get("project_id");
    if (project) { args.push(assertUuid(project, "project_id")); where.push(`s.project_id = ?${args.length}`); }
    const state = url.searchParams.get("state");
    if (state) { args.push(assertEnum(state, "state", SHOT_STATES)); where.push(`s.state = ?${args.length}`); }
    const loc = url.searchParams.get("location_id");
    if (loc) { args.push(assertUuid(loc, "location_id")); where.push(`s.location_id = ?${args.length}`); }
    args.push(limit);
    const { results } = await env.DB.prepare(`${SHOT_SQL} WHERE ${where.join(" AND ")} ORDER BY s.captured_at DESC, s.id DESC LIMIT ?${args.length}`).bind(...args).all<ShotRow>();
    const ids = results.map((s) => s.id);
    const [photos, compose] = await Promise.all([photosFor(env, ids), extrasFor(env, ids)]);
    const last = results.at(-1);
    return json({
      shots: results.map((s) => shotToApi(s, photos.get(s.id) ?? [], compose)),
      next: results.length === limit && last ? { before: last.captured_at, before_id: last.id } : null,
    });
  });

  r.on("GET", "/api/shots/:id", async (ctx, { id }) => {
    const { env } = ctx;
    const sid = assertUuid(id, "id");
    await assertAccess(ctx, "shot", sid, "viewer");
    const binned = await env.DB.prepare("SELECT deleted_at FROM shots WHERE id = ?1").bind(sid).first<{ deleted_at: string | null }>();
    const shot = binned && !binned.deleted_at ? await loadShot(env, sid) : null;
    if (!shot) throw new HttpError(404, "shot not found");
    return json({ shot });
  });

  // Same-origin image delivery so the Studio can use plain <img> tags with its session cookie.
  r.on("GET", "/api/photos/:id/image", async (ctx, { id }) => {
    const { env, request } = ctx;
    const pid = assertUuid(id, "id");
    await assertAccess(ctx, "photo", pid, "viewer");
    const row = await env.DB.prepare("SELECT r2_object_key FROM photos WHERE id = ?1").bind(pid).first<{ r2_object_key: string }>();
    if (!row) throw new HttpError(404, "photo not found");
    const obj = await env.SHOTS_BUCKET.get(row.r2_object_key, { onlyIf: request.headers });
    if (!obj) throw new HttpError(404, "image missing in storage");
    if (!("body" in obj) && preconditionFailed(request, obj)) throw new HttpError(412, "precondition failed");
    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    headers.set("etag", obj.httpEtag);
    headers.set("cache-control", "private, max-age=31536000, immutable");
    headers.set("x-content-type-options", "nosniff");
    if (!("body" in obj) || !obj.body) return new Response(null, { status: 304, headers });
    return new Response(obj.body, { headers });
  });

  /**
   * multipart/form-data:
   *   metadata        JSON string:
   *     { id, project_id, name?, location_id?, int_ext?, light?: string[], artificial?: boolean, weather?,
   *       shot_size?, camera_support?, movement?: string[], extra?, state? (decided on the phone before upload),
   *       photos: [{ id, ordinal, timestamp, lat?, lon? (both or neither), gps_accuracy_m?, position_corrected?,
   *                  preset_id?, lens_mm, width?, height?, framing?, device? }] }
   *   photo.<photoId> one image file (jpeg/webp/png, <= 3 MB) per photo that is not stored yet
   * Creates the shot (state "unreviewed") with its photos. Idempotent: for an existing shot the
   * tags are left alone (they may have been edited since) and only photos not stored yet are added,
   * so a retried or continued upload (a sequence sent in parts) never duplicates anything.
   */
  r.on("POST", "/api/shots", async (ctx) => {
    const { env, request } = ctx;
    const ct = request.headers.get("content-type") ?? "";
    if (!ct.startsWith("multipart/form-data")) throw new HttpError(415, "expected multipart/form-data");
    assertBodySize(request, MAX_UPLOAD_BYTES);
    const form = await request.formData();
    const metaRaw = form.get("metadata");
    if (typeof metaRaw !== "string") throw new HttpError(400, "metadata field missing");
    let m: Record<string, unknown>;
    try { m = JSON.parse(metaRaw) as Record<string, unknown>; } catch { throw new HttpError(400, "metadata is not JSON"); }

    const id = assertUuid(m.id, "id");
    if (!Array.isArray(m.photos) || m.photos.length === 0) throw new HttpError(400, "photos must be a non-empty array");
    if (m.photos.length > MAX_PHOTOS_PER_UPLOAD) throw new HttpError(413, `at most ${MAX_PHOTOS_PER_UPLOAD} photos per upload`);
    const photos = m.photos.map(parsePhoto);

    const existing = await env.DB.prepare("SELECT id, deleted_at FROM shots WHERE id = ?1").bind(id).first<{ id: string; deleted_at: string | null }>();
    let ws = existing ? await assertAccess(ctx, "shot", id, "editor") : null;
    let insertShot: D1PreparedStatement | null = null;
    // A capture continued or retried for a shot that was binned meanwhile brings it back: never lose a capture.
    if (existing?.deleted_at) insertShot = env.DB.prepare("UPDATE shots SET deleted_at = NULL, deleted_with = NULL WHERE id = ?1").bind(id);
    if (!existing) {
      const projectId = assertUuid(m.project_id, "project_id");
      // A capture must never be rejected for metadata the phone could not know was stale or too long:
      // overlong names are cut, a location deleted meanwhile is dropped (the photos keep their GPS), and one
      // of another project (a stale phone) becomes the shot's project's location of that name.
      if (typeof m.name === "string" && m.name.length > 120) m.name = m.name.slice(0, 120);
      const tags = parseTags(m, true);
      ws = await assertProjectRef(ctx, projectId);
      if (tags.location_id) tags.location_id = await locationInProject(env, tags.location_id, projectId, true);
      if (tags.spot_id) tags.spot_id = await spotUnder(env, tags.spot_id, tags.location_id, true);
      const capturedAt = photos.map((p) => p.timestamp).sort()[0];
      // A shot reviewed on the phone before it went out keeps that decision; anything else starts unreviewed.
      const state = isOneOf(SHOT_STATES, m.state) ? m.state : "unreviewed";
      insertShot = env.DB.prepare(
        `INSERT INTO shots (id, project_id, location_id, name, int_ext, light, artificial, weather, shot_size, camera_support, movement, state, extra, captured_at, spot_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)`,
      ).bind(id, projectId, tags.location_id, tags.name, tags.int_ext, tags.light, tags.artificial, tags.weather, tags.shot_size, tags.camera_support, tags.movement, state, tags.extra, capturedAt, tags.spot_id);
    }

    // Stored = already in this shot; an id taken by another shot is a conflict, not a duplicate.
    const stored = new Set(
      (await env.DB.prepare("SELECT id FROM photos WHERE shot_id = ?2 AND id IN (SELECT value FROM json_each(?1))").bind(JSON.stringify(photos.map((p) => p.id)), id).all<{ id: string }>())
        .results.map((x) => x.id),
    );
    const fresh = photos.filter((p) => !stored.has(p.id));
    if (fresh.length) {
      const held = (await env.DB.prepare("SELECT count(*) AS n FROM photos WHERE shot_id = ?1").bind(id).first<{ n: number }>())?.n ?? 0;
      if (held + fresh.length > MAX_PHOTOS_PER_SHOT) throw new HttpError(413, `a shot holds at most ${MAX_PHOTOS_PER_SHOT} photos (it has ${held}, this upload adds ${fresh.length})`);
    }
    // The R2 key comes from the photo id and R2 is written before D1, so a taken id must be refused
    // before anything is stored, or it would overwrite another shot's image.
    if (fresh.length && await env.DB.prepare("SELECT 1 FROM photos WHERE id IN (SELECT value FROM json_each(?1))").bind(JSON.stringify(fresh.map((p) => p.id))).first()) {
      throw new HttpError(409, "a photo id is already used by another shot");
    }
    // A rig deleted (or never synced, or of another workspace) becomes NULL; the framing snapshot on the photo keeps it.
    const presetIds = [...new Set(fresh.map((p) => p.preset_id).filter((x): x is string => !!x))];
    if (presetIds.length) {
      const known = new Set((await env.DB.prepare("SELECT id FROM presets WHERE workspace_id = ?2 AND id IN (SELECT value FROM json_each(?1))").bind(JSON.stringify(presetIds), ws).all<{ id: string }>()).results.map((x) => x.id));
      for (const p of fresh) if (p.preset_id && !known.has(p.preset_id)) p.preset_id = null;
    }
    // The stored type comes from the file's own bytes (JPEG, PNG, WebP), never from what the client says.
    const files = await Promise.all(fresh.map(async (p) => {
      const f = form.get(`photo.${p.id}`);
      if (!(f instanceof File)) throw new HttpError(400, `image file missing for photo ${p.id}`);
      if (f.size === 0 || f.size > MAX_IMAGE_BYTES) throw new HttpError(413, "image empty or too large");
      const type = await imageTypeOf(f, `photo ${p.id}`);
      return { photo: p, file: f, type, key: objectKey(p.id, type), size: f.size };
    }));

    const written: string[] = [];
    try {
      for (const { photo, file, type, key } of files) {
        await env.SHOTS_BUCKET.put(key, file.stream(), { httpMetadata: { contentType: type }, customMetadata: { shot_id: id, photo_id: photo.id, workspace_id: ws! } });
        written.push(key);
      }
      // One batch = one transaction: the shot row and its photo rows land together or not at all.
      const stmts = files.map(({ photo: p, key, size }) => env.DB.prepare(
        `INSERT INTO photos (id, shot_id, ordinal, timestamp, lat, lon, gps_accuracy_m, position_corrected, preset_id, lens_mm, r2_object_key, width, height, framing, device, source, size_bytes)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)`,
      ).bind(p.id, id, p.ordinal, p.timestamp, p.lat, p.lon, p.gps_accuracy_m, p.position_corrected, p.preset_id, p.lens_mm, key, p.width, p.height, p.framing, p.device, p.source, size));
      if (insertShot) stmts.unshift(insertShot);
      // A continued sequence may start earlier than what is stored (upload order is not capture order).
      stmts.push(env.DB.prepare("UPDATE shots SET captured_at = (SELECT min(timestamp) FROM photos WHERE shot_id = ?1) WHERE id = ?1").bind(id));
      await env.DB.batch(stmts);
    } catch (err) {
      // Keep objects a concurrent upload of the same photos has committed meanwhile.
      const committed = new Set((await env.DB.prepare("SELECT r2_object_key AS k FROM photos WHERE r2_object_key IN (SELECT value FROM json_each(?1))").bind(JSON.stringify(written)).all<{ k: string }>().catch(() => ({ results: written.map((k) => ({ k })) }))).results.map((x) => x.k));
      await Promise.all(written.filter((k) => !committed.has(k)).map((k) => env.SHOTS_BUCKET.delete(k).catch(() => {})));
      if (err instanceof HttpError) throw err;
      if (String(err).includes("UNIQUE constraint failed: photos.shot_id, photos.ordinal")) throw new HttpError(409, "a different photo already has this ordinal in the shot");
      throw err;
    }

    return json({ shot: await loadShot(env, id), duplicate: !!existing && fresh.length === 0 }, existing ? 200 : 201);
  });

  /** Edit tags, review state and/or project. JSON body with any of the tag fields, state, project_id. */
  r.on("PATCH", "/api/shots/:id", async (ctx, { id }) => {
    const { env, request } = ctx;
    const sid = assertUuid(id, "id");
    const ws = await assertAccess(ctx, "shot", sid, "editor");
    const b = await readJson<Record<string, unknown>>(request);
    const tags = parseTags(b, false);
    const sets: string[] = [];
    const args: unknown[] = [];
    for (const [k, v] of Object.entries(tags)) { args.push(v); sets.push(`${k} = ?${args.length}`); }
    if (b.state !== undefined) { args.push(assertEnum(b.state, "state", SHOT_STATES)); sets.push(`state = ?${args.length}`); }
    let movedTo: string | null = null;
    if (b.project_id !== undefined) {
      movedTo = assertUuid(b.project_id, "project_id");
      if ((await assertProjectRef(ctx, movedTo)) !== ws) throw new HttpError(400, CROSS_WORKSPACE);
      args.push(movedTo); sets.push(`project_id = ?${args.length}`);
    }
    if (sets.length === 0) throw new HttpError(400, "nothing to update");
    // An edit (say, from a phone that was offline) to a binned shot brings it back rather than getting lost.
    sets.push("deleted_at = NULL", "deleted_with = NULL");
    const cur = await env.DB.prepare("SELECT project_id, location_id, spot_id, extra FROM shots WHERE id = ?1").bind(sid).first<{ project_id: string; location_id: string | null; spot_id: string | null; extra: string }>();
    if (!cur) throw new HttpError(404, "shot not found");
    const projectId = movedTo ?? cur.project_id;
    if (movedTo === cur.project_id) movedTo = null;
    // Interactive edits are checked against the project's field definitions. Uploads are not:
    // a phone with stale definitions must never have a capture rejected.
    if (tags.extra !== undefined) {
      const err = validateValues(await projectFieldDefs(env, projectId), JSON.parse(tags.extra) as Extra);
      if (err) throw new HttpError(400, err);
    } else if (movedTo) {
      // Moving takes along only the values the new project's fields accept (the Studio warns first).
      args.push(JSON.stringify(fitExtra(await projectFieldDefs(env, movedTo), JSON.parse(cur.extra) as Extra))); sets.push(`extra = ?${args.length}`);
    }
    let location = tags.location_id !== undefined ? tags.location_id : cur.location_id;
    if (tags.location_id) await assertLocationOf(env, tags.location_id, projectId);
    else if (tags.location_id === undefined && movedTo && cur.location_id) {
      // The location follows by name: the new project's location of that name, created when missing.
      location = await locationInProject(env, cur.location_id, movedTo, true);
      args.push(location); sets.push(`location_id = ?${args.length}`);
    }
    // A spot belongs to the shot's location: a new location clears it, a move takes it along by name.
    if (tags.spot_id) { if ((await spotUnder(env, tags.spot_id, location, false)) !== tags.spot_id) throw new HttpError(400, "spot_id is not a spot of the shot's location"); }
    else if (tags.spot_id === undefined && cur.spot_id && location !== cur.location_id) {
      args.push(tags.location_id !== undefined ? null : await spotUnder(env, cur.spot_id, location, true)); sets.push(`spot_id = ?${args.length}`);
    }
    args.push(new Date().toISOString()); sets.push(`updated_at = ?${args.length}`);
    args.push(sid);
    const res = await env.DB.prepare(`UPDATE shots SET ${sets.join(", ")} WHERE id = ?${args.length}`).bind(...args).run();
    if (!res.meta.changes) throw new HttpError(404, "shot not found");
    // A shot moved to another project leaves the shooting days and timelines of its old project,
    // and lands at the new project's root without a shortcut.
    if (movedTo) await env.DB.batch([
      env.DB.prepare("DELETE FROM day_shots WHERE shot_id = ?1 AND day_id IN (SELECT id FROM shooting_days WHERE project_id != ?2)").bind(sid, movedTo),
      env.DB.prepare("DELETE FROM timeline_clips WHERE photo_id IN (SELECT id FROM photos WHERE shot_id = ?1) AND timeline_id IN (SELECT id FROM timelines WHERE project_id != ?2)").bind(sid, movedTo),
      ...fileRefCleanup(env, "shot", JSON.stringify([sid]), movedTo),
    ]);
    // Their clips' own layers go with them (issues #31, #275).
    if (movedTo) await deleteClipCompose(env, clipLayersLeaving(env, JSON.stringify([sid]), movedTo));
    return json({ shot: await loadShot(env, sid) });
  });

  /**
   * Bulk edit: JSON { ids: uuid[] (max 500), set?: { any single-PATCH field except extra }, extra?: { key: value | null } }.
   * Only the given fields change. `extra` is per top-level key (a group as a whole; null clears it), merged
   * into each shot's own values and checked against its (new) project's fields. One transaction: all or nothing.
   */
  r.on("PATCH", "/api/shots", async (ctx) => {
    const { env, request } = ctx;
    const b = await readJson<Record<string, unknown>>(request);
    if (!Array.isArray(b.ids) || b.ids.length === 0) throw new HttpError(400, "ids must be a non-empty array");
    if (b.ids.length > MAX_BULK) throw new HttpError(413, `at most ${MAX_BULK} shots per request`);
    const ids = [...new Set(b.ids.map((x, i) => assertUuid(x, `ids[${i}]`)))];
    const set = (b.set ?? {}) as Record<string, unknown>;
    if (typeof set !== "object" || Array.isArray(set)) throw new HttpError(400, "set must be an object");
    if (set.extra !== undefined) throw new HttpError(400, "send extra fields in extra, not set");
    const tags = parseTags(set, false);
    const sets: string[] = [];
    const args: unknown[] = [];
    for (const [k, v] of Object.entries(tags)) { args.push(v); sets.push(`${k} = ?${args.length}`); }
    if (set.state !== undefined) { args.push(assertEnum(set.state, "state", SHOT_STATES)); sets.push(`state = ?${args.length}`); }
    let movedTo: string | null = null;
    let targetWs: string | null = null;
    if (set.project_id !== undefined) {
      movedTo = assertUuid(set.project_id, "project_id");
      targetWs = await assertProjectRef(ctx, movedTo);
      args.push(movedTo); sets.push(`project_id = ?${args.length}`);
    }
    const extraPatch = b.extra ?? {};
    const err = validateExtra(extraPatch);
    if (err) throw new HttpError(400, err);
    const keys = Object.keys(extraPatch as Extra);
    if (sets.length === 0 && keys.length === 0) throw new HttpError(400, "nothing to update");

    const list = JSON.stringify(ids);
    const { results: found } = await env.DB.prepare(
      `SELECT s.id, s.project_id, s.location_id, s.spot_id, s.extra, p.workspace_id AS ws FROM shots s JOIN projects p ON p.id = s.project_id
       WHERE s.id IN (SELECT value FROM json_each(?1))`,
    ).bind(list).all<{ id: string; project_id: string; location_id: string | null; spot_id: string | null; extra: string; ws: string }>();
    // Every shot is checked, not only the target: another workspace's shot counts as not found.
    const rows = found.filter((row) => ctx.tenant.ranks.has(row.ws));
    if (rows.length !== ids.length) throw new HttpError(404, `${ids.length - rows.length} of the shots not found`);
    for (const row of rows) {
      assertRank(ctx, row.ws, "editor");
      if (targetWs && row.ws !== targetWs) throw new HttpError(400, CROSS_WORKSPACE);
    }
    const moving = rows.filter((row) => movedTo && row.project_id !== movedTo);
    if (tags.location_id) for (const pid of new Set(rows.map((row) => movedTo ?? row.project_id))) await assertLocationOf(env, tags.location_id, pid);
    // A spot must be one of every shot's (new) location; a new location without a spot clears it.
    if (tags.spot_id) {
      if (movedTo && tags.location_id === undefined && moving.length) throw new HttpError(400, "set the location together with the spot when moving shots");
      for (const loc of new Set(rows.map((row) => tags.location_id !== undefined ? tags.location_id : row.location_id))) {
        if ((await spotUnder(env, tags.spot_id, loc, false)) !== tags.spot_id) throw new HttpError(400, "spot_id is not a spot of every shot's location");
      }
    } else if (tags.location_id !== undefined && tags.spot_id === undefined) { sets.push("spot_id = NULL"); }
    const now = new Date().toISOString();
    const stmts: D1PreparedStatement[] = [];
    if (sets.length) {
      sets.push("deleted_at = NULL", "deleted_with = NULL");
      stmts.push(env.DB.prepare(`UPDATE shots SET ${sets.join(", ")}, updated_at = ?${args.length + 1} WHERE id IN (SELECT value FROM json_each(?${args.length + 2}))`)
        .bind(...args, now, list));
    }
    if (keys.length || moving.length) {
      // Interactive, so strict like the single PATCH, but only for the keys edited here. Shots that
      // change project first keep only the values the new project's fields accept.
      const defsOf = new Map<string, FieldDef[]>();
      for (const row of rows) {
        const projectId = movedTo ?? row.project_id;
        const moves = projectId !== row.project_id;
        if (!keys.length && !moves) continue;
        let defs = defsOf.get(projectId);
        if (!defs) { defs = await projectFieldDefs(env, projectId); defsOf.set(projectId, defs); }
        const own = JSON.parse(row.extra) as Extra;
        const extra = patchExtra(defs, moves ? fitExtra(defs, own) : own, extraPatch as Extra);
        const bad = validateValues(defs, extra, "extra", keys);
        if (bad) throw new HttpError(400, bad);
        stmts.push(env.DB.prepare("UPDATE shots SET extra = ?1, updated_at = ?2 WHERE id = ?3").bind(JSON.stringify(extra), now, row.id));
      }
    }
    // The location follows a moved shot by name, unless this edit sets one.
    if (movedTo && tags.location_id === undefined) {
      for (const row of moving) {
        if (!row.location_id) continue;
        const loc = await locationInProject(env, row.location_id, movedTo, true);
        const spot = row.spot_id && tags.spot_id === undefined ? await spotUnder(env, row.spot_id, loc, true) : undefined;
        stmts.push(spot === undefined ? env.DB.prepare("UPDATE shots SET location_id = ?1 WHERE id = ?2").bind(loc, row.id)
          : env.DB.prepare("UPDATE shots SET location_id = ?1, spot_id = ?2 WHERE id = ?3").bind(loc, spot, row.id));
      }
    }
    // Shots moved to another project leave the shooting days and timelines of their old project.
    if (movedTo) {
      stmts.push(env.DB.prepare("DELETE FROM day_shots WHERE shot_id IN (SELECT value FROM json_each(?1)) AND day_id IN (SELECT id FROM shooting_days WHERE project_id != ?2)").bind(list, movedTo));
      stmts.push(env.DB.prepare("DELETE FROM timeline_clips WHERE photo_id IN (SELECT id FROM photos WHERE shot_id IN (SELECT value FROM json_each(?1))) AND timeline_id IN (SELECT id FROM timelines WHERE project_id != ?2)").bind(list, movedTo));
      stmts.push(...fileRefCleanup(env, "shot", list, movedTo));
    }
    await env.DB.batch(stmts);
    if (movedTo) await deleteClipCompose(env, clipLayersLeaving(env, list, movedTo));

    const { results } = await env.DB.prepare(`${SHOT_SQL} WHERE s.id IN (SELECT value FROM json_each(?1))`).bind(list).all<ShotRow>();
    const [photos, compose] = await Promise.all([photosFor(env, ids), extrasFor(env, ids)]);
    return json({ shots: results.map((s) => shotToApi(s, photos.get(s.id) ?? [], compose)) });
  });

  /** Correct a position by hand: JSON { lat, lon, all_in_shot? }. all_in_shot moves every photo of the shot (a sequence taken on one spot). */
  r.on("PATCH", "/api/photos/:id", async (ctx, { id }) => {
    const { env, request } = ctx;
    const pid = assertUuid(id, "id");
    await assertAccess(ctx, "photo", pid, "editor");
    const b = await readJson<Record<string, unknown>>(request);
    const lat = assertNumber(b.lat, "lat", { min: -90, max: 90 });
    const lon = assertNumber(b.lon, "lon", { min: -180, max: 180 });
    const row = await env.DB.prepare("SELECT shot_id FROM photos WHERE id = ?1").bind(pid).first<{ shot_id: string }>();
    if (!row) throw new HttpError(404, "photo not found");
    await env.DB.prepare(`UPDATE photos SET lat = ?1, lon = ?2, position_corrected = 1 WHERE ${b.all_in_shot === true ? "shot_id = ?3" : "id = ?3"}`)
      .bind(lat, lon, b.all_in_shot === true ? row.shot_id : pid).run();
    return json({ shot: await loadShot(env, row.shot_id) });
  });

  /** Moves the shot to the recycle bin (purged after 30 days, see trash.ts). */
  r.on("DELETE", "/api/shots/:id", async (ctx, { id }) => {
    const sid = assertUuid(id, "id");
    await assertAccess(ctx, "shot", sid, "editor");
    return json(await binResource(ctx.env, "shot", sid));
  });
}
