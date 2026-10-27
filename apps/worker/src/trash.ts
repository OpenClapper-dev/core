import { FILE_RESOURCE_TYPES, MAX_FOLDER_NAME, TRASH_RETENTION_DAYS, TRASH_TYPES, type FileResourceType, type TrashEntry, type TrashType } from "@openclapper/vocab";
import { deleteClipCompose, renderKeysOf } from "./compose.ts";
import { fileRefCleanup, RESOURCE_TABLE } from "./files.ts";
import { assertEnum, assertUuid, HttpError, json, type Router } from "@openclapper/service-kit";
import type { Ctx, Env } from "./index.ts";
import { assertAccess } from "./tenancy.ts";
import { ownedBy } from "./timelines.ts";

/**
 * The recycle bin (epic #90, issue #91). Deleting a file or a folder only marks it (`deleted_at`);
 * every list leaves it out. A folder takes its whole subtree along: the subfolders and the files
 * placed in them carry `deleted_with` = that folder, so restoring it brings them all back. Rows
 * are purged for real (R2 objects included) when the bin is emptied, one at a time, or by the
 * daily cron once they are TRASH_RETENTION_DAYS old.
 *
 * What is not kept while binned: a shot's clips on timelines and its places on shooting days.
 * Timelines and days are saved whole by the Studio, so hidden rows would be dropped by their
 * next save anyway; removing them at once keeps that honest (docs/features/files.md).
 */

const now = () => new Date().toISOString();
const ids = (list: readonly string[]) => JSON.stringify(list);

/** Statements removing a shot's timeline clips (and the clips' own layers) and day places. */
async function shotsLeave(env: Env, shotIds: string): Promise<D1PreparedStatement[]> {
  const onPhotos = "photo_id IN (SELECT id FROM photos WHERE shot_id IN (SELECT value FROM json_each(?1)))";
  await deleteClipCompose(env, {
    reads: [],
    deletes: [env.DB.prepare("DELETE FROM layers WHERE shot_id IN (SELECT value FROM json_each(?1)) AND timeline_id IS NOT NULL").bind(shotIds)],
  });
  return [
    env.DB.prepare(`DELETE FROM timeline_clips WHERE ${onPhotos}`).bind(shotIds),
    env.DB.prepare("DELETE FROM day_shots WHERE shot_id IN (SELECT value FROM json_each(?1))").bind(shotIds),
  ];
}

/** Move one file to the bin. 404 when it does not exist or is binned already. */
export async function binResource(env: Env, type: FileResourceType, id: string) {
  const table = RESOURCE_TABLE[type];
  if (!(await env.DB.prepare(`SELECT 1 FROM ${table} WHERE id = ?1 AND deleted_at IS NULL`).bind(id).first())) throw new HttpError(404, `${type} not found`);
  const stmts = [env.DB.prepare(`UPDATE ${table} SET deleted_at = ?1, deleted_with = NULL WHERE id = ?2`).bind(now(), id)];
  if (type === "shot") stmts.push(...(await shotsLeave(env, ids([id]))));
  await env.DB.batch(stmts);
  return { deleted: id, binned: true };
}

/** A live folder and every live folder below it (ids). */
async function liveSubtree(env: Env, folderId: string): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `WITH RECURSIVE down(id, n) AS (
       SELECT ?1, 1
       UNION ALL SELECT f.id, down.n + 1 FROM folders f JOIN down ON f.parent_id = down.id WHERE f.deleted_at IS NULL AND down.n < 64)
     SELECT id FROM down`,
  ).bind(folderId).all<{ id: string }>();
  return results.map((r) => r.id);
}

/** Move a folder to the bin with its subtree and the files placed there. The Desktop folder stays. */
export async function binFolder(env: Env, id: string) {
  const f = await env.DB.prepare("SELECT kind FROM folders WHERE id = ?1 AND deleted_at IS NULL").bind(id).first<{ kind: string }>();
  if (!f) throw new HttpError(404, "folder not found");
  if (f.kind === "desktop") throw new HttpError(400, "the Desktop folder cannot be deleted");
  const tree = ids(await liveSubtree(env, id));
  const at = now();
  const placed = (type: FileResourceType) => `SELECT resource_id FROM folder_items WHERE resource_type = '${type}' AND folder_id IN (SELECT value FROM json_each(?1))`;
  const shots = (await env.DB.prepare(`SELECT id FROM shots WHERE deleted_at IS NULL AND id IN (${placed("shot")})`).bind(tree).all<{ id: string }>()).results.map((r) => r.id);
  const stmts = [
    env.DB.prepare("UPDATE folders SET deleted_at = ?2, deleted_with = CASE WHEN id = ?3 THEN NULL ELSE ?3 END WHERE id IN (SELECT value FROM json_each(?1))").bind(tree, at, id),
    ...FILE_RESOURCE_TYPES.map((t) => env.DB.prepare(`UPDATE ${RESOURCE_TABLE[t]} SET deleted_at = ?2, deleted_with = ?3 WHERE deleted_at IS NULL AND id IN (${placed(t)})`).bind(tree, at, id)),
  ];
  if (shots.length) stmts.push(...(await shotsLeave(env, ids(shots))));
  await env.DB.batch(stmts);
  return { deleted: id, binned: true };
}

/** `base`, else "base (restored)", "base (restored 2)" …: the first name not in `taken` (lower-cased). */
export function freeName(base: string, taken: Set<string>, max: number, sep = " ", suffix = (n: number) => `(restored${n > 1 ? ` ${n}` : ""})`): string {
  for (let n = 0; ; n++) {
    const tail = n === 0 ? "" : `${sep}${suffix(n)}`;
    const name = `${base.slice(0, max - tail.length)}${tail}`;
    if (!taken.has(name.toLowerCase())) return name;
  }
}

/** Un-bin one file; a location or field whose name/key is taken meanwhile gets a free one. */
async function restoreOne(env: Env, type: FileResourceType, id: string): Promise<D1PreparedStatement[]> {
  const table = RESOURCE_TABLE[type];
  const stmts: D1PreparedStatement[] = [];
  if (type === "location") {
    const l = await env.DB.prepare("SELECT project_id, name FROM locations WHERE id = ?1").bind(id).first<{ project_id: string; name: string }>();
    const taken = new Set((await env.DB.prepare("SELECT lower(name) AS n FROM locations WHERE project_id = ?1 AND deleted_at IS NULL").bind(l!.project_id).all<{ n: string }>()).results.map((r) => r.n));
    const name = freeName(l!.name, taken, 80);
    if (name !== l!.name) stmts.push(env.DB.prepare("UPDATE locations SET name = ?1 WHERE id = ?2").bind(name, id));
  } else if (type === "field") {
    const fd = await env.DB.prepare("SELECT project_id, key FROM field_definitions WHERE id = ?1").bind(id).first<{ project_id: string; key: string }>();
    const taken = new Set((await env.DB.prepare("SELECT lower(key) AS n FROM field_definitions WHERE project_id = ?1 AND deleted_at IS NULL").bind(fd!.project_id).all<{ n: string }>()).results.map((r) => r.n));
    // Keys are identifiers (lowercase, digits, _; max 40): "mood" → "mood_restored".
    const key = freeName(fd!.key, taken, 40, "_", (n) => `restored${n > 1 ? n : ""}`);
    if (key !== fd!.key) stmts.push(env.DB.prepare("UPDATE field_definitions SET key = ?1, definition = json_set(definition, '$.key', ?1) WHERE id = ?2").bind(key, id));
  }
  stmts.push(env.DB.prepare(`UPDATE ${table} SET deleted_at = NULL, deleted_with = NULL WHERE id = ?1`).bind(id));
  return stmts;
}

/** Placements pointing at a folder that is gone or binned go back to the top level. */
const dropDeadPlacements = (env: Env, type: FileResourceType, list: string) =>
  env.DB.prepare(`DELETE FROM folder_items WHERE resource_type = ?1 AND resource_id IN (SELECT value FROM json_each(?2))
    AND folder_id NOT IN (SELECT id FROM folders WHERE deleted_at IS NULL)`).bind(type, list);

/** Restore a binned file or folder (a folder with everything binned along with it). */
export async function restore(env: Env, type: TrashType, id: string) {
  if (type !== "folder") {
    const row = await env.DB.prepare(`SELECT 1 FROM ${RESOURCE_TABLE[type]} WHERE id = ?1 AND deleted_at IS NOT NULL`).bind(id).first();
    if (!row) throw new HttpError(404, `${type} not in the recycle bin`);
    // Its folder may still be in the bin: then it comes back at the top level.
    await env.DB.batch([...(await restoreOne(env, type, id)), dropDeadPlacements(env, type, ids([id]))]);
    return { restored: id };
  }
  const f = await env.DB.prepare("SELECT project_id, parent_id, name, deleted_with FROM folders WHERE id = ?1 AND deleted_at IS NOT NULL")
    .bind(id).first<{ project_id: string; parent_id: string | null; name: string; deleted_with: string | null }>();
  if (!f) throw new HttpError(404, "folder not in the recycle bin");
  if (f.deleted_with) throw new HttpError(400, "this folder went to the bin with another one; restore that folder");
  // Back where it was, or to the top level when that folder is gone or binned; a taken name gets " (restored)".
  const parentLive = f.parent_id ? !!(await env.DB.prepare("SELECT 1 FROM folders WHERE id = ?1 AND deleted_at IS NULL").bind(f.parent_id).first()) : true;
  const parent = parentLive ? f.parent_id : null;
  const taken = new Set((await env.DB.prepare("SELECT lower(name) AS n FROM folders WHERE project_id = ?1 AND ifnull(parent_id, '') = ifnull(?2, '') AND deleted_at IS NULL")
    .bind(f.project_id, parent).all<{ n: string }>()).results.map((r) => r.n));
  const name = freeName(f.name, taken, MAX_FOLDER_NAME);
  const stmts = [
    env.DB.prepare("UPDATE folders SET deleted_at = NULL, deleted_with = NULL, parent_id = ?2, name = ?3, updated_at = ?4 WHERE id = ?1").bind(id, parent, name, now()),
    env.DB.prepare("UPDATE folders SET deleted_at = NULL, deleted_with = NULL WHERE deleted_with = ?1").bind(id),
  ];
  for (const t of FILE_RESOURCE_TYPES) {
    if (t === "location" || t === "field") {
      // One by one: each may need a new name.
      const { results } = await env.DB.prepare(`SELECT id FROM ${RESOURCE_TABLE[t]} WHERE deleted_with = ?1`).bind(id).all<{ id: string }>();
      for (const r of results) stmts.push(...(await restoreOne(env, t, r.id)));
    } else stmts.push(env.DB.prepare(`UPDATE ${RESOURCE_TABLE[t]} SET deleted_at = NULL, deleted_with = NULL WHERE deleted_with = ?1`).bind(id));
  }
  await env.DB.batch(stmts);
  return { restored: id, name };
}

/** Delete binned files for real; shots take their R2 images and renders along. */
async function purgeFiles(env: Env, type: FileResourceType, list: string[]): Promise<void> {
  if (!list.length) return;
  const table = RESOURCE_TABLE[type];
  for (let i = 0; i < list.length; i += 50) {
    const chunk = list.slice(i, i + 50);
    const j = ids(chunk);
    let keys: string[] = [];
    if (type === "shot") {
      keys = (await env.DB.prepare("SELECT r2_object_key AS k FROM photos WHERE shot_id IN (SELECT value FROM json_each(?1))").bind(j).all<{ k: string }>()).results.map((r) => r.k);
      for (const sid of chunk) keys.push(...(await renderKeysOf(env, sid)));
    }
    // A timeline's clips own layers, and sketches with renders of their own (issues #31, #275).
    if (type === "timeline") await deleteClipCompose(env, ownedBy(env, "timeline_id IN (SELECT value FROM json_each(?1))", [j]));
    // Photos, layers, bakes, sketches, clips and spots cascade; placements and shortcuts go here.
    await env.DB.batch([env.DB.prepare(`DELETE FROM ${table} WHERE deleted_at IS NOT NULL AND id IN (SELECT value FROM json_each(?1))`).bind(j), ...fileRefCleanup(env, type, j)]);
    if (keys.length) await env.SHOTS_BUCKET.delete(keys);
  }
}

/** Purge a binned folder: everything binned with it, then the folders themselves. */
async function purgeFolder(env: Env, id: string): Promise<void> {
  for (const t of FILE_RESOURCE_TYPES) {
    const { results } = await env.DB.prepare(`SELECT id FROM ${RESOURCE_TABLE[t]} WHERE deleted_with = ?1 AND deleted_at IS NOT NULL`).bind(id).all<{ id: string }>();
    await purgeFiles(env, t, results.map((r) => r.id));
  }
  await env.DB.prepare("DELETE FROM folders WHERE deleted_at IS NOT NULL AND (id = ?1 OR deleted_with = ?1)").bind(id).run();
}

/** Purge one top-level bin entry. */
export async function purgeOne(env: Env, type: TrashType, id: string) {
  if (type === "folder") {
    const f = await env.DB.prepare("SELECT deleted_with FROM folders WHERE id = ?1 AND deleted_at IS NOT NULL").bind(id).first<{ deleted_with: string | null }>();
    if (!f) throw new HttpError(404, "folder not in the recycle bin");
    if (f.deleted_with) throw new HttpError(400, "this folder went to the bin with another one; delete that folder");
    await purgeFolder(env, id);
  } else {
    if (!(await env.DB.prepare(`SELECT 1 FROM ${RESOURCE_TABLE[type]} WHERE id = ?1 AND deleted_at IS NOT NULL`).bind(id).first())) throw new HttpError(404, `${type} not in the recycle bin`);
    await purgeFiles(env, type, [id]);
  }
  return { purged: id };
}

/**
 * Purge everything binned in a project (empty the bin), or everything binned before a time (the
 * cron). Folders go first so their contents are purged with them; then the files on their own.
 */
export async function purgeBinned(env: Env, opts: { projectId?: string; before?: string }): Promise<number> {
  const parts = ["deleted_at IS NOT NULL"];
  const args: string[] = [];
  if (opts.projectId) { args.push(opts.projectId); parts.push(`project_id = ?${args.length}`); }
  if (opts.before) { args.push(opts.before); parts.push(`deleted_at < ?${args.length}`); }
  const where = () => parts.join(" AND ");
  const bind = (st: D1PreparedStatement) => (args.length ? st.bind(...args) : st);
  let n = 0;
  const folders = (await bind(env.DB.prepare(`SELECT id FROM folders WHERE ${where()} AND deleted_with IS NULL`)).all<{ id: string }>()).results;
  for (const f of folders) await purgeFolder(env, f.id);
  n += folders.length;
  for (const t of FILE_RESOURCE_TYPES) {
    const { results } = await bind(env.DB.prepare(`SELECT id FROM ${RESOURCE_TABLE[t]} WHERE ${where()}`)).all<{ id: string }>();
    await purgeFiles(env, t, results.map((r) => r.id));
    n += results.length;
  }
  // Folders left over (binned with a folder that is gone already).
  const res = await bind(env.DB.prepare(`DELETE FROM folders WHERE ${where()}`)).run();
  return n + (res.meta.changes ?? 0);
}

/** The cron: purge what has been in the bin longer than TRASH_RETENTION_DAYS. */
export async function purgeExpired(env: Env, at = Date.now()): Promise<number> {
  return purgeBinned(env, { before: new Date(at - TRASH_RETENTION_DAYS * 86_400_000).toISOString() });
}

/** Only entries a user binned themselves; what went along with a binned folder is inside it. */
const TOP = (a: string) => `${a}.deleted_at IS NOT NULL AND (${a}.deleted_with IS NULL OR NOT EXISTS (SELECT 1 FROM folders bf WHERE bf.id = ${a}.deleted_with AND bf.deleted_at IS NOT NULL))`;
/** The live folder a file was placed in (where it comes back). */
const PLACED = (type: FileResourceType, a: string) => `(SELECT fi.folder_id FROM folder_items fi JOIN folders lf ON lf.id = fi.folder_id AND lf.deleted_at IS NULL WHERE fi.resource_type = '${type}' AND fi.resource_id = ${a}.id)`;

/** "1 photo" / "3 photos" in SQL, for a count expression. */
const n = (expr: string, one: string, many = `${one}s`) => `(SELECT c || CASE WHEN c = 1 THEN ' ${one}' ELSE ' ${many}' END FROM (SELECT (${expr}) AS c))`;

interface Raw { id: string; name: string | null; sub: string | null; deleted_at: string; folder_id: string | null; photo_id?: string | null; count?: number }

/** The bin of a project, newest first. */
export async function listTrash(env: Env, projectId: string): Promise<TrashEntry[]> {
  const q = (sql: string) => env.DB.prepare(sql).bind(projectId).all<Raw>().then((r) => r.results);
  const [shots, timelines, days, views, locations, fields, folders] = await Promise.all([
    q(`SELECT s.id, coalesce(s.name, l.name) AS name,
         ${n("SELECT count(*) FROM photos WHERE shot_id = s.id", "photo")} || coalesce(' · ' || l.name, '') AS sub,
         (SELECT id FROM photos WHERE shot_id = s.id ORDER BY ordinal LIMIT 1) AS photo_id,
         s.deleted_at, ${PLACED("shot", "s")} AS folder_id
       FROM shots s LEFT JOIN locations l ON l.id = s.location_id WHERE s.project_id = ?1 AND ${TOP("s")}`),
    q(`SELECT t.id, t.name, ${n("SELECT count(*) FROM timeline_clips WHERE timeline_id = t.id", "clip")} AS sub, t.deleted_at, ${PLACED("timeline", "t")} AS folder_id
       FROM timelines t WHERE t.project_id = ?1 AND ${TOP("t")}`),
    q(`SELECT d.id, d.date || coalesce(' · ' || d.title, '') AS name, ${n("SELECT count(*) FROM day_shots WHERE day_id = d.id", "shot")} AS sub, d.deleted_at, ${PLACED("day", "d")} AS folder_id
       FROM shooting_days d WHERE d.project_id = ?1 AND ${TOP("d")}`),
    q(`SELECT v.id, v.name, 'Saved view' AS sub, v.deleted_at, ${PLACED("view", "v")} AS folder_id FROM views v WHERE v.project_id = ?1 AND ${TOP("v")}`),
    q(`SELECT l.id, l.name, ${n("SELECT count(*) FROM spots WHERE location_id = l.id", "spot")} AS sub, l.deleted_at, ${PLACED("location", "l")} AS folder_id
       FROM locations l WHERE l.project_id = ?1 AND ${TOP("l")}`),
    q(`SELECT fd.id, coalesce(json_extract(fd.definition, '$.label'), fd.key) AS name, fd.key AS sub, fd.deleted_at, ${PLACED("field", "fd")} AS folder_id
       FROM field_definitions fd WHERE fd.project_id = ?1 AND ${TOP("fd")}`),
    q(`SELECT f.id, f.name, '' AS sub, f.deleted_at, (SELECT p.id FROM folders p WHERE p.id = f.parent_id AND p.deleted_at IS NULL) AS folder_id,
         (SELECT count(*) FROM shots WHERE deleted_with = f.id) + (SELECT count(*) FROM timelines WHERE deleted_with = f.id) + (SELECT count(*) FROM shooting_days WHERE deleted_with = f.id)
         + (SELECT count(*) FROM views WHERE deleted_with = f.id) + (SELECT count(*) FROM locations WHERE deleted_with = f.id) + (SELECT count(*) FROM field_definitions WHERE deleted_with = f.id) AS count
       FROM folders f WHERE f.project_id = ?1 AND ${TOP("f")}`),
  ]);
  const out: TrashEntry[] = [];
  const add = (type: TrashType, rows: Raw[]) => {
    for (const r of rows) {
      out.push({
        type, id: r.id, name: r.name ?? (type === "shot" ? "Untitled shot" : "Untitled"), deleted_at: r.deleted_at, folder_id: r.folder_id ?? null,
        sub: type === "folder" ? `${r.count ?? 0} ${r.count === 1 ? "file" : "files"}` : r.sub ?? "",
        ...(type === "shot" ? { photo_id: r.photo_id ?? null } : {}),
        ...(type === "folder" ? { count: r.count ?? 0 } : {}),
      });
    }
  };
  add("shot", shots); add("timeline", timelines); add("day", days); add("view", views); add("location", locations); add("field", fields); add("folder", folders);
  return out.sort((a, b) => b.deleted_at.localeCompare(a.deleted_at));
}

export function registerTrashRoutes(r: Router<Ctx>) {
  r.on("GET", "/api/trash", async (ctx) => {
    const pid = assertUuid(ctx.url.searchParams.get("project_id"), "project_id");
    await assertAccess(ctx, "project", pid, "viewer");
    return json({ entries: await listTrash(ctx.env, pid) });
  });

  /** Put an entry back where it was (or at the top level when that folder is gone). */
  r.on("POST", "/api/trash/:type/:id/restore", async (ctx, { type, id }) => {
    const t = assertEnum(type, "type", TRASH_TYPES), rid = assertUuid(id, "id");
    await assertAccess(ctx, t, rid, "editor");
    return json(await restore(ctx.env, t, rid));
  });

  /** Delete one entry for good. */
  r.on("DELETE", "/api/trash/:type/:id", async (ctx, { type, id }) => {
    const t = assertEnum(type, "type", TRASH_TYPES), rid = assertUuid(id, "id");
    await assertAccess(ctx, t, rid, "editor");
    return json(await purgeOne(ctx.env, t, rid));
  });

  /** Empty a project's bin. */
  r.on("DELETE", "/api/trash", async (ctx) => {
    const pid = assertUuid(ctx.url.searchParams.get("project_id"), "project_id");
    await assertAccess(ctx, "project", pid, "editor");
    return json({ purged: await purgeBinned(ctx.env, { projectId: pid }) });
  });
}
