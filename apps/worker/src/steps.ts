import { stepsProblem, validateStepInput, type ShotStep, type StepInput } from "@openclapper/vocab";
import { assertUuid, HttpError, json, readJson, type Router } from "@openclapper/service-kit";
import { copyRender } from "./compose.ts";
import { fileRefCleanup } from "./files.ts";
import type { Ctx } from "./index.ts";
import { loadShot, MAX_PHOTOS_PER_SHOT, objectKey } from "./shots.ts";
import { assertAccess } from "./tenancy.ts";

/**
 * Steps (issue #266): a sequence as a progression, see packages/vocab/src/steps.ts. Studio only
 * (interactive, strict). Shots embed their rows (`stepsFor`); the clients resolve them with
 * `stepsOf`. This module also moves photos between shots (the merge behind "Make a sequence")
 * and copies one photo out as a shot of its own ("Extract"), the two ways a progression is built
 * out of what was captured.
 */

/** Step rows of these shots, keyed by shot id, in order. */
export async function stepsFor(env: Ctx["env"], shotIds: string[]): Promise<Map<string, ShotStep[]>> {
  const out = new Map<string, ShotStep[]>();
  if (shotIds.length === 0) return out;
  const { results } = await env.DB.prepare(
    "SELECT id, shot_id, ordinal, photo_id, framing_id, overlay_id FROM shot_steps WHERE shot_id IN (SELECT value FROM json_each(?1)) ORDER BY shot_id, ordinal",
  ).bind(JSON.stringify(shotIds)).all<ShotStep>();
  for (const s of results) out.set(s.shot_id, [...(out.get(s.shot_id) ?? []), s]);
  return out;
}

const list = (ids: readonly string[]) => JSON.stringify(ids);

/** A live shot's project; 404 for a binned or missing one (the access check ran before). */
async function liveShot(env: Ctx["env"], id: string): Promise<{ project_id: string }> {
  const row = await env.DB.prepare("SELECT project_id, deleted_at FROM shots WHERE id = ?1").bind(id).first<{ project_id: string; deleted_at: string | null }>();
  if (!row || row.deleted_at) throw new HttpError(404, "shot not found");
  return row;
}

/** What steps may reference: the shot's photos, their framings, their shot overlays (clip-owned ones marked). */
async function referable(env: Ctx["env"], photoIds: string[]) {
  const j = list(photoIds);
  const [framings, overlays] = await Promise.all([
    env.DB.prepare("SELECT id, photo_id FROM framings WHERE photo_id IN (SELECT value FROM json_each(?1))").bind(j).all<{ id: string; photo_id: string }>(),
    env.DB.prepare("SELECT id, photo_id, timeline_id FROM overlays WHERE photo_id IN (SELECT value FROM json_each(?1))").bind(j).all<{ id: string; photo_id: string; timeline_id: string | null }>(),
  ]);
  return {
    photos: new Set(photoIds),
    framingPhoto: new Map(framings.results.map((f) => [f.id, f.photo_id])),
    overlayPhoto: new Map(overlays.results.map((o) => [o.id, { photo_id: o.photo_id, clip_owned: o.timeline_id !== null }])),
  };
}

/** The body's `steps`, checked structurally and against what the shot (will) hold. Undefined when absent. */
async function parseSteps(env: Ctx["env"], v: unknown, photoIds: string[]): Promise<StepInput[] | undefined> {
  if (v === undefined) return undefined;
  const err = validateStepInput(v);
  if (err) throw new HttpError(400, err);
  const steps = v as StepInput[];
  const bad = stepsProblem(steps, await referable(env, photoIds));
  if (bad) throw new HttpError(400, bad);
  return steps;
}

/** Replace a shot's steps: delete and insert in order (part of a larger batch). */
function replaceSteps(env: Ctx["env"], shotId: string, steps: StepInput[]): D1PreparedStatement[] {
  return [
    env.DB.prepare("DELETE FROM shot_steps WHERE shot_id = ?1").bind(shotId),
    ...steps.map((s, i) => env.DB.prepare("INSERT INTO shot_steps (id, shot_id, ordinal, photo_id, framing_id, overlay_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
      .bind(s.id, shotId, i, s.photo_id, s.framing_id ?? null, s.overlay_id ?? null)),
  ];
}

export function registerStepRoutes(r: Router<Ctx>) {
  /** `{ steps: [{ id, photo_id, framing_id?, overlay_id? }] }` replaces the list; `[]` = the photos are the steps again. Returns `{ shot }`. */
  r.on("PUT", "/api/shots/:id/steps", async (ctx, { id }) => {
    const { env, request } = ctx;
    const sid = assertUuid(id, "id");
    await assertAccess(ctx, "shot", sid, "editor");
    await liveShot(env, sid);
    const b = await readJson<Record<string, unknown>>(request);
    const photoIds = (await env.DB.prepare("SELECT id FROM photos WHERE shot_id = ?1").bind(sid).all<{ id: string }>()).results.map((p) => p.id);
    const steps = await parseSteps(env, b.steps ?? [], photoIds);
    await env.DB.batch([...replaceSteps(env, sid, steps ?? []), env.DB.prepare("UPDATE shots SET updated_at = ?1 WHERE id = ?2").bind(new Date().toISOString(), sid)]);
    return json({ shot: await loadShot(env, sid) });
  });

  /**
   * Move photos of other shots into this one (the merge behind "Make a sequence"): `{ photo_ids, steps? }`.
   * The photos must be in live shots of the same project; they are appended in the given order with
   * their framings and overlays (photo-keyed, so nothing to do). A source shot left without photos is
   * deleted for good, its sketches moved here (a photo-less shot in the bin could not be restored to
   * anything). Timeline clips of the moved photos leave their sequence blocks (a block holds one
   * shot's photos; the Studio regroups what it is working on). Returns `{ shot, removed_shot_ids }`.
   */
  r.on("POST", "/api/shots/:id/photos", async (ctx, { id }) => {
    const { env, request } = ctx;
    const sid = assertUuid(id, "id");
    await assertAccess(ctx, "shot", sid, "editor");
    const target = await liveShot(env, sid);
    const b = await readJson<Record<string, unknown>>(request);
    if (!Array.isArray(b.photo_ids) || b.photo_ids.length === 0) throw new HttpError(400, "photo_ids must be a non-empty array");
    const moving = [...new Set(b.photo_ids.map((x, i) => assertUuid(x, `photo_ids[${i}]`)))];
    if (moving.length > MAX_PHOTOS_PER_SHOT) throw new HttpError(413, `at most ${MAX_PHOTOS_PER_SHOT} photos`);
    const { results: rows } = await env.DB.prepare(
      `SELECT ph.id, ph.shot_id, s.project_id, s.deleted_at FROM photos ph JOIN shots s ON s.id = ph.shot_id WHERE ph.id IN (SELECT value FROM json_each(?1))`,
    ).bind(list(moving)).all<{ id: string; shot_id: string; project_id: string; deleted_at: string | null }>();
    // Unknown, another project's (that covers another workspace's) and binned photos all read the same, so ids reveal nothing.
    if (rows.length !== moving.length || rows.some((p) => p.project_id !== target.project_id || p.deleted_at)) throw new HttpError(400, "photo_ids must be photos of live shots in the same project");
    if (rows.some((p) => p.shot_id === sid)) throw new HttpError(400, "a photo is already in this shot");
    const own = (await env.DB.prepare("SELECT id, ordinal FROM photos WHERE shot_id = ?1 ORDER BY ordinal").bind(sid).all<{ id: string; ordinal: number }>()).results;
    if (own.length + moving.length > MAX_PHOTOS_PER_SHOT) throw new HttpError(413, `a shot holds at most ${MAX_PHOTOS_PER_SHOT} photos (it has ${own.length}, this adds ${moving.length})`);
    const steps = await parseSteps(env, b.steps, [...own.map((p) => p.id), ...moving]);

    const sources = [...new Set(rows.map((p) => p.shot_id))];
    const { results: left } = await env.DB.prepare(
      "SELECT shot_id, count(*) AS n FROM photos WHERE shot_id IN (SELECT value FROM json_each(?1)) AND id NOT IN (SELECT value FROM json_each(?2)) GROUP BY shot_id",
    ).bind(list(sources), list(moving)).all<{ shot_id: string; n: number }>();
    const keep = new Set(left.map((x) => x.shot_id));
    const emptied = sources.filter((s) => !keep.has(s));
    const sketchBase = (await env.DB.prepare("SELECT coalesce(max(position), -1) + 1 AS p FROM sketches WHERE shot_id = ?1").bind(sid).first<{ p: number }>())?.p ?? 0;
    const nextOrdinal = (own.at(-1)?.ordinal ?? -1) + 1;
    const now = new Date().toISOString();
    const stmts: D1PreparedStatement[] = [
      ...moving.map((pid, k) => env.DB.prepare("UPDATE photos SET shot_id = ?1, ordinal = ?2 WHERE id = ?3").bind(sid, nextOrdinal + k, pid)),
      env.DB.prepare("DELETE FROM shot_steps WHERE photo_id IN (SELECT value FROM json_each(?1))").bind(list(moving)),
      env.DB.prepare("UPDATE timeline_clips SET group_id = NULL WHERE photo_id IN (SELECT value FROM json_each(?1))").bind(list(moving)),
    ];
    if (emptied.length) {
      const j = list(emptied);
      stmts.push(
        env.DB.prepare("UPDATE sketches SET shot_id = ?1, position = position + ?2 WHERE shot_id IN (SELECT value FROM json_each(?3))").bind(sid, sketchBase, j),
        env.DB.prepare("DELETE FROM day_shots WHERE shot_id IN (SELECT value FROM json_each(?1))").bind(j),
        ...fileRefCleanup(env, "shot", j),
        env.DB.prepare("DELETE FROM shots WHERE id IN (SELECT value FROM json_each(?1))").bind(j),
      );
    }
    stmts.push(env.DB.prepare("UPDATE shots SET captured_at = (SELECT min(timestamp) FROM photos WHERE shot_id = ?1), updated_at = ?2 WHERE id = ?1").bind(sid, now));
    if (steps) stmts.push(...replaceSteps(env, sid, steps));
    await env.DB.batch(stmts);
    return json({ shot: await loadShot(env, sid), removed_shot_ids: emptied });
  });

  /**
   * Copy one photo out as a shot of its own ("Extract", a copy, never a move): `{ id?, framing_id?, overlay_id? }`.
   * The new shot (`id`, else a fresh one) takes the tags, description and state; the photo row is
   * copied with its own R2 object (one object per photo stays the rule, so neither shot's delete
   * touches the other), and so are its framings and shot overlays with their renders. `framing_id`
   * (a framing of the photo, say the step's) becomes the copy's root, else the photo's root carries
   * over. No link back. Returns `{ shot }`, 201.
   */
  r.on("POST", "/api/shots/:id/photos/:photo/extract", async (ctx, { id, photo }) => {
    const { env, request } = ctx;
    const sid = assertUuid(id, "id");
    const pid = assertUuid(photo, "photo");
    const ws = await assertAccess(ctx, "shot", sid, "editor");
    await liveShot(env, sid);
    const b = await readJson<Record<string, unknown>>(request);
    const newShot = b.id === undefined || b.id === null ? crypto.randomUUID() : assertUuid(b.id, "id");
    const framingId = b.framing_id == null ? null : assertUuid(b.framing_id, "framing_id");
    const overlayId = b.overlay_id == null ? null : assertUuid(b.overlay_id, "overlay_id");
    if (await env.DB.prepare("SELECT 1 FROM shots WHERE id = ?1").bind(newShot).first()) throw new HttpError(409, "a shot with this id exists");

    const src = await env.DB.prepare("SELECT * FROM photos WHERE id = ?1 AND shot_id = ?2").bind(pid, sid).first<Record<string, unknown> & { ordinal: number; r2_object_key: string; root_framing_id: string | null; timestamp: string }>();
    if (!src) throw new HttpError(404, "photo not found");
    const shot = (await env.DB.prepare("SELECT * FROM shots WHERE id = ?1").bind(sid).first<Record<string, unknown> & { name: string | null }>())!;
    const [framings, overlays] = await Promise.all([
      env.DB.prepare("SELECT * FROM framings WHERE photo_id = ?1 ORDER BY position, created_at").bind(pid).all<Record<string, unknown> & { id: string; frame: string }>(),
      env.DB.prepare("SELECT * FROM overlays WHERE photo_id = ?1 AND timeline_id IS NULL ORDER BY position, created_at").bind(pid).all<Record<string, unknown> & { id: string; render_key: string | null; presentation: string }>(),
    ]);
    if (framingId && !framings.results.some((f) => f.id === framingId)) throw new HttpError(400, "framing_id is not a framing of this photo");
    if (overlayId && !overlays.results.some((o) => o.id === overlayId)) throw new HttpError(400, "overlay_id is not an overlay of this photo");

    const obj = await env.SHOTS_BUCKET.get(src.r2_object_key);
    if (!obj) throw new HttpError(404, "image missing in storage");
    const newPhoto = crypto.randomUUID();
    const ext = src.r2_object_key.split(".").pop() ?? "jpg";
    const key = objectKey(newPhoto, ext);
    const written: string[] = [key];
    const framingIds = new Map(framings.results.map((f) => [f.id, crypto.randomUUID()]));
    const overlayIds = new Map(overlays.results.map((o) => [o.id, crypto.randomUUID()]));
    try {
      await env.SHOTS_BUCKET.put(key, obj.body, { httpMetadata: obj.httpMetadata, customMetadata: { shot_id: newShot, photo_id: newPhoto, workspace_id: ws } });
      const renders = new Map<string, string | null>();
      for (const o of overlays.results) {
        const k = await copyRender(env, "overlays", overlayIds.get(o.id)!, o.render_key);
        if (k) written.push(k);
        renders.set(o.id, k);
      }
      const now = new Date().toISOString();
      const name = shot.name ? `${shot.name} · photo ${src.ordinal + 1}`.slice(0, 120) : null;
      const root = framingId ?? src.root_framing_id;
      const cols = (row: Record<string, unknown>, omit: string[]) => Object.keys(row).filter((k) => !omit.includes(k));
      const insertCopy = (table: string, row: Record<string, unknown>, set: Record<string, unknown>, omit: string[]) => {
        const keys = [...cols(row, [...omit, ...Object.keys(set)]), ...Object.keys(set)];
        const values = keys.map((k) => (k in set ? set[k] : row[k]));
        return env.DB.prepare(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map((_, i) => `?${i + 1}`).join(", ")})`).bind(...values);
      };
      const stmts = [
        insertCopy("shots", shot, { id: newShot, name, captured_at: src.timestamp, created_at: now, updated_at: now, deleted_at: null, deleted_with: null }, []),
        insertCopy("photos", src, { id: newPhoto, shot_id: newShot, ordinal: 0, r2_object_key: key, root_framing_id: null, created_at: now }, []),
        ...framings.results.map((f) => insertCopy("framings", f, { id: framingIds.get(f.id), photo_id: newPhoto, created_at: now, updated_at: now }, [])),
        ...overlays.results.map((o) => {
          const pres = JSON.parse(o.presentation) as { framing_id?: string | null };
          if (pres.framing_id) pres.framing_id = framingIds.get(pres.framing_id) ?? null;
          return insertCopy("overlays", o, { id: overlayIds.get(o.id), photo_id: newPhoto, presentation: JSON.stringify(pres), render_key: renders.get(o.id) ?? null, created_at: now, updated_at: now }, []);
        }),
      ];
      if (root && framingIds.has(root)) stmts.push(env.DB.prepare("UPDATE photos SET root_framing_id = ?1 WHERE id = ?2").bind(framingIds.get(root), newPhoto));
      await env.DB.batch(stmts);
    } catch (err) {
      await Promise.all(written.map((k) => env.SHOTS_BUCKET.delete(k).catch(() => {})));
      throw err;
    }
    return json({ shot: await loadShot(env, newShot) }, 201);
  });
}
