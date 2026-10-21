import { MAX_COMPOSE_NAME, MAX_DESCRIPTION, MAX_SKETCH_KIND, validateDrawing, validatePresentation } from "@openclapper/vocab";
import { assertNumber, assertString, assertUuid, HttpError, isJsonType, json, readJson, type Router } from "@openclapper/service-kit";
import { assertBodySize, imageExt, imageTypeOf, preconditionFailed, type ImageType } from "./images.ts";
import type { Ctx } from "./index.ts";
import { loadShot } from "./shots.ts";
import { accessIfExists, assertAccess, type Access } from "./tenancy.ts";

/**
 * Overlays (a drawing + look over one photo) and sketches (a free canvas on a shot), issue #12.
 * The Studio owns them: it edits the vector JSON and uploads a flattened render with every
 * save, which is what the phone shows. Shots embed both lists without the drawing
 * (`composeFor`); the drawing comes with GET /api/overlays/:id and /api/sketches/:id.
 *
 * Issue #31: an overlay or sketch drawn inline in a timeline belongs to that timeline clip
 * (timeline_id + clip_id) until it is promoted to the shot. Shots never embed clip-owned rows,
 * so the phone does not see them; timelines embed their own (`clipComposeFor`).
 */

interface OverlayRow { id: string; photo_id: string; shot_id: string; timeline_id: string | null; clip_id: string | null; name: string; description: string | null; drawing?: string; presentation: string; render_key: string | null; position: number; created_at: string; updated_at: string | null }
interface SketchRow { id: string; shot_id: string | null; timeline_id: string | null; clip_id: string | null; name: string; kind: string | null; description: string | null; drawing?: string; aspect: number; render_key: string | null; position: number; created_at: string; updated_at: string | null }

const MAX_RENDER_BYTES = 6 * 1024 * 1024;
const MAX_DRAWING_BYTES = 1024 * 1024;
/** The largest save body: a render at the ceiling, a drawing at its limit, room for the rest (checked before parsing, #224). */
const MAX_SAVE_BYTES = MAX_RENDER_BYTES + MAX_DRAWING_BYTES + 64 * 1024;

/** The render URL changes with every save, so the image route can cache for a year. */
const renderUrl = (kind: "overlays" | "sketches", r: { id: string; render_key: string | null; updated_at: string | null; created_at: string }) =>
  r.render_key ? `/api/${kind}/${r.id}/render?v=${encodeURIComponent(r.updated_at ?? r.created_at)}` : null;

export function overlayToApi(r: OverlayRow) {
  return {
    id: r.id, photo_id: r.photo_id, shot_id: r.shot_id, timeline_id: r.timeline_id, clip_id: r.clip_id, name: r.name, description: r.description,
    ...(r.drawing !== undefined ? { drawing: JSON.parse(r.drawing) as unknown } : {}),
    presentation: JSON.parse(r.presentation) as unknown, position: r.position,
    render_url: renderUrl("overlays", r), created_at: r.created_at, updated_at: r.updated_at,
  };
}
export function sketchToApi(r: SketchRow) {
  return {
    id: r.id, shot_id: r.shot_id, timeline_id: r.timeline_id, clip_id: r.clip_id, name: r.name, kind: r.kind, description: r.description,
    ...(r.drawing !== undefined ? { drawing: JSON.parse(r.drawing) as unknown } : {}),
    aspect: r.aspect, position: r.position,
    render_url: renderUrl("sketches", r), created_at: r.created_at, updated_at: r.updated_at,
  };
}
export type OverlayApi = ReturnType<typeof overlayToApi>;
export type SketchApi = ReturnType<typeof sketchToApi>;

const OVERLAY_COLS = "o.id, o.photo_id, ph.shot_id, o.timeline_id, o.clip_id, o.name, o.description, o.presentation, o.render_key, o.position, o.created_at, o.updated_at";
const SKETCH_COLS = "id, shot_id, timeline_id, clip_id, name, kind, description, aspect, render_key, position, created_at, updated_at";

/** Overlays and sketches of many shots, without drawings, in display order. */
export async function composeFor(env: Ctx["env"], shotIds: string[]): Promise<{ overlays: Map<string, OverlayApi[]>; sketches: Map<string, SketchApi[]> }> {
  const overlays = new Map<string, OverlayApi[]>(), sketches = new Map<string, SketchApi[]>();
  if (shotIds.length === 0) return { overlays, sketches };
  const ids = JSON.stringify(shotIds);
  const [o, s] = await env.DB.batch([
    env.DB.prepare(`SELECT ${OVERLAY_COLS} FROM overlays o JOIN photos ph ON ph.id = o.photo_id WHERE ph.shot_id IN (SELECT value FROM json_each(?1)) AND o.timeline_id IS NULL ORDER BY ph.shot_id, o.position, o.created_at`).bind(ids),
    env.DB.prepare(`SELECT ${SKETCH_COLS} FROM sketches WHERE shot_id IN (SELECT value FROM json_each(?1)) ORDER BY shot_id, position, created_at`).bind(ids),
  ]);
  for (const r of (o.results ?? []) as OverlayRow[]) overlays.set(r.shot_id, [...(overlays.get(r.shot_id) ?? []), overlayToApi(r)]);
  for (const r of (s.results ?? []) as SketchRow[]) sketches.set(r.shot_id!, [...(sketches.get(r.shot_id!) ?? []), sketchToApi(r)]);
  return { overlays, sketches };
}

/** The clip-owned overlays and sketches of these timelines, without drawings, keyed by timeline id. */
export async function clipComposeFor(env: Ctx["env"], timelineIds: string[]): Promise<{ overlays: Map<string, OverlayApi[]>; sketches: Map<string, SketchApi[]> }> {
  const overlays = new Map<string, OverlayApi[]>(), sketches = new Map<string, SketchApi[]>();
  if (timelineIds.length === 0) return { overlays, sketches };
  const ids = JSON.stringify(timelineIds);
  const [o, s] = await env.DB.batch([
    env.DB.prepare(`SELECT ${OVERLAY_COLS} FROM overlays o JOIN photos ph ON ph.id = o.photo_id WHERE o.timeline_id IN (SELECT value FROM json_each(?1)) ORDER BY o.created_at`).bind(ids),
    env.DB.prepare(`SELECT ${SKETCH_COLS} FROM sketches WHERE timeline_id IN (SELECT value FROM json_each(?1)) ORDER BY created_at`).bind(ids),
  ]);
  for (const r of (o.results ?? []) as OverlayRow[]) overlays.set(r.timeline_id!, [...(overlays.get(r.timeline_id!) ?? []), overlayToApi(r)]);
  for (const r of (s.results ?? []) as SketchRow[]) sketches.set(r.timeline_id!, [...(sketches.get(r.timeline_id!) ?? []), sketchToApi(r)]);
  return { overlays, sketches };
}

/**
 * Delete the clip-owned overlays and sketches matching a WHERE clause over `o` (overlays) or `s`
 * (sketches), and their renders. Used when clips leave a timeline (PUT), a timeline is deleted, or
 * a shot moves out of the timeline's project.
 */
export async function deleteClipCompose(env: Ctx["env"], where: { overlays: D1PreparedStatement | null; sketches: D1PreparedStatement | null; deletes: D1PreparedStatement[] }): Promise<void> {
  const reads = [where.overlays, where.sketches].filter((x): x is D1PreparedStatement => !!x);
  const keys = reads.length ? (await env.DB.batch(reads)).flatMap((r) => ((r.results ?? []) as { k: string | null }[]).map((x) => x.k).filter((k): k is string => !!k)) : [];
  if (where.deletes.length) await env.DB.batch(where.deletes);
  if (keys.length) await env.SHOTS_BUCKET.delete(keys).catch(() => {});
}

/** Clip-owned overlays on these shots' photos in timelines of other projects (the shots moved to `projectId`). */
export function clipOverlaysLeaving(env: Ctx["env"], shotIdsJson: string, projectId: string) {
  const where = "photo_id IN (SELECT id FROM photos WHERE shot_id IN (SELECT value FROM json_each(?1))) AND timeline_id IN (SELECT id FROM timelines WHERE project_id != ?2)";
  return {
    overlays: env.DB.prepare(`SELECT render_key AS k FROM overlays WHERE ${where}`).bind(shotIdsJson, projectId),
    sketches: null,
    deletes: [env.DB.prepare(`DELETE FROM overlays WHERE ${where}`).bind(shotIdsJson, projectId)],
  };
}

/** R2 keys of every render under a shot (to delete with the shot). */
export async function renderKeysOf(env: Ctx["env"], shotId: string): Promise<string[]> {
  const [o, s] = await env.DB.batch([
    env.DB.prepare("SELECT o.render_key AS k FROM overlays o JOIN photos ph ON ph.id = o.photo_id WHERE ph.shot_id = ?1 AND o.render_key IS NOT NULL").bind(shotId),
    env.DB.prepare("SELECT render_key AS k FROM sketches WHERE shot_id = ?1 AND render_key IS NOT NULL").bind(shotId),
  ]);
  return [...((o.results ?? []) as { k: string }[]), ...((s.results ?? []) as { k: string }[])].map((r) => r.k);
}

/** Counts for the delete confirmation. */
export async function composeCounts(env: Ctx["env"], shotId: string): Promise<{ overlays: number; sketches: number }> {
  const [o, s] = await env.DB.batch([
    env.DB.prepare("SELECT count(*) AS n FROM overlays o JOIN photos ph ON ph.id = o.photo_id WHERE ph.shot_id = ?1").bind(shotId),
    env.DB.prepare("SELECT count(*) AS n FROM sketches WHERE shot_id = ?1").bind(shotId),
  ]);
  return { overlays: ((o.results?.[0] as { n: number } | undefined)?.n) ?? 0, sketches: ((s.results?.[0] as { n: number } | undefined)?.n) ?? 0 };
}

/** A PUT body: JSON alone, or multipart with `metadata` (JSON) and an optional `render` image. */
async function readSave(request: Request): Promise<{ m: Record<string, unknown>; render: File | null }> {
  const ct = request.headers.get("content-type") ?? "";
  if (isJsonType(ct)) return { m: await readJson<Record<string, unknown>>(request), render: null };
  if (!ct.startsWith("multipart/form-data")) throw new HttpError(415, "expected multipart/form-data or application/json");
  const form = await request.formData();
  const raw = form.get("metadata");
  if (typeof raw !== "string") throw new HttpError(400, "metadata field missing");
  let m: Record<string, unknown>;
  try { m = JSON.parse(raw) as Record<string, unknown>; } catch { throw new HttpError(400, "metadata is not JSON"); }
  const render = form.get("render");
  if (render !== null && !(render instanceof File)) throw new HttpError(400, "render must be a file");
  if (render) {
    if (render.size === 0 || render.size > MAX_RENDER_BYTES) throw new HttpError(413, "render empty or too large");
  }
  return { m, render };
}

const optText = (v: unknown, field: string, max: number): string | null => {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") throw new HttpError(400, `${field} must be a string`);
  if (v.length > max) throw new HttpError(400, `${field} too long (max ${max})`);
  return v;
};
const drawingJson = (v: unknown, withLook: boolean): string => {
  const err = validateDrawing(v, withLook);
  if (err) throw new HttpError(400, `drawing: ${err}`);
  const s = JSON.stringify(v);
  if (s.length > MAX_DRAWING_BYTES) throw new HttpError(413, "drawing too large");
  return s;
};
/**
 * The clip owner in a PUT body (both `timeline_id` and `clip_id`, or neither). The timeline must
 * exist, be editable by the caller and, for an overlay, be in the project of the photo's shot.
 */
async function clipOwner(a: Access, m: Record<string, unknown>, projectOfPhoto: string | null): Promise<{ timeline_id: string; clip_id: string; workspace_id: string } | null> {
  if ((m.timeline_id === undefined || m.timeline_id === null) && (m.clip_id === undefined || m.clip_id === null)) return null;
  const timelineId = assertUuid(m.timeline_id, "timeline_id");
  const clipId = assertUuid(m.clip_id, "clip_id");
  const ws = await assertAccess(a, "timeline", timelineId, "editor");
  const t = await a.env.DB.prepare("SELECT project_id FROM timelines WHERE id = ?1").bind(timelineId).first<{ project_id: string }>();
  if (!t) throw new HttpError(404, "timeline not found");
  if (projectOfPhoto && t.project_id !== projectOfPhoto) throw new HttpError(400, "the photo is not in the timeline's project");
  return { timeline_id: timelineId, clip_id: clipId, workspace_id: ws };
}
const sameOwner = (a: { timeline_id: string | null; clip_id: string | null }, b: { timeline_id: string; clip_id: string } | null) =>
  (a.timeline_id ?? null) === (b?.timeline_id ?? null) && (a.clip_id ?? null) === (b?.clip_id ?? null);

const optPosition = (v: unknown) => (v === undefined || v === null ? null : assertNumber(v, "position", { min: 0, max: 10_000 }));

type Render = { file: File; type: ImageType };

/**
 * A save body with the upload checks (#224): its size before anything is parsed, and the render's
 * type from its own bytes (JPEG, PNG, WebP; 415 otherwise), never from what the client declares.
 */
async function readBody(request: Request): Promise<{ m: Record<string, unknown>; render: Render | null }> {
  assertBodySize(request, MAX_SAVE_BYTES);
  const { m, render } = await readSave(request);
  return { m, render: render ? { file: render, type: await imageTypeOf(render, "render") } : null };
}

/** Write the render to R2 (keyed by id and type), then run the row statements; the object is removed again if the rows fail. */
async function saveWithRender(env: Ctx["env"], kind: "overlays" | "sketches", id: string, render: Render | null, oldKey: string | null, rows: (key: string | null) => D1PreparedStatement[]) {
  const key = render ? `renders/${kind}/${id}.${imageExt(render.type)}` : oldKey;
  if (render) await env.SHOTS_BUCKET.put(key!, render.file.stream(), { httpMetadata: { contentType: render.type }, customMetadata: { kind, id } });
  try { await env.DB.batch(rows(key)); } catch (err) {
    if (render && key !== oldKey) await env.SHOTS_BUCKET.delete(key!).catch(() => {});
    throw err;
  }
  if (render && oldKey && oldKey !== key) await env.SHOTS_BUCKET.delete(oldKey).catch(() => {});
}

/** Copy a render object to the key of another row (a duplicated clip gets its own render). */
async function copyRender(env: Ctx["env"], kind: "overlays" | "sketches", id: string, key: string | null): Promise<string | null> {
  if (!key) return null;
  const obj = await env.SHOTS_BUCKET.get(key);
  if (!obj) return null;
  const to = `renders/${kind}/${id}.${key.split(".").pop() ?? "jpg"}`;
  await env.SHOTS_BUCKET.put(to, obj.body, { httpMetadata: obj.httpMetadata, customMetadata: { kind, id } });
  return to;
}

async function serveRender(env: Ctx["env"], request: Request, key: string | null) {
  if (!key) throw new HttpError(404, "no render yet");
  const obj = await env.SHOTS_BUCKET.get(key, { onlyIf: request.headers });
  if (!obj) throw new HttpError(404, "render missing in storage");
  if (!("body" in obj) && preconditionFailed(request, obj)) throw new HttpError(412, "precondition failed");
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  headers.set("cache-control", "private, max-age=31536000, immutable");
  headers.set("x-content-type-options", "nosniff");
  if (!("body" in obj) || !obj.body) return new Response(null, { status: 304, headers });
  return new Response(obj.body, { headers });
}

export function registerComposeRoutes(r: Router<Ctx>) {
  // ---------- Overlays ----------
  const overlay = (env: Ctx["env"], id: string, withDrawing: boolean) => env.DB.prepare(
    `SELECT ${OVERLAY_COLS}${withDrawing ? ", o.drawing" : ""} FROM overlays o JOIN photos ph ON ph.id = o.photo_id WHERE o.id = ?1`,
  ).bind(id).first<OverlayRow>();

  r.on("GET", "/api/overlays/:id", async (ctx, { id }) => {
    const oid = assertUuid(id, "id");
    await assertAccess(ctx, "overlay", oid, "viewer");
    const row = await overlay(ctx.env, oid, true);
    if (!row) throw new HttpError(404, "overlay not found");
    return json({ overlay: overlayToApi(row) });
  });

  /**
   * Upsert. JSON, or multipart with `metadata` + `render`:
   *   { photo_id, name, description?, drawing, presentation, position?, timeline_id?, clip_id? }
   * The photo fixes the shot; moving an overlay to another photo is not supported. With
   * timeline_id + clip_id the overlay belongs to that timeline clip (issue #31); the owner is
   * fixed at creation (promotion goes through the timeline route).
   */
  r.on("PUT", "/api/overlays/:id", async (ctx, { id }) => {
    const { env, request } = ctx;
    const oid = assertUuid(id, "id");
    const { m, render } = await readBody(request);
    const photoId = assertUuid(m.photo_id, "photo_id");
    const name = assertString(m.name, "name", MAX_COMPOSE_NAME);
    const description = optText(m.description, "description", MAX_DESCRIPTION);
    const drawing = drawingJson(m.drawing, true);
    const perr = validatePresentation(m.presentation);
    if (perr) throw new HttpError(400, `presentation: ${perr}`);
    const presentation = JSON.stringify(m.presentation);
    await assertAccess(ctx, "photo", photoId, "editor");
    await accessIfExists(ctx, "overlay", oid, "editor");
    const photo = await env.DB.prepare("SELECT ph.shot_id, s.project_id FROM photos ph JOIN shots s ON s.id = ph.shot_id WHERE ph.id = ?1").bind(photoId).first<{ shot_id: string; project_id: string }>();
    if (!photo) throw new HttpError(404, "photo not found");
    const owner = await clipOwner(ctx, m, photo.project_id);
    const cur = await env.DB.prepare("SELECT photo_id, render_key, position, timeline_id, clip_id FROM overlays WHERE id = ?1").bind(oid).first<{ photo_id: string; render_key: string | null; position: number; timeline_id: string | null; clip_id: string | null }>();
    if (cur && cur.photo_id !== photoId) throw new HttpError(409, "an overlay cannot move to another photo");
    if (cur && !sameOwner(cur, owner)) throw new HttpError(409, "an overlay cannot change its owner here");
    const position = optPosition(m.position) ?? cur?.position ?? ((await env.DB.prepare("SELECT coalesce(max(position), -1) + 1 AS p FROM overlays WHERE photo_id = ?1").bind(photoId).first<{ p: number }>())?.p ?? 0);
    const now = new Date().toISOString();
    await saveWithRender(env, "overlays", oid, render, cur?.render_key ?? null, (key) => [
      env.DB.prepare(
        `INSERT INTO overlays (id, photo_id, name, description, drawing, presentation, render_key, position, updated_at, timeline_id, clip_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
         ON CONFLICT(id) DO UPDATE SET name = ?3, description = ?4, drawing = ?5, presentation = ?6, render_key = ?7, position = ?8, updated_at = ?9`,
      ).bind(oid, photoId, name, description, drawing, presentation, key, position, now, owner?.timeline_id ?? null, owner?.clip_id ?? null),
    ]);
    return json({ overlay: overlayToApi((await overlay(env, oid, true))!), shot: await loadShot(env, photo.shot_id) }, cur ? 200 : 201);
  });

  /** Rename, describe or reorder without touching the drawing: JSON { name?, description?, position? }. */
  r.on("PATCH", "/api/overlays/:id", async (ctx, { id }) => {
    const { env, request } = ctx;
    const oid = assertUuid(id, "id");
    await assertAccess(ctx, "overlay", oid, "editor");
    const { m } = await readBody(request);
    const sets: string[] = [];
    const args: unknown[] = [];
    if (m.name !== undefined) { args.push(assertString(m.name, "name", MAX_COMPOSE_NAME)); sets.push(`name = ?${args.length}`); }
    if (m.description !== undefined) { args.push(optText(m.description, "description", MAX_DESCRIPTION)); sets.push(`description = ?${args.length}`); }
    if (m.position !== undefined) { args.push(optPosition(m.position) ?? 0); sets.push(`position = ?${args.length}`); }
    if (!sets.length) throw new HttpError(400, "nothing to update");
    args.push(new Date().toISOString()); sets.push(`updated_at = ?${args.length}`);
    args.push(oid);
    const res = await env.DB.prepare(`UPDATE overlays SET ${sets.join(", ")} WHERE id = ?${args.length}`).bind(...args).run();
    if (!res.meta.changes) throw new HttpError(404, "overlay not found");
    const row = (await overlay(env, oid, true))!;
    return json({ overlay: overlayToApi(row), shot: await loadShot(env, row.shot_id) });
  });

  r.on("DELETE", "/api/overlays/:id", async (ctx, { id }) => {
    const { env } = ctx;
    const oid = assertUuid(id, "id");
    await assertAccess(ctx, "overlay", oid, "editor");
    const row = await overlay(env, oid, false);
    if (!row) throw new HttpError(404, "overlay not found");
    await env.DB.prepare("DELETE FROM overlays WHERE id = ?1").bind(oid).run();
    if (row.render_key) await env.SHOTS_BUCKET.delete(row.render_key).catch(() => {});
    return json({ deleted: oid, shot: await loadShot(env, row.shot_id) });
  });

  /**
   * Copy an overlay (shot- or clip-owned) as the own overlay of a timeline clip: { id, timeline_id, clip_id }.
   * A duplicated clip must not share its drawing with the original (issue #31).
   */
  r.on("POST", "/api/overlays/:id/copy", async (ctx, { id }) => {
    const { env, request } = ctx;
    const from = assertUuid(id, "id");
    await assertAccess(ctx, "overlay", from, "viewer");
    const { m } = await readBody(request);
    const to = assertUuid(m.id, "id");
    const src = await env.DB.prepare("SELECT o.*, s.project_id FROM overlays o JOIN photos ph ON ph.id = o.photo_id JOIN shots s ON s.id = ph.shot_id WHERE o.id = ?1").bind(from).first<Record<string, unknown> & { photo_id: string; render_key: string | null; project_id: string }>();
    if (!src) throw new HttpError(404, "overlay not found");
    const owner = await clipOwner(ctx, m, src.project_id);
    if (!owner) throw new HttpError(400, "timeline_id and clip_id are required");
    if (await env.DB.prepare("SELECT 1 FROM overlays WHERE id = ?1").bind(to).first()) throw new HttpError(409, "an overlay with that id exists");
    const key = await copyRender(env, "overlays", to, src.render_key);
    await env.DB.prepare(
      "INSERT INTO overlays (id, photo_id, name, description, drawing, presentation, render_key, position, updated_at, timeline_id, clip_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8, ?9, ?10)",
    ).bind(to, src.photo_id, src.name, src.description, src.drawing, src.presentation, key, new Date().toISOString(), owner.timeline_id, owner.clip_id).run();
    return json({ overlay: overlayToApi((await overlay(env, to, false))!) }, 201);
  });

  r.on("GET", "/api/overlays/:id/render", async (ctx, { id }) => {
    const { env, request } = ctx;
    const oid = assertUuid(id, "id");
    await assertAccess(ctx, "overlay", oid, "viewer");
    const row = await env.DB.prepare("SELECT render_key FROM overlays WHERE id = ?1").bind(oid).first<{ render_key: string | null }>();
    if (!row) throw new HttpError(404, "overlay not found");
    return serveRender(env, request, row.render_key);
  });

  // ---------- Sketches ----------
  const sketch = (env: Ctx["env"], id: string, withDrawing: boolean) => env.DB.prepare(
    `SELECT ${SKETCH_COLS}${withDrawing ? ", drawing" : ""} FROM sketches WHERE id = ?1`,
  ).bind(id).first<SketchRow>();

  r.on("GET", "/api/sketches/:id", async (ctx, { id }) => {
    const sid = assertUuid(id, "id");
    await assertAccess(ctx, "sketch", sid, "viewer");
    const row = await sketch(ctx.env, sid, true);
    if (!row) throw new HttpError(404, "sketch not found");
    return json({ sketch: sketchToApi(row) });
  });

  /**
   * Upsert: { shot_id, name, kind?, description?, drawing, aspect, position? } (+ `render` in multipart).
   * Instead of shot_id, timeline_id + clip_id make it a sketch clip's own sketch (issue #31).
   */
  r.on("PUT", "/api/sketches/:id", async (ctx, { id }) => {
    const { env, request } = ctx;
    const sid = assertUuid(id, "id");
    const { m, render } = await readBody(request);
    await accessIfExists(ctx, "sketch", sid, "editor");
    const owner = await clipOwner(ctx, m, null);
    const shotId = owner ? null : assertUuid(m.shot_id, "shot_id");
    const name = assertString(m.name, "name", MAX_COMPOSE_NAME);
    const kind = optText(m.kind, "kind", MAX_SKETCH_KIND);
    const description = optText(m.description, "description", MAX_DESCRIPTION);
    const drawing = drawingJson(m.drawing, false);
    const aspect = assertNumber(m.aspect, "aspect", { min: 0.25, max: 4 });
    if (shotId) await assertAccess(ctx, "shot", shotId, "editor");
    const cur = await env.DB.prepare("SELECT shot_id, render_key, position, timeline_id, clip_id FROM sketches WHERE id = ?1").bind(sid).first<{ shot_id: string | null; render_key: string | null; position: number; timeline_id: string | null; clip_id: string | null }>();
    if (cur && (cur.shot_id !== shotId || !sameOwner(cur, owner))) throw new HttpError(409, "a sketch cannot move to another shot or owner");
    const position = optPosition(m.position) ?? cur?.position ?? (shotId ? ((await env.DB.prepare("SELECT coalesce(max(position), -1) + 1 AS p FROM sketches WHERE shot_id = ?1").bind(shotId).first<{ p: number }>())?.p ?? 0) : 0);
    const now = new Date().toISOString();
    await saveWithRender(env, "sketches", sid, render, cur?.render_key ?? null, (key) => [
      env.DB.prepare(
        `INSERT INTO sketches (id, shot_id, name, kind, description, drawing, aspect, render_key, position, updated_at, timeline_id, clip_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
         ON CONFLICT(id) DO UPDATE SET name = ?3, kind = ?4, description = ?5, drawing = ?6, aspect = ?7, render_key = ?8, position = ?9, updated_at = ?10`,
      ).bind(sid, shotId, name, kind, description, drawing, aspect, key, position, now, owner?.timeline_id ?? null, owner?.clip_id ?? null),
    ]);
    return json({ sketch: sketchToApi((await sketch(env, sid, true))!), shot: shotId ? await loadShot(env, shotId) : null }, cur ? 200 : 201);
  });

  /** JSON { name?, kind?, description?, position? }. */
  r.on("PATCH", "/api/sketches/:id", async (ctx, { id }) => {
    const { env, request } = ctx;
    const sid = assertUuid(id, "id");
    await assertAccess(ctx, "sketch", sid, "editor");
    const { m } = await readBody(request);
    const sets: string[] = [];
    const args: unknown[] = [];
    if (m.name !== undefined) { args.push(assertString(m.name, "name", MAX_COMPOSE_NAME)); sets.push(`name = ?${args.length}`); }
    if (m.kind !== undefined) { args.push(optText(m.kind, "kind", MAX_SKETCH_KIND)); sets.push(`kind = ?${args.length}`); }
    if (m.description !== undefined) { args.push(optText(m.description, "description", MAX_DESCRIPTION)); sets.push(`description = ?${args.length}`); }
    if (m.position !== undefined) { args.push(optPosition(m.position) ?? 0); sets.push(`position = ?${args.length}`); }
    if (!sets.length) throw new HttpError(400, "nothing to update");
    args.push(new Date().toISOString()); sets.push(`updated_at = ?${args.length}`);
    args.push(sid);
    const res = await env.DB.prepare(`UPDATE sketches SET ${sets.join(", ")} WHERE id = ?${args.length}`).bind(...args).run();
    if (!res.meta.changes) throw new HttpError(404, "sketch not found");
    const row = (await sketch(env, sid, true))!;
    return json({ sketch: sketchToApi(row), shot: row.shot_id ? await loadShot(env, row.shot_id) : null });
  });

  r.on("DELETE", "/api/sketches/:id", async (ctx, { id }) => {
    const { env } = ctx;
    const sid = assertUuid(id, "id");
    await assertAccess(ctx, "sketch", sid, "editor");
    const row = await sketch(env, sid, false);
    if (!row) throw new HttpError(404, "sketch not found");
    await env.DB.prepare("DELETE FROM sketches WHERE id = ?1").bind(sid).run();
    if (row.render_key) await env.SHOTS_BUCKET.delete(row.render_key).catch(() => {});
    return json({ deleted: sid, shot: row.shot_id ? await loadShot(env, row.shot_id) : null });
  });

  /** Copy a sketch as the own sketch of a timeline clip: { id, timeline_id, clip_id }. */
  r.on("POST", "/api/sketches/:id/copy", async (ctx, { id }) => {
    const { env, request } = ctx;
    const from = assertUuid(id, "id");
    const fromWs = await assertAccess(ctx, "sketch", from, "viewer");
    const { m } = await readBody(request);
    const to = assertUuid(m.id, "id");
    const src = await env.DB.prepare("SELECT * FROM sketches WHERE id = ?1").bind(from).first<Record<string, unknown> & { render_key: string | null }>();
    if (!src) throw new HttpError(404, "sketch not found");
    const owner = await clipOwner(ctx, m, null);
    if (!owner) throw new HttpError(400, "timeline_id and clip_id are required");
    if (owner.workspace_id !== fromWs) throw new HttpError(400, "a sketch cannot be copied into another workspace");
    if (await env.DB.prepare("SELECT 1 FROM sketches WHERE id = ?1").bind(to).first()) throw new HttpError(409, "a sketch with that id exists");
    const key = await copyRender(env, "sketches", to, src.render_key);
    await env.DB.prepare(
      "INSERT INTO sketches (id, shot_id, name, kind, description, drawing, aspect, render_key, position, updated_at, timeline_id, clip_id) VALUES (?1, NULL, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8, ?9, ?10)",
    ).bind(to, src.name, src.kind, src.description, src.drawing, src.aspect, key, new Date().toISOString(), owner.timeline_id, owner.clip_id).run();
    return json({ sketch: sketchToApi((await sketch(env, to, false))!) }, 201);
  });

  r.on("GET", "/api/sketches/:id/render", async (ctx, { id }) => {
    const { env, request } = ctx;
    const sid = assertUuid(id, "id");
    await assertAccess(ctx, "sketch", sid, "viewer");
    const row = await env.DB.prepare("SELECT render_key FROM sketches WHERE id = ?1").bind(sid).first<{ render_key: string | null }>();
    if (!row) throw new HttpError(404, "sketch not found");
    return serveRender(env, request, row.render_key);
  });
}
