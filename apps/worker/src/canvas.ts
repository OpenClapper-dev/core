/**
 * Canvases and optics presets on the server (docs/rewrite/05-composition.md, 02-optics.md): the
 * frames table kept from a canvas's body, the edit lock (one editor at a time, for every lockable
 * type), a canvas's render and thumbnail, and the additive rule of presets.
 */
import { assertUuid, HttpError, json, readJson, type Router } from "@openclapper/service-kit";
import { fileType, presetChangeError, type CanvasBody, type PresetBody, type ShotBody } from "@openclapper/model";
import { accessFile, fileOut } from "./files.ts";
import { assertBodySize, preconditionFailed, sniffImageType } from "./images.ts";
import type { Ctx, Env } from "./index.ts";

/** How long a lock holds without being renewed: the editor renews it while open, so a crash or a lost connection frees it soon. */
export const LOCK_MS = 60_000;

// ---------- Frames ----------

/** The statements that rewrite a canvas's rows in `frames` from its body. */
export function frameStatements(env: Env, canvasId: string, body: CanvasBody): D1PreparedStatement[] {
  const rows = body.frames.map((f) => ({ frame: f.id, preset: f.kind === "preset" ? f.preset ?? null : null, focal: f.focal ?? null, picture: body.picture === f.id ? 1 : 0 }));
  return [
    env.DB.prepare("DELETE FROM frames WHERE canvas_id = ?1").bind(canvasId),
    ...(rows.length ? [env.DB.prepare(
      `INSERT INTO frames (canvas_id, frame_id, preset_id, focal, is_picture)
       SELECT ?1, json_extract(value, '$.frame'), json_extract(value, '$.preset'), json_extract(value, '$.focal'), json_extract(value, '$.picture') FROM json_each(?2)`,
    ).bind(canvasId, JSON.stringify(rows))] : []),
  ];
}

/** The row of a shot's default frame in `frames` (frame id "default"), so a lens it uses counts as in use. */
export function shotFrameStatements(env: Env, shotId: string, body: ShotBody): D1PreparedStatement[] {
  const f = body.progression?.frame;
  return [
    env.DB.prepare("DELETE FROM frames WHERE canvas_id = ?1").bind(shotId),
    ...(f?.kind === "preset" && f.preset && f.focal ? [env.DB.prepare("INSERT INTO frames (canvas_id, frame_id, preset_id, focal, is_picture) VALUES (?1, 'default', ?2, ?3, 0)").bind(shotId, f.preset, f.focal)] : []),
  ];
}

/** The focal lengths frames use with a preset, in any canvas of the project, binned ones too (a restore brings them back). */
export async function usedFocals(env: Env, presetId: string): Promise<number[]> {
  const { results } = await env.DB.prepare("SELECT DISTINCT focal FROM frames WHERE preset_id = ?1 AND focal IS NOT NULL").bind(presetId).all<{ focal: number }>();
  return results.map((r) => r.focal);
}

/** Before a preset's body is saved: only what the additive rule allows. */
export async function assertPresetChange(env: Env, presetId: string, before: PresetBody, after: PresetBody): Promise<void> {
  const wrong = presetChangeError(before, after, await usedFocals(env, presetId));
  if (wrong) throw new HttpError(400, wrong);
}

/** Before files go to the bin: a preset that frames use is archived, not deleted. */
export async function assertPresetsFree(env: Env, files: readonly { id: string; type: string; name: string }[]): Promise<void> {
  for (const f of files.filter((x) => x.type === "preset")) {
    if ((await usedFocals(env, f.id)).length) throw new HttpError(409, `“${f.name}” is used by frames; archive it instead`);
  }
}

/** Frames copied with their canvases (old canvas id → copy). */
export function copyFrames(env: Env, map: string): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO frames (canvas_id, frame_id, preset_id, focal, is_picture)
     SELECT m.value, fr.frame_id, fr.preset_id, fr.focal, fr.is_picture FROM frames fr JOIN json_each(?1) m ON m.key = fr.canvas_id`,
  ).bind(map);
}

// ---------- The edit lock ----------

interface LockRow { lock_by: string | null; lock_holder: string | null; lock_until: string | null }
const now = () => new Date().toISOString();
const held = (r: LockRow) => r.lock_until !== null && r.lock_until > now();

/**
 * Whether a save may go ahead: a lockable file someone else holds is read-only (`423`). The holder is
 * the editing window's own token (`x-lock-holder`), so a second window of the same person is someone
 * else too. A file nobody holds can be saved.
 */
export async function assertNotLocked(ctx: Ctx, id: string, type: string): Promise<void> {
  if (!fileType(type)?.lockable) return;
  const r = await ctx.env.DB.prepare("SELECT lock_by, lock_holder, lock_until FROM files WHERE id = ?1").bind(id).first<LockRow>();
  if (!r || !held(r)) return;
  const holder = ctx.request.headers.get("x-lock-holder");
  if (r.lock_by === ctx.tenant.userId && r.lock_holder === holder) return;
  throw new HttpError(423, "someone else is editing this file");
}

const readHolder = (v: unknown) => {
  if (typeof v !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(v)) throw new HttpError(400, "holder must be the editing window's token");
  return v;
};

// ---------- Renders ----------

type Part = "render" | "thumbnail";
const LIMIT: Record<Part, number> = { render: 12 * 1024 * 1024, thumbnail: 600 * 1024 };
const renderKey = (id: string, part: Part) => `canvases/${id}/${part}`;

/** The R2 objects of these canvases' renders, for purging and copying. */
export async function renderKeys(env: Env, ids: string): Promise<string[]> {
  const { results } = await env.DB.prepare("SELECT file_id, part FROM renders WHERE file_id IN (SELECT value FROM json_each(?1))").bind(ids).all<{ file_id: string; part: Part }>();
  return results.map((r) => renderKey(r.file_id, r.part));
}
export const removeRenders = (env: Env, keys: string[]) => (keys.length ? env.SHOTS_BUCKET.delete(keys) : Promise.resolve());

/** Copies the renders of copied canvases (old id → new id) in R2 and in `renders`. */
export async function copyRenders(env: Env, ids: ReadonlyMap<string, string>): Promise<void> {
  const { results } = await env.DB.prepare("SELECT file_id, part, type, bytes, at FROM renders WHERE file_id IN (SELECT value FROM json_each(?1))")
    .bind(JSON.stringify([...ids.keys()])).all<{ file_id: string; part: Part; type: string; bytes: number; at: string }>();
  for (const r of results) {
    const obj = await env.SHOTS_BUCKET.get(renderKey(r.file_id, r.part));
    if (!obj) continue;
    const to = ids.get(r.file_id)!;
    await env.SHOTS_BUCKET.put(renderKey(to, r.part), await obj.arrayBuffer(), { httpMetadata: { contentType: r.type } });
    await env.DB.prepare("INSERT OR REPLACE INTO renders (file_id, part, type, bytes, at) VALUES (?1, ?2, ?3, ?4, ?5)").bind(to, r.part, r.type, r.bytes, r.at).run();
  }
}

export function registerCanvasRoutes(r: Router<Ctx>) {
  /**
   * Take or renew the edit lock: JSON { holder } → { lock: { by, until } }. Taken when nobody holds
   * it, it ran out, or the same window holds it; else `423` with who has it.
   */
  r.on("POST", "/api/files/:id/lock", async (ctx, { id }) => {
    const { env, tenant } = ctx;
    const f = await accessFile(ctx, assertUuid(id, "id"), "editor");
    if (!fileType(f.type)?.lockable) throw new HttpError(400, `a ${fileType(f.type)?.label.toLowerCase() ?? "file"} is not edited under a lock`);
    if (f.deleted_at) throw new HttpError(409, "the file is in the recycle bin; restore it first");
    const holder = readHolder((await readJson<Record<string, unknown>>(ctx.request)).holder);
    const until = new Date(Date.now() + LOCK_MS).toISOString();
    // One statement takes it only if free, run out or ours: two windows asking at once cannot both win.
    const took = await env.DB.prepare(
      `UPDATE files SET lock_by = ?2, lock_holder = ?3, lock_until = ?4
       WHERE id = ?1 AND (lock_until IS NULL OR lock_until <= ?5 OR (lock_by = ?2 AND lock_holder = ?3))`,
    ).bind(f.id, tenant.userId, holder, until, now()).run();
    const row = await env.DB.prepare("SELECT lock_by, lock_until FROM files WHERE id = ?1").bind(f.id).first<{ lock_by: string; lock_until: string }>();
    if (!took.meta.changes) return json({ error: "someone else is editing this file", lock: { by: row!.lock_by, until: row!.lock_until } }, 423);
    return json({ lock: { by: row!.lock_by, until: row!.lock_until } });
  });

  /** Let go of the lock: JSON { holder }. Only its holder can; anyone else's call changes nothing. Always `204`. */
  r.on("DELETE", "/api/files/:id/lock", async (ctx, { id }) => {
    const f = await accessFile(ctx, assertUuid(id, "id"), "viewer");
    const holder = readHolder(ctx.url.searchParams.get("holder"));
    await ctx.env.DB.prepare("UPDATE files SET lock_by = NULL, lock_holder = NULL, lock_until = NULL WHERE id = ?1 AND lock_by = ?2 AND lock_holder = ?3").bind(f.id, ctx.tenant.userId, holder).run();
    return new Response(null, { status: 204 });
  });

  /** A canvas's render or thumbnail, the body is the image (PNG, JPEG or WebP). Replaces the one there; needs the lock when someone holds it. */
  r.on("PUT", "/api/canvases/:id/:part", async (ctx, { id, part }) => {
    const { env, request } = ctx;
    if (part !== "render" && part !== "thumbnail") throw new HttpError(404, "not found");
    const f = await accessFile(ctx, assertUuid(id, "id"), "editor");
    if (f.type !== "canvas") throw new HttpError(404, "canvas not found");
    if (f.deleted_at) throw new HttpError(409, "the file is in the recycle bin; restore it first");
    await assertNotLocked(ctx, f.id, f.type);
    assertBodySize(request, LIMIT[part]);
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (!bytes.byteLength) throw new HttpError(400, "the image is empty");
    if (bytes.byteLength > LIMIT[part]) throw new HttpError(413, `the ${part} is larger than ${Math.floor(LIMIT[part] / 1024)} KB`);
    const type = sniffImageType(bytes.subarray(0, 16));
    if (!type || type === "image/heic") throw new HttpError(415, `the ${part} must be a PNG, JPEG or WebP image`);
    await env.SHOTS_BUCKET.put(renderKey(f.id, part), bytes, { httpMetadata: { contentType: type }, customMetadata: { canvas: f.id, workspace_id: f.ws ?? "" } });
    const at = now();
    await env.DB.batch([
      env.DB.prepare("INSERT OR REPLACE INTO renders (file_id, part, type, bytes, at) VALUES (?1, ?2, ?3, ?4, ?5)").bind(f.id, part, type, bytes.byteLength, at),
      env.DB.prepare("UPDATE files SET updated_at = ?2 WHERE id = ?1").bind(f.id, at),
    ]);
    return json({ file: await fileOut(env, f.id) }, 201);
  });

  /**
   * A canvas's render (`?size=render`, the default) or thumbnail. It changes with every save, so it is
   * revalidated (its ETag); clients add the file's `updated_at` to the address to skip the request.
   */
  r.on("GET", "/api/canvases/:id/image", async (ctx, { id }) => {
    const { env, request, url } = ctx;
    const part = (url.searchParams.get("size") ?? "render") as Part;
    if (part !== "render" && part !== "thumbnail") throw new HttpError(400, "size must be render or thumbnail");
    const f = await accessFile(ctx, assertUuid(id, "id"), "viewer");
    if (f.type !== "canvas") throw new HttpError(404, "canvas not found");
    const obj = await env.SHOTS_BUCKET.get(renderKey(f.id, part), { onlyIf: request.headers });
    if (!obj) throw new HttpError(404, `the ${part} has not been made yet`);
    if (!("body" in obj) && preconditionFailed(request, obj)) throw new HttpError(412, "precondition failed");
    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    headers.set("etag", obj.httpEtag);
    headers.set("cache-control", url.searchParams.has("v") ? "private, max-age=31536000, immutable" : "private, no-cache");
    headers.set("x-content-type-options", "nosniff");
    if (!("body" in obj) || !obj.body) return new Response(null, { status: 304, headers });
    return new Response(obj.body, { headers });
  });
}
