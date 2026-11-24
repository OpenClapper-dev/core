import { photoAov } from "@openclapper/fov-math";
import { MAX_FILE_NAME, fileType, placementError } from "@openclapper/model";
import { assertUuid, HttpError, json, readJson, type Router } from "@openclapper/service-kit";
import { accessFile, fileOut } from "./files.ts";
import { assertBodySize, imageExt, preconditionFailed, sniffImageType, type ImageType } from "./images.ts";
import type { Ctx, Env } from "./index.ts";
import { assertProjectRef } from "./tenancy.ts";

/**
 * Photos (docs/rewrite/01-media.md). A photo is a file that is made by uploading it: first what is
 * known about it (`PUT /api/photos/:id`), then its three images, each on its own and in any order:
 * the thumbnail and the preview, which the adding client makes, and the untouched original. A photo
 * is usable everywhere as soon as its preview is there.
 *
 * Never lose a capture: every step can be sent again and answers the same (stored images never
 * change, so a second upload of one is not even read), and what an upload names that is gone
 * meanwhile (its folder or collection) is dropped instead of refusing the photo.
 */

export const PARTS = ["thumbnail", "preview", "original"] as const;
export type Part = (typeof PARTS)[number];
const LIMIT: Record<Part, { bytes: number; types: readonly ImageType[] }> = {
  thumbnail: { bytes: 400 * 1024, types: ["image/jpeg", "image/webp"] },
  preview: { bytes: 4 * 1024 * 1024, types: ["image/jpeg", "image/webp"] },
  original: { bytes: 60 * 1024 * 1024, types: ["image/jpeg", "image/png", "image/webp", "image/heic"] },
};
const MAX_META_BYTES = 256 * 1024;
const MEDIA_TYPES: readonly string[] = LIMIT.original.types;

interface PhotoRow {
  file_id: string; object_id: string; media_type: string;
  original_bytes: number | null; preview_bytes: number | null; preview_type: string | null; thumbnail_bytes: number | null; thumbnail_type: string | null;
}
const keyOf = (objectId: string, part: Part, type: string) => `photos/${objectId}/${part}.${imageExt(type)}`;
const typeOf = (p: PhotoRow, part: Part) => (part === "original" ? p.media_type : part === "preview" ? p.preview_type : p.thumbnail_type) ?? "image/jpeg";
const photoRow = (env: Env, id: string) => env.DB.prepare("SELECT file_id, object_id, media_type, original_bytes, preview_bytes, preview_type, thumbnail_bytes, thumbnail_type FROM photos WHERE file_id = ?1").bind(id).first<PhotoRow>();

/** What an upload says about a photo, read leniently: what is wrong is dropped, not refused. */
function readExif(v: unknown): Record<string, string | number | number[]> {
  const out: Record<string, string | number | number[]> = {};
  if (typeof v !== "object" || v === null || Array.isArray(v)) return out;
  for (const [k, x] of Object.entries(v).slice(0, 400)) {
    if (!/^[A-Za-z0-9_]{1,60}$/.test(k)) continue;
    if (typeof x === "number" && Number.isFinite(x)) out[k] = x;
    else if (typeof x === "string") out[k] = x.slice(0, 500);
    else if (Array.isArray(x) && x.length <= 64 && x.every((n) => typeof n === "number" && Number.isFinite(n))) out[k] = x as number[];
  }
  return out;
}
function readReadout(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof v !== "object" || v === null) return out;
  for (const k of ["make", "model", "lens"]) { const x = (v as Record<string, unknown>)[k]; if (typeof x === "string" && x.trim()) out[k] = x.trim().slice(0, 120); }
  return out;
}
const pixels = (v: unknown, what: string) => { if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 100_000) throw new HttpError(400, `${what} must be a number of pixels`); return v; };

/** The statement that gives the copies of photos their rows: the same stored images, so a duplicate costs no storage. */
export function copyPhotos(env: Env, map: string): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO photos (file_id, object_id, origin, media_type, taken_at, width, height, original_bytes, preview_bytes, preview_type, thumbnail_bytes, thumbnail_type, aov_horizontal, aov_vertical, aov_source, device_id, frame)
     SELECT m.value, p.object_id, p.origin, p.media_type, p.taken_at, p.width, p.height, p.original_bytes, p.preview_bytes, p.preview_type, p.thumbnail_bytes, p.thumbnail_type, p.aov_horizontal, p.aov_vertical, p.aov_source, p.device_id, p.frame
     FROM photos p JOIN json_each(?1) m ON m.key = p.file_id`,
  ).bind(map);
}

/** The stored images of the photos among `ids` (JSON array), to remove once their rows are gone. */
export async function objectsOf(env: Env, ids: string): Promise<PhotoRow[]> {
  return (await env.DB.prepare(
    `SELECT DISTINCT p.file_id, p.object_id, p.media_type, p.original_bytes, p.preview_bytes, p.preview_type, p.thumbnail_bytes, p.thumbnail_type
     FROM photos p JOIN files f ON f.id = p.file_id WHERE f.id IN (SELECT value FROM json_each(?1)) OR f.deleted_with IN (SELECT value FROM json_each(?1)) OR f.internal_of IN (SELECT value FROM json_each(?1))`,
  ).bind(ids).all<PhotoRow>()).results;
}

/** After rows were deleted: remove the stored images no photo shares any more. */
export async function removeOrphans(env: Env, gone: PhotoRow[]): Promise<void> {
  if (!gone.length) return;
  const byObject = new Map(gone.map((p) => [p.object_id, p]));
  const still = new Set((await env.DB.prepare("SELECT DISTINCT object_id FROM photos WHERE object_id IN (SELECT value FROM json_each(?1))").bind(JSON.stringify([...byObject.keys()])).all<{ object_id: string }>()).results.map((r) => r.object_id));
  const keys: string[] = [];
  for (const p of byObject.values()) {
    if (still.has(p.object_id)) continue;
    for (const part of PARTS) if (p[`${part}_bytes`] !== null) keys.push(keyOf(p.object_id, part, typeOf(p, part)));
  }
  for (let i = 0; i < keys.length; i += 1000) await env.SHOTS_BUCKET.delete(keys.slice(i, i + 1000));
}

export function registerPhotoRoutes(r: Router<Ctx>) {
  /**
   * Add a photo, or say again that it exists: JSON { project_id, origin, media_type, taken_at, width,
   * height, name?, container?, exif?, readout?, device_id? }. Sent again for a photo that exists it
   * changes nothing and answers with the photo as it is. The angle of view is computed here from the
   * EXIF tags, one rule for every client (packages/fov-math).
   */
  r.on("PUT", "/api/photos/:id", async (ctx, { id }) => {
    const { env, request, tenant } = ctx;
    const pid = assertUuid(id, "id");
    assertBodySize(request, MAX_META_BYTES);
    const b = await readJson<Record<string, unknown>>(request);
    if (typeof b !== "object" || b === null || Array.isArray(b)) throw new HttpError(400, "expected a JSON object");
    const existing = await env.DB.prepare("SELECT type FROM files WHERE id = ?1").bind(pid).first<{ type: string }>();
    if (existing) {
      await accessFile(ctx, pid, "editor");
      if (existing.type !== "photo") throw new HttpError(409, "this id is another file's");
      return json({ file: await fileOut(env, pid) });
    }
    const projectId = assertUuid(b.project_id, "project_id");
    await assertProjectRef(ctx, projectId);
    if (b.origin !== "capture" && b.origin !== "import") throw new HttpError(400, "origin must be capture or import");
    const width = pixels(b.width, "width"), height = pixels(b.height, "height");
    const mediaType = typeof b.media_type === "string" && MEDIA_TYPES.includes(b.media_type) ? b.media_type : "image/jpeg";
    const taken = typeof b.taken_at === "string" && !Number.isNaN(Date.parse(b.taken_at)) ? new Date(b.taken_at).toISOString() : new Date().toISOString();
    const name = typeof b.name === "string" && b.name.trim() ? b.name.trim().slice(0, MAX_FILE_NAME) : "Photo";
    const exif = readExif(b.exif), readout = readReadout(b.readout);
    const aov = photoAov(exif, width, height);
    const deviceId = typeof b.device_id === "string" && /^[0-9a-f-]{36}$/i.test(b.device_id) ? b.device_id.toLowerCase() : null;
    // The folder or collection it was taken into may be gone meanwhile: then it comes in at the top level.
    let container: string | null = null;
    if (typeof b.container === "string" && /^[0-9a-f-]{36}$/i.test(b.container)) {
      const c = await env.DB.prepare("SELECT type, fixed FROM files WHERE id = ?1 AND project_id = ?2 AND deleted_at IS NULL AND internal_of IS NULL").bind(b.container.toLowerCase(), projectId).first<{ type: string; fixed: string | null }>();
      if (c && !placementError(fileType("photo")!, c, "project")) container = b.container.toLowerCase();
    }
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO files (id, project_id, type, name, container, created_by, created_at, body, body_version) VALUES (?1, ?2, 'photo', ?3, ?4, ?5, ?6, ?7, 1)")
        .bind(pid, projectId, name, container, tenant.userId, now, JSON.stringify({ exif, readout })),
      env.DB.prepare("INSERT INTO photos (file_id, object_id, origin, media_type, taken_at, width, height, aov_horizontal, aov_vertical, aov_source, device_id) VALUES (?1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)")
        .bind(pid, b.origin, mediaType, taken, width, height, aov?.horizontal ?? null, aov?.vertical ?? null, aov?.source ?? null, deviceId),
    ]);
    return json({ file: await fileOut(env, pid) }, 201);
  });

  /**
   * Store one image of a photo: the body is the image itself. The type is taken from its bytes. An
   * image that is stored already is not read again (`already: true`): images never change.
   */
  r.on("PUT", "/api/photos/:id/:part", async (ctx, { id, part }) => {
    const { env, request } = ctx;
    const pid = assertUuid(id, "id");
    if (!(PARTS as readonly string[]).includes(part)) throw new HttpError(404, "not found");
    const which = part as Part;
    const file = await accessFile(ctx, pid, "editor");
    const photo = file.type === "photo" ? await photoRow(env, pid) : null;
    if (!photo) throw new HttpError(404, "photo not found");
    if (photo[`${which}_bytes`] !== null) return json({ file: await fileOut(env, pid), already: true });
    assertBodySize(request, LIMIT[which].bytes);
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength === 0) throw new HttpError(400, "the image is empty");
    if (bytes.byteLength > LIMIT[which].bytes) throw new HttpError(413, `the ${which} is larger than ${Math.floor(LIMIT[which].bytes / 1024)} KB`);
    const type = sniffImageType(bytes.subarray(0, 16));
    if (!type || !LIMIT[which].types.includes(type)) throw new HttpError(415, `the ${which} must be ${which === "original" ? "a JPEG, PNG, WebP or HEIC" : "a JPEG or WebP"} image`);
    await env.SHOTS_BUCKET.put(keyOf(photo.object_id, which, type), bytes, { httpMetadata: { contentType: type }, customMetadata: { object_id: photo.object_id, part: which, workspace_id: file.ws ?? "" } });
    // Every photo that shares the image gets it; a second upload racing this one finds it stored.
    const set = which === "original" ? "original_bytes = ?2, media_type = ?3" : `${which}_bytes = ?2, ${which}_type = ?3`;
    await env.DB.prepare(`UPDATE photos SET ${set} WHERE object_id = ?1 AND ${which}_bytes IS NULL`).bind(photo.object_id, bytes.byteLength, type).run();
    return json({ file: await fileOut(env, pid) }, 201);
  });

  /**
   * A photo's image, same-origin so plain <img> tags work with the session: `?size=thumbnail`,
   * `preview` (the default) or `original`. Stored images never change, so they are cached for good.
   */
  r.on("GET", "/api/photos/:id/image", async (ctx, { id }) => {
    const { env, request, url } = ctx;
    const pid = assertUuid(id, "id");
    const size = url.searchParams.get("size") ?? "preview";
    if (!(PARTS as readonly string[]).includes(size)) throw new HttpError(400, `size must be one of: ${PARTS.join(", ")}`);
    const part = size as Part;
    await accessFile(ctx, pid, "viewer");
    const photo = await photoRow(env, pid);
    if (!photo) throw new HttpError(404, "photo not found");
    if (photo[`${part}_bytes`] === null) throw new HttpError(404, `the ${part} has not arrived yet`);
    const obj = await env.SHOTS_BUCKET.get(keyOf(photo.object_id, part, typeOf(photo, part)), { onlyIf: request.headers });
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
}
