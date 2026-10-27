import { MAX_LAYERS, validateLayerInput, type Layer, type LayerInput, type StepBake } from "@openclapper/vocab";
import { assertUuid, HttpError, json, readJson, type Router } from "@openclapper/service-kit";
import { assertBodySize, imageExt, imageTypeOf, preconditionFailed } from "./images.ts";
import type { Ctx } from "./index.ts";
import { loadShot } from "./shots.ts";
import { accessIfExists, assertAccess } from "./tenancy.ts";

/**
 * Layers and bakes (epic #275, vocab layers.ts). A shot's layers stack over its footage; a timeline
 * clip's own layers (timeline_id + clip_id) stack over the clip. The Studio edits them and uploads
 * one flattened image per step (a bake) with the hash of what it was made from; the phone shows a
 * bake when its hash matches. Interactive edits, so validation is strict.
 */

interface LayerRow {
  id: string; shot_id: string; kind: string; name: string; description: string | null; position: number; visible: number; locked: number; opacity: number;
  space: string; photo_id: string | null; range: string | null; shapes?: string | null; look: string | null; timeline_id: string | null; clip_id: string | null;
  created_at: string; updated_at: string | null;
}
const COLS = "id, shot_id, kind, name, description, position, visible, locked, opacity, space, photo_id, range, look, timeline_id, clip_id, created_at, updated_at";

export function layerToApi(r: LayerRow): Layer {
  return {
    id: r.id, shot_id: r.shot_id, kind: r.kind as Layer["kind"], name: r.name, description: r.description, position: r.position,
    visible: r.visible === 1, locked: r.locked === 1, opacity: r.opacity, space: r.space as Layer["space"], photo_id: r.photo_id,
    range: r.range === null ? null : (JSON.parse(r.range) as string[]), look: r.look === null ? null : (JSON.parse(r.look) as Layer["look"]),
    ...(r.shapes !== undefined ? { shapes: r.shapes === null ? [] : (JSON.parse(r.shapes) as Layer["shapes"]) } : {}),
    timeline_id: r.timeline_id, clip_id: r.clip_id, created_at: r.created_at, updated_at: r.updated_at,
  };
}

/** The shots' own layers (not clips'), without shapes, keyed by shot id, in stack order. */
export async function layersFor(env: Ctx["env"], shotIds: string[]): Promise<Map<string, Layer[]>> {
  const out = new Map<string, Layer[]>();
  if (!shotIds.length) return out;
  const { results } = await env.DB.prepare(`SELECT ${COLS} FROM layers WHERE shot_id IN (SELECT value FROM json_each(?1)) AND timeline_id IS NULL ORDER BY shot_id, position, created_at, id`)
    .bind(JSON.stringify(shotIds)).all<LayerRow>();
  for (const r of results) out.set(r.shot_id, [...(out.get(r.shot_id) ?? []), layerToApi(r)]);
  return out;
}

/** Timeline clips' own layers, without shapes, keyed by timeline id. */
export async function clipLayersFor(env: Ctx["env"], timelineIds: string[]): Promise<Map<string, Layer[]>> {
  const out = new Map<string, Layer[]>();
  if (!timelineIds.length) return out;
  const { results } = await env.DB.prepare(`SELECT ${COLS} FROM layers WHERE timeline_id IN (SELECT value FROM json_each(?1)) ORDER BY timeline_id, position, created_at, id`)
    .bind(JSON.stringify(timelineIds)).all<LayerRow>();
  for (const r of results) out.set(r.timeline_id!, [...(out.get(r.timeline_id!) ?? []), layerToApi(r)]);
  return out;
}

/** Stored bakes of these shots, keyed by shot id. The URL carries the hash, so the image route can cache for a year. */
export async function bakesFor(env: Ctx["env"], shotIds: string[]): Promise<Map<string, StepBake[]>> {
  const out = new Map<string, StepBake[]>();
  if (!shotIds.length) return out;
  const { results } = await env.DB.prepare("SELECT shot_id, step_key, hash FROM step_bakes WHERE shot_id IN (SELECT value FROM json_each(?1))").bind(JSON.stringify(shotIds)).all<{ shot_id: string; step_key: string; hash: string }>();
  for (const r of results) out.set(r.shot_id, [...(out.get(r.shot_id) ?? []), { step_key: r.step_key, hash: r.hash, url: `/api/shots/${r.shot_id}/bakes/${r.step_key}?v=${r.hash}` }]);
  return out;
}

/** R2 keys of a shot's bakes (deleted with the shot). */
export async function bakeKeysOf(env: Ctx["env"], shotId: string): Promise<string[]> {
  return (await env.DB.prepare("SELECT render_key AS k FROM step_bakes WHERE shot_id = ?1").bind(shotId).all<{ k: string }>()).results.map((r) => r.k);
}

/** The step keys a shot has now: its stored steps, else its photos (vocab bakeKey). */
async function stepKeysOf(env: Ctx["env"], shotId: string): Promise<Set<string>> {
  const stored = (await env.DB.prepare("SELECT id FROM shot_steps WHERE shot_id = ?1").bind(shotId).all<{ id: string }>()).results.map((r) => r.id);
  if (stored.length) return new Set(stored);
  return new Set((await env.DB.prepare("SELECT id FROM photos WHERE shot_id = ?1").bind(shotId).all<{ id: string }>()).results.map((r) => r.id));
}

/** Bakes for steps that no longer exist go, with their images. */
export async function pruneBakes(env: Ctx["env"], shotId: string): Promise<void> {
  const keys = await stepKeysOf(env, shotId);
  const gone = (await env.DB.prepare("SELECT step_key, render_key FROM step_bakes WHERE shot_id = ?1").bind(shotId).all<{ step_key: string; render_key: string }>()).results.filter((b) => !keys.has(b.step_key));
  if (!gone.length) return;
  await env.DB.prepare("DELETE FROM step_bakes WHERE shot_id = ?1 AND step_key IN (SELECT value FROM json_each(?2))").bind(shotId, JSON.stringify(gone.map((b) => b.step_key))).run();
  await env.SHOTS_BUCKET.delete(gone.map((b) => b.render_key)).catch(() => {});
}

const MAX_BAKE_BYTES = 6 * 1024 * 1024;
const MAX_SHAPES_BYTES = 1024 * 1024;

export function registerLayerRoutes(r: Router<Ctx>) {
  const one = (env: Ctx["env"], id: string) => env.DB.prepare(`SELECT ${COLS}, shapes FROM layers WHERE id = ?1`).bind(id).first<LayerRow>();

  /** A shot's own layers with their shapes (the Studio's editor and baker). */
  r.on("GET", "/api/shots/:id/layers", async (ctx, { id }) => {
    const sid = assertUuid(id, "id");
    await assertAccess(ctx, "shot", sid, "viewer");
    const { results } = await ctx.env.DB.prepare(`SELECT ${COLS}, shapes FROM layers WHERE shot_id = ?1 AND timeline_id IS NULL ORDER BY position, created_at, id`).bind(sid).all<LayerRow>();
    return json({ layers: results.map(layerToApi) });
  });

  r.on("GET", "/api/layers/:id", async (ctx, { id }) => {
    const lid = assertUuid(id, "id");
    await assertAccess(ctx, "layer", lid, "viewer");
    const row = await one(ctx.env, lid);
    if (!row) throw new HttpError(404, "layer not found");
    return json({ layer: layerToApi(row) });
  });

  /**
   * Upsert a layer: { shot_id, kind, name, description?, position, visible, locked, opacity, space,
   * photo_id?, range?, shapes?, look?, timeline_id?, clip_id? }. The shot, the kind and the owner
   * (shot or clip) are fixed at creation. A photo-space layer's photo is one of the shot's; a range
   * lists stored steps of the shot; a clip owner is a timeline in the shot's project.
   */
  r.on("PUT", "/api/layers/:id", async (ctx, { id }) => {
    const { env, request } = ctx;
    const lid = assertUuid(id, "id");
    assertBodySize(request, MAX_SHAPES_BYTES + 64 * 1024);
    const b = await readJson<Record<string, unknown>>(request);
    const err = validateLayerInput(b);
    if (err) throw new HttpError(400, err);
    const l = b as unknown as LayerInput;
    await assertAccess(ctx, "shot", l.shot_id, "editor");
    await accessIfExists(ctx, "layer", lid, "editor");
    const shot = await env.DB.prepare("SELECT project_id FROM shots WHERE id = ?1").bind(l.shot_id).first<{ project_id: string }>();
    if (!shot) throw new HttpError(404, "shot not found");
    const cur = await env.DB.prepare("SELECT shot_id, kind, timeline_id, clip_id FROM layers WHERE id = ?1").bind(lid).first<{ shot_id: string; kind: string; timeline_id: string | null; clip_id: string | null }>();
    if (cur && (cur.shot_id !== l.shot_id || cur.kind !== l.kind || (cur.timeline_id ?? null) !== (l.timeline_id ?? null) || (cur.clip_id ?? null) !== (l.clip_id ?? null))) throw new HttpError(409, "a layer cannot change its shot, kind or owner");
    if (l.photo_id && !(await env.DB.prepare("SELECT 1 FROM photos WHERE id = ?1 AND shot_id = ?2").bind(l.photo_id, l.shot_id).first())) throw new HttpError(400, "photo_id is not a photo of the shot");
    if (l.range?.length) {
      const known = (await env.DB.prepare("SELECT count(*) AS n FROM shot_steps WHERE shot_id = ?1 AND id IN (SELECT value FROM json_each(?2))").bind(l.shot_id, JSON.stringify(l.range)).first<{ n: number }>())?.n ?? 0;
      if (known !== l.range.length) throw new HttpError(400, "range lists a step that is not a stored step of the shot");
    }
    if (l.timeline_id) {
      await assertAccess(ctx, "timeline", l.timeline_id, "editor");
      const t = await env.DB.prepare("SELECT project_id FROM timelines WHERE id = ?1").bind(l.timeline_id).first<{ project_id: string }>();
      if (!t || t.project_id !== shot.project_id) throw new HttpError(400, "the shot is not in the timeline's project");
    }
    if (!cur) {
      const n = (await env.DB.prepare(`SELECT count(*) AS n FROM layers WHERE shot_id = ?1 AND ${l.timeline_id ? "clip_id = ?2" : "timeline_id IS NULL"}`).bind(l.shot_id, ...(l.timeline_id ? [l.clip_id] : [])).first<{ n: number }>())?.n ?? 0;
      if (n >= MAX_LAYERS) throw new HttpError(413, `at most ${MAX_LAYERS} layers`);
    }
    const shapes = l.kind === "drawing" ? JSON.stringify(l.shapes ?? []) : null;
    if (shapes && shapes.length > MAX_SHAPES_BYTES) throw new HttpError(413, "shapes too large");
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO layers (id, shot_id, kind, name, description, position, visible, locked, opacity, space, photo_id, range, shapes, look, timeline_id, clip_id, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
       ON CONFLICT(id) DO UPDATE SET name = ?4, description = ?5, position = ?6, visible = ?7, locked = ?8, opacity = ?9, space = ?10, photo_id = ?11, range = ?12, shapes = ?13, look = ?14, updated_at = ?17`,
    ).bind(lid, l.shot_id, l.kind, l.name.trim(), l.description?.trim() || null, l.position, l.visible ? 1 : 0, l.locked ? 1 : 0, l.opacity, l.space, l.photo_id ?? null,
      l.range == null ? null : JSON.stringify(l.range), shapes, l.kind === "adjustment" ? JSON.stringify(l.look) : null, l.timeline_id ?? null, l.clip_id ?? null, now).run();
    return json({ layer: layerToApi((await one(env, lid))!), shot: await loadShot(env, l.shot_id) }, cur ? 200 : 201);
  });

  r.on("DELETE", "/api/layers/:id", async (ctx, { id }) => {
    const { env } = ctx;
    const lid = assertUuid(id, "id");
    await assertAccess(ctx, "layer", lid, "editor");
    const row = await env.DB.prepare("SELECT shot_id FROM layers WHERE id = ?1").bind(lid).first<{ shot_id: string }>();
    if (!row) throw new HttpError(404, "layer not found");
    await env.DB.prepare("DELETE FROM layers WHERE id = ?1").bind(lid).run();
    return json({ deleted: lid, shot: await loadShot(env, row.shot_id) });
  });

  /** Copy a layer as the own layer of a timeline clip: { id, timeline_id, clip_id } (a duplicated clip gets its own). */
  r.on("POST", "/api/layers/:id/copy", async (ctx, { id }) => {
    const { env, request } = ctx;
    const from = assertUuid(id, "id");
    await assertAccess(ctx, "layer", from, "viewer");
    const b = await readJson<Record<string, unknown>>(request);
    const to = assertUuid(b.id, "id");
    const timelineId = assertUuid(b.timeline_id, "timeline_id");
    const clipId = assertUuid(b.clip_id, "clip_id");
    await assertAccess(ctx, "timeline", timelineId, "editor");
    const src = await env.DB.prepare("SELECT l.*, s.project_id FROM layers l JOIN shots s ON s.id = l.shot_id WHERE l.id = ?1").bind(from).first<LayerRow & { project_id: string }>();
    if (!src) throw new HttpError(404, "layer not found");
    const t = await env.DB.prepare("SELECT project_id FROM timelines WHERE id = ?1").bind(timelineId).first<{ project_id: string }>();
    if (!t || t.project_id !== src.project_id) throw new HttpError(400, "the layer's shot is not in the timeline's project");
    if (await env.DB.prepare("SELECT 1 FROM layers WHERE id = ?1").bind(to).first()) throw new HttpError(409, "a layer with that id exists");
    await env.DB.prepare(
      `INSERT INTO layers (id, shot_id, kind, name, description, position, visible, locked, opacity, space, photo_id, range, shapes, look, timeline_id, clip_id, updated_at)
       SELECT ?1, shot_id, kind, name, description, position, visible, locked, opacity, space, photo_id, NULL, shapes, look, ?2, ?3, ?4 FROM layers WHERE id = ?5`,
    ).bind(to, timelineId, clipId, new Date().toISOString(), from).run();
    return json({ layer: layerToApi((await one(env, to))!) }, 201);
  });

  /**
   * A step's bake: multipart `metadata` { hash } + `image` (JPEG, PNG or WebP by its bytes). The key
   * is a stored step of the shot, or one of its photos when it has no stored steps. Bakes of steps
   * that are gone are removed on the way. Returns { shot }.
   */
  r.on("PUT", "/api/shots/:id/bakes/:key", async (ctx, { id, key }) => {
    const { env, request } = ctx;
    const sid = assertUuid(id, "id");
    const k = assertUuid(key, "key");
    const ws = await assertAccess(ctx, "shot", sid, "editor");
    assertBodySize(request, MAX_BAKE_BYTES + 64 * 1024);
    const ct = request.headers.get("content-type") ?? "";
    if (!ct.startsWith("multipart/form-data")) throw new HttpError(415, "expected multipart/form-data");
    const form = await request.formData();
    let hash: unknown;
    try { hash = (JSON.parse(String(form.get("metadata") ?? "{}")) as { hash?: unknown }).hash; } catch { throw new HttpError(400, "metadata is not JSON"); }
    if (typeof hash !== "string" || !/^[0-9a-f]{16}$/.test(hash)) throw new HttpError(400, "hash must be 16 hex characters");
    const image = form.get("image");
    if (!(image instanceof File) || image.size === 0 || image.size > MAX_BAKE_BYTES) throw new HttpError(413, "image missing, empty or too large");
    const type = await imageTypeOf(image, "image");
    if (!(await stepKeysOf(env, sid)).has(k)) throw new HttpError(400, "key is not a step of the shot");
    const old = await env.DB.prepare("SELECT render_key FROM step_bakes WHERE shot_id = ?1 AND step_key = ?2").bind(sid, k).first<{ render_key: string }>();
    const r2 = `bakes/${sid}/${k}-${hash}.${imageExt(type)}`;
    await env.SHOTS_BUCKET.put(r2, image.stream(), { httpMetadata: { contentType: type }, customMetadata: { shot_id: sid, step_key: k, workspace_id: ws } });
    await env.DB.prepare(
      `INSERT INTO step_bakes (shot_id, step_key, hash, render_key, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(shot_id, step_key) DO UPDATE SET hash = ?3, render_key = ?4, updated_at = ?5`,
    ).bind(sid, k, hash, r2, new Date().toISOString()).run();
    if (old && old.render_key !== r2) await env.SHOTS_BUCKET.delete(old.render_key).catch(() => {});
    await pruneBakes(env, sid);
    return json({ shot: await loadShot(env, sid) });
  });

  r.on("GET", "/api/shots/:id/bakes/:key", async (ctx, { id, key }) => {
    const { env, request } = ctx;
    const sid = assertUuid(id, "id");
    const k = assertUuid(key, "key");
    await assertAccess(ctx, "shot", sid, "viewer");
    const row = await env.DB.prepare("SELECT render_key FROM step_bakes WHERE shot_id = ?1 AND step_key = ?2").bind(sid, k).first<{ render_key: string }>();
    if (!row) throw new HttpError(404, "no bake for this step");
    const obj = await env.SHOTS_BUCKET.get(row.render_key, { onlyIf: request.headers });
    if (!obj) throw new HttpError(404, "bake missing in storage");
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

