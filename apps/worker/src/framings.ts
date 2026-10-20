import { MAX_FRAMING_NAME, validateFrame, withCentre, type Frame } from "@openclapper/vocab";
import { assertNumber, assertString, assertUuid, HttpError, json, readJson, type Router } from "@openclapper/service-kit";
import type { Ctx } from "./index.ts";
import { loadShot } from "./shots.ts";
import { accessIfExists, assertAccess, workspaceOf } from "./tenancy.ts";

/**
 * Framings (issue #29): saved re-framings of one photo and the photo's root framing. Studio
 * only (interactive, strict). Shots embed them per photo (`framingsFor`).
 */

export interface FramingRow { id: string; photo_id: string; shot_id: string; name: string; rig_id: string | null; lens_mm: number; frame: string; position: number; created_at: string; updated_at: string | null }
export const framingToApi = (r: FramingRow) => ({ id: r.id, photo_id: r.photo_id, name: r.name, rig_id: r.rig_id, lens_mm: r.lens_mm, frame: JSON.parse(r.frame) as Frame, position: r.position, created_at: r.created_at, updated_at: r.updated_at });
export type FramingApi = ReturnType<typeof framingToApi>;

/** Framings of every photo of these shots, keyed by photo id, in order. */
export async function framingsFor(env: Ctx["env"], shotIds: string[]): Promise<Map<string, FramingApi[]>> {
  const out = new Map<string, FramingApi[]>();
  if (shotIds.length === 0) return out;
  const { results } = await env.DB.prepare(
    `SELECT f.*, ph.shot_id FROM framings f JOIN photos ph ON ph.id = f.photo_id
     WHERE ph.shot_id IN (SELECT value FROM json_each(?1)) ORDER BY f.photo_id, f.position, f.created_at`,
  ).bind(JSON.stringify(shotIds)).all<FramingRow>();
  for (const r of results) out.set(r.photo_id, [...(out.get(r.photo_id) ?? []), framingToApi(r)]);
  return out;
}

async function shotOfPhoto(env: Ctx["env"], photoId: string): Promise<string> {
  const row = await env.DB.prepare("SELECT shot_id FROM photos WHERE id = ?1").bind(photoId).first<{ shot_id: string }>();
  if (!row) throw new HttpError(404, "photo not found");
  return row.shot_id;
}

export function registerFramingRoutes(r: Router<Ctx>) {
  /**
   * Upsert: { photo_id, name, rig_id?, lens_mm, frame: { width_fraction, height_fraction, x, y }, root? }.
   * The centre is clamped to the photo. `root: true` also makes it the photo's root. Returns the shot.
   */
  r.on("PUT", "/api/framings/:id", async (ctx, { id }) => {
    const { env, request } = ctx;
    const fid = assertUuid(id, "id");
    const b = await readJson<Record<string, unknown>>(request);
    const photoId = assertUuid(b.photo_id, "photo_id");
    const name = assertString(b.name, "name", MAX_FRAMING_NAME);
    const rigId = b.rig_id === undefined || b.rig_id === null ? null : assertUuid(b.rig_id, "rig_id");
    const lens = assertNumber(b.lens_mm, "lens_mm", { min: 1, max: 2000 });
    const err = validateFrame(b.frame);
    if (err) throw new HttpError(400, err);
    const frame = JSON.stringify(withCentre(b.frame as Frame));
    const ws = await assertAccess(ctx, "photo", photoId, "editor");
    await accessIfExists(ctx, "framing", fid, "editor");
    const shotId = await shotOfPhoto(env, photoId);
    // A rig of the photo's workspace only.
    if (rigId && (await workspaceOf(env, "preset", rigId)) !== ws) throw new HttpError(400, "rig_id does not exist");
    const cur = await env.DB.prepare("SELECT photo_id, position FROM framings WHERE id = ?1").bind(fid).first<{ photo_id: string; position: number }>();
    if (cur && cur.photo_id !== photoId) throw new HttpError(409, "a framing cannot move to another photo");
    const position = cur?.position ?? ((await env.DB.prepare("SELECT coalesce(max(position), -1) + 1 AS p FROM framings WHERE photo_id = ?1").bind(photoId).first<{ p: number }>())?.p ?? 0);
    const now = new Date().toISOString();
    const stmts = [env.DB.prepare(
      `INSERT INTO framings (id, photo_id, name, rig_id, lens_mm, frame, position, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT(id) DO UPDATE SET name = ?3, rig_id = ?4, lens_mm = ?5, frame = ?6, updated_at = ?8`,
    ).bind(fid, photoId, name, rigId, lens, frame, position, now)];
    if (b.root === true) stmts.push(env.DB.prepare("UPDATE photos SET root_framing_id = ?1 WHERE id = ?2").bind(fid, photoId));
    await env.DB.batch(stmts);
    return json({ shot: await loadShot(env, shotId) }, cur ? 200 : 201);
  });

  r.on("DELETE", "/api/framings/:id", async (ctx, { id }) => {
    const { env } = ctx;
    const fid = assertUuid(id, "id");
    await assertAccess(ctx, "framing", fid, "editor");
    const row = await env.DB.prepare("SELECT photo_id FROM framings WHERE id = ?1").bind(fid).first<{ photo_id: string }>();
    if (!row) throw new HttpError(404, "framing not found");
    // A root that is deleted falls back to as captured (ON DELETE SET NULL); overlays and clips keep their frame copy.
    await env.DB.prepare("DELETE FROM framings WHERE id = ?1").bind(fid).run();
    return json({ deleted: fid, shot: await loadShot(env, await shotOfPhoto(env, row.photo_id)) });
  });

  /** { framing_id: uuid | null } sets (or clears: as captured) the photo's root framing. */
  r.on("PUT", "/api/photos/:id/root", async (ctx, { id }) => {
    const { env, request } = ctx;
    const pid = assertUuid(id, "id");
    await assertAccess(ctx, "photo", pid, "editor");
    const b = await readJson<Record<string, unknown>>(request);
    const fid = b.framing_id === null || b.framing_id === undefined ? null : assertUuid(b.framing_id, "framing_id");
    const shotId = await shotOfPhoto(env, pid);
    if (fid) {
      const f = await env.DB.prepare("SELECT photo_id FROM framings WHERE id = ?1").bind(fid).first<{ photo_id: string }>();
      if (!f || f.photo_id !== pid) throw new HttpError(400, "framing_id is not a framing of this photo");
    }
    await env.DB.prepare("UPDATE photos SET root_framing_id = ?1 WHERE id = ?2").bind(fid, pid).run();
    return json({ shot: await loadShot(env, shotId) });
  });
}
