import {
  BIN_RETENTION_DAYS, canBeInternal, checkFile, containerTypes, defaultName, matchesSearch, FIXED_FOLDERS, fileType, fileTypes, MAX_BULK, MAX_CONTAINER_DEPTH, MAX_FILE_NAME,
  nameError, placementError, type Body, type CanvasBody, type FileType, type PresetBody, type Ref, type RootKind,
} from "@openclapper/model";
import { assertUuid, HttpError, json, readJson, type Router } from "@openclapper/service-kit";
import type { Ctx, Env } from "./index.ts";
import { assertNotLocked, assertPresetChange, assertPresetsFree, copyFrames, copyRenders, frameStatements, removeRenders, renderKeys } from "./canvas.ts";
import { copyPhotos, objectsOf, removeOrphans } from "./photos.ts";
import { nextName, refitValues, searchTexts, templateStatements, valuesOf } from "./properties.ts";
import { assertAccess, assertProjectRef, assertRank, type Access, type Role } from "./tenancy.ts";

/**
 * Files (docs/rewrite/07-organisation.md, 10-conclusion.md): one set of routes for every type. A
 * file is one row with the same columns whatever it is, plus its body, which `@openclapper/model`
 * checks on every save. A file belongs to a project (access by workspace role) or to the caller's
 * account home (only theirs).
 *
 * The recycle bin: binning marks a file and takes along everything inside it and its internal
 * files (`deleted_with`); restoring brings them back together. References are left alone, so a
 * binned file shows as missing where it was used and is back everywhere once restored.
 */

interface FileRow {
  id: string; project_id: string | null; home_of: string | null; type: string; name: string; container: string | null; internal_of: string | null;
  fixed: string | null; created_at: string; updated_at: string | null; created_by: string | null; deleted_at: string | null; deleted_with: string | null;
  lock_by: string | null; lock_until: string | null; body_version: number; body?: string; ws?: string | null; binned_with?: number;
  // A photo's facts (LEFT JOIN photos); all null for any other file.
  ph_origin?: string | null; ph_media_type?: string | null; ph_taken_at?: string | null; ph_width?: number | null; ph_height?: number | null;
  ph_original?: number | null; ph_preview?: number | null; ph_thumbnail?: number | null; ph_aov_h?: number | null; ph_aov_v?: number | null; ph_aov_source?: string | null; ph_device?: string | null;
}
/** Everything but the body: a list never carries bodies unless asked. */
const COLS = "f.id, f.project_id, f.home_of, f.type, f.name, f.container, f.internal_of, f.fixed, f.created_at, f.updated_at, f.created_by, f.deleted_at, f.deleted_with, f.lock_by, f.lock_until, f.body_version";
/** A photo's facts next to its file: joined into every list and single read, so Media needs one request. */
const PHOTO_COLS = "ph.origin AS ph_origin, ph.media_type AS ph_media_type, ph.taken_at AS ph_taken_at, ph.width AS ph_width, ph.height AS ph_height, ph.original_bytes AS ph_original, ph.preview_bytes AS ph_preview, ph.thumbnail_bytes AS ph_thumbnail, ph.aov_horizontal AS ph_aov_h, ph.aov_vertical AS ph_aov_v, ph.aov_source AS ph_aov_source, ph.device_id AS ph_device";
const PHOTO_JOIN = "LEFT JOIN photos ph ON ph.file_id = f.id";

interface Root { kind: RootKind; projectId: string | null; userId: string | null }
const rootOf = (f: FileRow): Root => ({ kind: f.home_of ? "home" : "project", projectId: f.project_id, userId: f.home_of });
const sameRoot = (a: Root, b: Root) => a.projectId === b.projectId && a.userId === b.userId;
/** SQL: the row is of the root bound at ?n and ?n+1 (`IS` also matches the NULL of the other kind). */
const inRoot = (alias: string, n: number) => `${alias}.project_id IS ?${n} AND ${alias}.home_of IS ?${n + 1}`;

/** The most files one page of a list holds. */
const MAX_PAGE = 2000;
const now = () => new Date().toISOString();
const list = (ids: readonly string[]) => JSON.stringify(ids);
const parseBody = (f: FileRow): Body => JSON.parse(f.body ?? "{}") as Body;

function toApi(f: FileRow, withBody: boolean) {
  const locked = f.lock_until !== null && f.lock_until > now();
  return {
    id: f.id, project_id: f.project_id, home: f.home_of !== null, type: f.type, name: f.name, container: f.container, internal_of: f.internal_of, fixed: f.fixed,
    created_at: f.created_at, updated_at: f.updated_at, created_by: f.created_by, deleted_at: f.deleted_at,
    lock: locked ? { by: f.lock_by, until: f.lock_until } : null,
    body_version: f.body_version,
    ...(withBody ? { body: parseBody(f) } : {}),
    ...(f.binned_with !== undefined ? { binned_with: f.binned_with } : {}),
    ...(f.ph_origin ? {
      photo: {
        origin: f.ph_origin, media_type: f.ph_media_type, taken_at: f.ph_taken_at, width: f.ph_width, height: f.ph_height,
        // Which images are stored, with their sizes in bytes; one that has not arrived yet is null.
        stored: { thumbnail: f.ph_thumbnail ?? null, preview: f.ph_preview ?? null, original: f.ph_original ?? null },
        angle_of_view: f.ph_aov_source ? { horizontal: f.ph_aov_h, vertical: f.ph_aov_v, source: f.ph_aov_source } : null,
        device_id: f.ph_device ?? null,
      },
    } : {}),
  };
}

/** A file's row when the caller may see it with at least `min`; another root's file answers like a missing one. */
function checkAccess(a: Access, f: FileRow | null, min: Role): FileRow {
  if (!f) throw new HttpError(404, "file not found");
  if (f.home_of) {
    if (f.home_of !== a.tenant.userId) throw new HttpError(404, "file not found");
  } else assertRank(a, f.ws, min, "file not found");
  return f;
}

const ONE = `SELECT ${COLS}, f.body, p.workspace_id AS ws, ${PHOTO_COLS} FROM files f LEFT JOIN projects p ON p.id = f.project_id ${PHOTO_JOIN} WHERE f.id = ?1`;

/** A file's row for the routes of one type (photos): as loadFile. */
export const accessFile = (a: Access, id: string, min: Role): Promise<FileRow> => loadFile(a, id, min);

async function loadFile(a: Access, id: string, min: Role): Promise<FileRow> {
  return checkAccess(a, await a.env.DB.prepare(ONE).bind(id).first<FileRow>(), min);
}

/** For upserts: null when there is no such file yet, else as loadFile (a PUT never takes over another root's file). */
async function findFile(a: Access, id: string, min: Role): Promise<FileRow | null> {
  const row = await a.env.DB.prepare(ONE).bind(id).first<FileRow>();
  return row ? checkAccess(a, row, min) : null;
}

/** The rows of a bulk request: every id must exist, be the caller's to change, and all be of one root. */
async function loadFiles(a: Access, ids: string[]): Promise<{ rows: FileRow[]; root: Root }> {
  const { results } = await a.env.DB.prepare(
    `SELECT ${COLS}, p.workspace_id AS ws FROM files f LEFT JOIN projects p ON p.id = f.project_id WHERE f.id IN (SELECT value FROM json_each(?1))`,
  ).bind(list(ids)).all<FileRow>();
  const byId = new Map(results.map((r) => [r.id, r]));
  const rows = ids.map((id) => checkAccess(a, byId.get(id) ?? null, "editor"));
  const root = rootOf(rows[0]);
  if (rows.some((r) => !sameRoot(rootOf(r), root))) throw new HttpError(400, "the files belong to more than one project");
  return { rows, root };
}

/** The JSON object of a request; anything else (an array, a string) is the client's mistake. */
async function readObject(request: Request): Promise<Record<string, unknown>> {
  const b = await readJson<unknown>(request);
  if (typeof b !== "object" || b === null || Array.isArray(b)) throw new HttpError(400, "expected a JSON object");
  return b as Record<string, unknown>;
}

function assertIds(v: unknown): string[] {
  if (!Array.isArray(v) || v.length === 0) throw new HttpError(400, "ids must be a non-empty array");
  if (v.length > MAX_BULK) throw new HttpError(400, `at most ${MAX_BULK} files at once`);
  return [...new Set(v.map((id, i) => assertUuid(id, `ids[${i}]`)))];
}

/** The root a list or a new file names: `project_id`, or `home` for the caller's account home. */
async function rootFrom(ctx: Ctx, projectId: unknown, home: unknown, min: Role, inBody: boolean): Promise<Root> {
  const wantsHome = home === true || home === "1" || home === "true";
  if ((projectId == null) === !wantsHome) throw new HttpError(400, "name a root: project_id, or home");
  if (wantsHome) return { kind: "home", projectId: null, userId: ctx.tenant.userId };
  const pid = assertUuid(projectId, "project_id");
  if (inBody) await assertProjectRef(ctx, pid, min);
  else await assertAccess(ctx, "project", pid, min);
  return { kind: "project", projectId: pid, userId: null };
}

const typeOf = (name: unknown): FileType => {
  const t = fileType(name);
  if (!t) throw new HttpError(400, `type must be one of: ${fileTypes().map((x) => x.type).join(", ")}`);
  return t;
};

/**
 * Whether `files` may sit in `containerId` (null: the top level): the model's placement rules, and
 * for containers the tree's own: nothing goes inside itself, and containers nest at most
 * MAX_CONTAINER_DEPTH deep. Three queries however many files.
 */
async function assertPlace(env: Env, root: Root, containerId: string | null, files: { id: string; type: FileType; isNew?: boolean }[]): Promise<void> {
  let facts: { type: string; fixed: string | null } | null = null;
  if (containerId) {
    const c = await env.DB.prepare("SELECT f.type, f.fixed, f.project_id, f.home_of, f.deleted_at, f.internal_of FROM files f WHERE f.id = ?1").bind(containerId).first<FileRow>();
    if (!c || c.deleted_at || c.internal_of || !sameRoot(rootOf(c), root)) throw new HttpError(400, "container: no such folder or collection here");
    facts = { type: c.type, fixed: c.fixed };
  }
  for (const f of files) {
    const wrong = placementError(f.type, facts, root.kind);
    if (wrong) throw new HttpError(400, wrong);
  }
  const holders = files.filter((f) => f.type.holds);
  if (!containerId || !holders.length) return;
  const up = (await env.DB.prepare(
    `WITH RECURSIVE up(id, container, n) AS (
       SELECT id, container, 1 FROM files WHERE id = ?1
       UNION ALL SELECT f.id, f.container, up.n + 1 FROM files f JOIN up ON f.id = up.container WHERE up.n < 64)
     SELECT id FROM up`,
  ).bind(containerId).all<{ id: string }>()).results.map((r) => r.id);
  if (holders.some((f) => up.includes(f.id))) throw new HttpError(400, "a folder cannot go inside itself");
  const stored = holders.filter((f) => !f.isNew).map((f) => f.id);
  const height = stored.length
    ? (await env.DB.prepare(
        `WITH RECURSIVE down(id, n) AS (
           SELECT value, 1 FROM json_each(?1)
           UNION ALL SELECT f.id, down.n + 1 FROM files f JOIN down ON f.container = down.id
             WHERE f.deleted_at IS NULL AND f.type IN (SELECT value FROM json_each(?2)) AND down.n < 64)
         SELECT max(n) AS h FROM down`,
      ).bind(list(stored), list(containerTypes())).first<{ h: number }>())?.h ?? 1
    : 1;
  if (up.length + height > MAX_CONTAINER_DEPTH) throw new HttpError(400, `folders nest at most ${MAX_CONTAINER_DEPTH} deep`);
}

/** A file's own references in their order; `missing` when what one points at is gone, binned or not of this root. */
async function refsOf(env: Env, f: FileRow): Promise<(Ref & { missing: boolean })[]> {
  const { results } = await env.DB.prepare(
    `SELECT r.kind, r.to_file, r.data, NOT EXISTS (SELECT 1 FROM files t WHERE t.id = r.to_file AND t.deleted_at IS NULL AND ${inRoot("t", 2)}) AS missing
     FROM refs r WHERE r.from_file = ?1 AND r.kind != 'property' ORDER BY r.position`,
  ).bind(f.id, f.project_id, f.home_of).all<{ kind: Ref["kind"]; to_file: string; data: string | null; missing: number }>();
  return results.map((r) => ({ kind: r.kind, to: r.to_file, data: r.data ? (JSON.parse(r.data) as Record<string, unknown>) : null, missing: r.missing === 1 }));
}

export async function fileOut(env: Env, id: string) {
  const f = (await env.DB.prepare(ONE).bind(id).first<FileRow>())!;
  return { ...toApi(f, true), refs: await refsOf(env, f) };
}

/** The statements that replace a file's own references (everything but what property values keep). */
function writeRefs(env: Env, id: string, refs: Ref[]): D1PreparedStatement[] {
  const stmts = [env.DB.prepare("DELETE FROM refs WHERE from_file = ?1 AND kind != 'property'").bind(id)];
  if (refs.length) {
    stmts.push(env.DB.prepare(
      `INSERT INTO refs (from_file, kind, position, to_file, data)
       SELECT ?1, json_extract(value, '$.kind'), key, json_extract(value, '$.to'), json_extract(value, '$.data') FROM json_each(?2)`,
    ).bind(id, JSON.stringify(refs)));
  }
  return stmts;
}

/** The fixed folders of a new project and the default property template in its Settings, in the batch that creates it. */
export function fixedFolders(env: Env, projectId: string, userId: string): D1PreparedStatement[] {
  const ids = Object.fromEntries(Object.keys(FIXED_FOLDERS).map((k) => [k, crypto.randomUUID()]));
  return [
    ...Object.entries(FIXED_FOLDERS).map(([fixed, name]) =>
      env.DB.prepare("INSERT INTO files (id, project_id, type, name, fixed, created_by) VALUES (?1, ?2, 'folder', ?3, ?4, ?5)").bind(ids[fixed], projectId, name, fixed, userId)),
    ...templateStatements(env, projectId, ids.settings, userId),
  ];
}

/** Live ids, the given ones first, with everything inside them and their internal files. */
const DOWN = `WITH RECURSIVE down(id) AS (
    SELECT value FROM json_each(?1)
    UNION SELECT f.id FROM files f JOIN down ON f.container = down.id WHERE f.deleted_at IS NULL
    UNION SELECT f.id FROM files f JOIN down ON f.internal_of = down.id WHERE f.deleted_at IS NULL)`;

/**
 * Deletes binned rows for good. `where` selects them (alias `f`); everything that went to the bin
 * with a selected file goes too. The one place rows leave the table, so what a type keeps outside
 * the database is removed here as well: a photo's stored images, once no other photo shares them.
 */
async function purge(env: Env, where: string, binds: unknown[]): Promise<number> {
  const { results } = await env.DB.prepare(`SELECT f.id FROM files f WHERE f.deleted_at IS NOT NULL AND (${where})`).bind(...binds).all<{ id: string }>();
  for (let i = 0; i < results.length; i += 500) {
    const ids = list(results.slice(i, i + 500).map((r) => r.id));
    const photos = await objectsOf(env, ids);
    const renders = await renderKeys(env, JSON.stringify((await env.DB.prepare("SELECT id FROM files WHERE deleted_at IS NOT NULL AND (id IN (SELECT value FROM json_each(?1)) OR deleted_with IN (SELECT value FROM json_each(?1)))").bind(ids).all<{ id: string }>()).results.map((r) => r.id)));
    // The "property" references that a purged definition's values kept go with the values.
    await env.DB.prepare(
      `DELETE FROM refs WHERE kind = 'property' AND json_extract(data, '$.property') IN
         (SELECT id FROM files WHERE type = 'property' AND deleted_at IS NOT NULL AND (id IN (SELECT value FROM json_each(?1)) OR deleted_with IN (SELECT value FROM json_each(?1))))`,
    ).bind(ids).run();
    await env.DB.prepare("DELETE FROM files WHERE deleted_at IS NOT NULL AND (id IN (SELECT value FROM json_each(?1)) OR deleted_with IN (SELECT value FROM json_each(?1)))").bind(ids).run();
    await removeOrphans(env, photos);
    await removeRenders(env, renders);
  }
  return results.length;
}

/** The cron: purge what has been in the bin longer than BIN_RETENTION_DAYS. Returns the entries purged. */
export async function purgeExpired(env: Env, at = Date.now()): Promise<number> {
  return purge(env, "f.deleted_with IS NULL AND f.deleted_at < ?1", [new Date(at - BIN_RETENTION_DAYS * 86_400_000).toISOString()]);
}

/** Not in the project's Settings folder: its definitions and patterns are not files a person counts. */
export const NOT_SETTINGS = (alias: string) => `(${alias}.container IS NULL OR ${alias}.container NOT IN (SELECT s.id FROM files s WHERE s.project_id = ${alias}.project_id AND s.fixed = 'settings'))`;

/** Before a project is deleted: how many live files it holds besides its fixed folders and their settings. */
export async function liveFiles(env: Env, projectId: string): Promise<number> {
  return (await env.DB.prepare(`SELECT count(*) AS n FROM files WHERE project_id = ?1 AND deleted_at IS NULL AND fixed IS NULL AND ${NOT_SETTINGS("files")}`).bind(projectId).first<{ n: number }>())?.n ?? 0;
}

/** Empties a project's bin and removes its fixed folders: what is left of an empty project before its row goes. */
export async function clearProject(env: Env, projectId: string): Promise<void> {
  await purge(env, "f.project_id = ?1", [projectId]);
  await env.DB.prepare("DELETE FROM files WHERE project_id = ?1").bind(projectId).run();
}

export function registerFileRoutes(r: Router<Ctx>) {
  /**
   * The files of one root: `project_id`, or `home=1`. Without more, every live file that is not
   * internal. `container` (an id, or `top`), `type` (comma-separated), `q` (in the name) and
   * `internal_of` narrow it; `bin=1` lists the bin's entries instead, newest first, each with how
   * many files went along (`binned_with`); `body=1` adds the bodies, `refs=1` each file's references.
   * A photo comes with its facts (`photo`). `limit` (at most 2000) and `offset` page the list; `more`
   * says whether files follow.
   */
  r.on("GET", "/api/files", async (ctx) => {
    const { env, url } = ctx;
    const q = url.searchParams;
    const root = await rootFrom(ctx, q.get("project_id"), q.get("home"), "viewer", false);
    const binds: unknown[] = [root.projectId, root.userId];
    const where = [inRoot("f", 1)];
    const bind = (v: unknown) => `?${binds.push(v)}`;
    const bin = q.get("bin") === "1";
    if (bin) where.push("f.deleted_at IS NOT NULL AND (f.deleted_with IS NULL OR NOT EXISTS (SELECT 1 FROM files t WHERE t.id = f.deleted_with AND t.deleted_at IS NOT NULL))");
    else {
      where.push("f.deleted_at IS NULL");
      const internalOf = q.get("internal_of");
      where.push(internalOf ? `f.internal_of = ${bind(assertUuid(internalOf, "internal_of"))}` : "f.internal_of IS NULL");
      const container = q.get("container");
      if (container === "top") where.push("f.container IS NULL");
      else if (container) where.push(`f.container = ${bind(assertUuid(container, "container"))}`);
    }
    const types = q.get("type");
    if (types) where.push(`f.type IN (SELECT value FROM json_each(${bind(list(types.split(",").map((t) => typeOf(t.trim()).type)))}))`);
    // Search looks at names and property values, with case and accents folded (shared matchesSearch);
    // it filters in the Worker, so the list is read whole and paged afterwards.
    const text = q.get("q")?.trim().slice(0, 200);
    const withBody = q.get("body") === "1";
    const limit = q.has("limit") ? Math.min(MAX_PAGE, Math.max(1, Number(q.get("limit")) || MAX_PAGE)) : null;
    const offset = Math.max(0, Number(q.get("offset")) || 0);
    const page = limit === null || text ? "" : ` LIMIT ${limit + 1} OFFSET ${offset}`;
    const { results: all } = await env.DB.prepare(
      `SELECT ${COLS}, ${PHOTO_COLS}${withBody ? ", f.body" : ""}${bin ? ", (SELECT count(*) FROM files x WHERE x.deleted_with = f.id AND x.deleted_at IS NOT NULL) AS binned_with" : ""}
       FROM files f ${PHOTO_JOIN} WHERE ${where.join(" AND ")} ORDER BY ${bin ? "f.deleted_at DESC, f.id" : "f.name COLLATE NOCASE, f.id"}${page}`,
    ).bind(...binds).all<FileRow>();
    let found = all;
    if (text) {
      const texts = await searchTexts(env, root.projectId, all);
      found = all.filter((f) => matchesSearch(text, texts.get(f.id) ?? [f.name]));
      if (limit !== null) found = found.slice(offset, offset + limit + 1);
    }
    const more = limit !== null && found.length > limit;
    const results = more ? found.slice(0, limit) : found;
    const values = q.get("values") === "1" ? await valuesOf(env, results.map((f) => f.id)) : null;
    const out = (f: FileRow) => (values ? { ...toApi(f, withBody), values: values.get(f.id) ?? {} } : toApi(f, withBody));
    if (q.get("refs") !== "1") return json({ files: results.map(out), more });
    // One query for the references of everything listed, whatever the count.
    const refs = (await env.DB.prepare(
      `SELECT r.from_file, r.kind, r.to_file, r.data, NOT EXISTS (SELECT 1 FROM files t WHERE t.id = r.to_file AND t.deleted_at IS NULL AND ${inRoot("t", 2)}) AS missing
       FROM refs r WHERE r.kind != 'property' AND r.from_file IN (SELECT value FROM json_each(?1)) ORDER BY r.from_file, r.position`,
    ).bind(list(results.map((f) => f.id)), root.projectId, root.userId).all<{ from_file: string; kind: Ref["kind"]; to_file: string; data: string | null; missing: number }>()).results;
    const byFile = new Map<string, unknown[]>();
    for (const r of refs) byFile.set(r.from_file, [...(byFile.get(r.from_file) ?? []), { kind: r.kind, to: r.to_file, data: r.data ? JSON.parse(r.data) : null, missing: r.missing === 1 }]);
    return json({ files: results.map((f) => ({ ...out(f), refs: byFile.get(f.id) ?? [] })), more });
  });

  /** One file with its body and its references. A binned file answers too: the bin shows what it holds. */
  r.on("GET", "/api/files/:id", async (ctx, { id }) => {
    const f = await loadFile(ctx, assertUuid(id, "id"), "viewer");
    return json({ file: { ...toApi(f, true), refs: await refsOf(ctx.env, f), values: (await valuesOf(ctx.env, [f.id])).get(f.id) ?? {} } });
  });

  /** Where a file is used: the live files of its root that point at it, and for what. */
  r.on("GET", "/api/files/:id/uses", async (ctx, { id }) => {
    const f = await loadFile(ctx, assertUuid(id, "id"), "viewer");
    const { results } = await ctx.env.DB.prepare(
      `SELECT DISTINCT u.id, u.type, u.name, u.internal_of, r.kind FROM refs r JOIN files u ON u.id = r.from_file
       WHERE r.to_file = ?1 AND u.deleted_at IS NULL AND ${inRoot("u", 2)} ORDER BY u.name COLLATE NOCASE, u.id`,
    ).bind(f.id, f.project_id, f.home_of).all();
    return json({ uses: results });
  });

  /**
   * Upsert a file: JSON { type, project_id | home (both on create only), name?, container?,
   * internal_of? (create only), body?, body_version?, refs? }. What is absent is kept; a new file
   * gets its type's default name and empty body. `container` null is the top level. `refs`, when
   * sent, replaces the file's references. A file's type and root never change.
   */
  r.on("PUT", "/api/files/:id", async (ctx, { id }) => {
    const { env, request, tenant } = ctx;
    const fid = assertUuid(id, "id");
    const b = await readObject(request);
    const stored = await findFile(ctx, fid, "editor");
    if (stored?.deleted_at) throw new HttpError(409, "the file is in the recycle bin; restore it first");
    const t = typeOf(stored?.type ?? b.type);
    if (t.made && !stored) throw new HttpError(400, `a ${t.label.toLowerCase()} is made by ${t.made === "upload" ? "uploading it" : "registering itself"}`);
    if (t.made === "upload" && (b.body !== undefined || b.refs !== undefined)) throw new HttpError(400, `what a ${t.label.toLowerCase()} stores about itself cannot be changed`);
    if (stored && b.type !== undefined && b.type !== stored.type) throw new HttpError(400, "a file's type never changes");
    if (stored && ((b.project_id !== undefined && b.project_id !== stored.project_id) || (b.home !== undefined && b.home !== (stored.home_of !== null)))) {
      throw new HttpError(400, "a file never moves to another project or account home");
    }
    const root = stored ? rootOf(stored) : await rootFrom(ctx, b.project_id, b.home, "editor", true);
    const wrongName = b.name === undefined ? null : nameError(b.name);
    if (wrongName) throw new HttpError(400, wrongName);
    // A new file of a project without a name gets one from its type's naming pattern (04-shots.md).
    const name = b.name !== undefined ? (b.name as string).trim() : stored ? stored.name : root.projectId ? await nextName(env, root.projectId, t.type) : defaultName(t);
    if (stored && b.internal_of !== undefined && b.internal_of !== stored.internal_of) throw new HttpError(400, "internal_of is set when a file is made; release it to make it a project file");
    const internalOf = stored ? stored.internal_of : b.internal_of == null ? null : assertUuid(b.internal_of, "internal_of");
    const container = b.container === undefined ? stored?.container ?? null : b.container === null ? null : assertUuid(b.container, "container");
    if (internalOf && container) throw new HttpError(400, "an internal file sits in no container");
    if (stored?.fixed && (name !== stored.name || container !== stored.container)) throw new HttpError(400, `the ${stored.name} folder cannot be renamed or moved`);
    // One editor at a time: a file someone else holds is read-only (canvas.ts).
    if (stored) await assertNotLocked(ctx, fid, t.type);

    if (!stored && internalOf) {
      if (!canBeInternal(t) || !t.roots.includes(root.kind)) throw new HttpError(400, `a ${t.label.toLowerCase()} cannot be an internal file`);
      const parent = await env.DB.prepare("SELECT f.project_id, f.home_of, f.deleted_at FROM files f WHERE f.id = ?1").bind(internalOf).first<FileRow>();
      if (!parent || parent.deleted_at || !sameRoot(rootOf(parent), root)) throw new HttpError(400, "internal_of: no such file here");
    } else if (!stored || container !== stored.container) {
      await assertPlace(env, root, container, [{ id: fid, type: t, isNew: !stored }]);
    }

    // The body and the references are checked together, so whichever was not sent is read back.
    let save: { body: Body; version: number; refs: Ref[] | null } | null = null;
    if (!stored || b.body !== undefined || b.refs !== undefined) {
      const body = b.body !== undefined ? b.body : stored ? parseBody(stored) : t.empty();
      const version = b.body !== undefined ? b.body_version : stored ? stored.body_version : t.version;
      const refs = b.refs !== undefined ? b.refs : stored ? await refsOf(env, stored) : [];
      const checked = checkFile(t, body, version, refs);
      if (!checked.ok) throw new HttpError(400, checked.error);
      save = { body: checked.body, version: checked.version, refs: b.refs !== undefined || !stored ? checked.refs : null };
    }
    // An optics preset changes additively only: lenses frames use stay.
    if (t.type === "preset" && stored && save && b.body !== undefined) await assertPresetChange(env, fid, parseBody(stored) as unknown as PresetBody, save.body as unknown as PresetBody);

    const at = now();
    const stmts: D1PreparedStatement[] = [];
    if (stored) {
      stmts.push(env.DB.prepare("UPDATE files SET name = ?2, container = ?3, updated_at = ?4, body = coalesce(?5, body), body_version = coalesce(?6, body_version) WHERE id = ?1")
        .bind(fid, name, container, at, save ? JSON.stringify(save.body) : null, save?.version ?? null));
    } else {
      stmts.push(env.DB.prepare(
        "INSERT INTO files (id, project_id, home_of, type, name, container, internal_of, created_by, created_at, body, body_version) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
      ).bind(fid, root.projectId, root.userId, t.type, name, container, internalOf, tenant.userId, at, JSON.stringify(save!.body), save!.version));
    }
    if (save?.refs) stmts.push(...writeRefs(env, fid, save.refs));
    // A canvas's frames are kept where the server can find them (is a preset's lens in use).
    if (t.type === "canvas" && save) stmts.push(...frameStatements(env, fid, save.body as unknown as CanvasBody));
    await env.DB.batch(stmts);
    // A changed definition: values that no longer fit it are fitted or dropped.
    if (t.type === "property" && stored && save && root.projectId) await refitValues(env, root.projectId, fid);
    return json({ file: await fileOut(env, fid) }, stored ? 200 : 201);
  });

  /** Move files into a folder or collection of their root, or to its top level: JSON { ids, container: id | null }. All or none. */
  r.on("POST", "/api/files/move", async (ctx) => {
    const { env, request } = ctx;
    const b = await readObject(request);
    const ids = assertIds(b.ids);
    const container = b.container === null ? null : assertUuid(b.container, "container");
    const { rows, root } = await loadFiles(ctx, ids);
    for (const f of rows) {
      if (f.deleted_at) throw new HttpError(409, `"${f.name}" is in the recycle bin`);
      if (f.fixed) throw new HttpError(400, `the ${f.name} folder cannot be moved`);
      if (f.internal_of) throw new HttpError(400, `"${f.name}" is an internal file; release it first`);
    }
    await assertPlace(env, root, container, rows.filter((f) => f.container !== container).map((f) => ({ id: f.id, type: typeOf(f.type) })));
    await env.DB.prepare("UPDATE files SET container = ?2, updated_at = ?3 WHERE id IN (SELECT value FROM json_each(?1))").bind(list(ids), container, now()).run();
    return json({ moved: ids, container });
  });

  /**
   * Move files to the recycle bin: JSON { ids }. Each takes along what is inside it and its
   * internal files. A file that is binned already is left as it is, so a repeated request is harmless.
   */
  r.on("POST", "/api/files/bin", async (ctx) => {
    const { env, request } = ctx;
    const ids = assertIds((await readObject(request)).ids);
    const { rows } = await loadFiles(ctx, ids);
    const fixed = rows.find((f) => f.fixed);
    if (fixed) throw new HttpError(400, `the ${fixed.name} folder cannot be deleted`);
    // An optics preset that frames use is archived instead, also when it would go with a folder.
    const inside = (await env.DB.prepare(`${DOWN} SELECT f.id, f.type, f.name FROM files f WHERE f.type = 'preset' AND f.id IN (SELECT id FROM down)`).bind(list(ids)).all<{ id: string; type: string; name: string }>()).results;
    await assertPresetsFree(env, inside);
    // Outermost first: a file binned in the same request as the folder it is in goes with the folder.
    const { results } = await env.DB.prepare(
      `WITH RECURSIVE up(start, id, n) AS (
         SELECT value, value, 0 FROM json_each(?1)
         UNION ALL SELECT up.start, coalesce(f.container, f.internal_of), up.n + 1 FROM files f JOIN up ON f.id = up.id
           WHERE coalesce(f.container, f.internal_of) IS NOT NULL AND up.n < 64)
       SELECT start, max(n) AS depth FROM up GROUP BY start ORDER BY depth`,
    ).bind(list(ids)).all<{ start: string }>();
    const at = now();
    await env.DB.batch(results.map((x) => env.DB.prepare(
      `${DOWN} UPDATE files SET deleted_at = ?2, deleted_with = CASE WHEN id = ?3 THEN NULL ELSE ?3 END WHERE deleted_at IS NULL AND id IN (SELECT id FROM down)`,
    ).bind(list([x.start]), at, x.start)));
    return json({ binned: ids });
  });

  /**
   * Restore binned files: JSON { ids }. Each comes back where it was with everything that went
   * along; when its folder is gone or still binned it comes back at the top level (`to_top`).
   */
  r.on("POST", "/api/files/restore", async (ctx) => {
    const { env, request } = ctx;
    const ids = assertIds((await readObject(request)).ids);
    const { rows } = await loadFiles(ctx, ids);
    const binned = rows.filter((f) => f.deleted_at);
    const near = [...new Set(binned.flatMap((f) => [f.container, f.internal_of, f.deleted_with]).filter((x): x is string => !!x))];
    const state = new Map((await env.DB.prepare("SELECT id, deleted_at FROM files WHERE id IN (SELECT value FROM json_each(?1))").bind(list(near)).all<{ id: string; deleted_at: string | null }>())
      .results.map((x) => [x.id, x.deleted_at]));
    // Live now, or coming back in this very request (a file and the folder it was in, named together).
    const coming = new Set(binned.map((f) => f.id));
    const live = (id: string | null) => id !== null && (state.get(id) === null || coming.has(id));
    const stmts: D1PreparedStatement[] = [];
    const toTop: string[] = [];
    const at = now();
    for (const f of binned) {
      if (f.deleted_with && coming.has(f.deleted_with)) continue;
      if (f.deleted_with && state.get(f.deleted_with)) throw new HttpError(400, `"${f.name}" went to the bin with another file; restore that one`);
      if (f.internal_of && !live(f.internal_of)) throw new HttpError(409, `"${f.name}" belongs to a file that is in the bin; restore that one`);
      const back = f.container && live(f.container) ? f.container : null;
      if (f.container && !back) toTop.push(f.id);
      stmts.push(
        env.DB.prepare("UPDATE files SET deleted_at = NULL, deleted_with = NULL, container = ?2, updated_at = ?3 WHERE id = ?1").bind(f.id, back, at),
        env.DB.prepare("UPDATE files SET deleted_at = NULL, deleted_with = NULL WHERE deleted_with = ?1").bind(f.id),
      );
    }
    if (stmts.length) await env.DB.batch(stmts);
    return json({ restored: ids, to_top: toTop });
  });

  /** Delete binned files for good: JSON { ids }, each an entry of the bin. */
  r.on("POST", "/api/files/purge", async (ctx) => {
    const { env, request } = ctx;
    const ids = assertIds((await readObject(request)).ids);
    const { rows } = await loadFiles(ctx, ids);
    const liveOne = rows.find((f) => !f.deleted_at);
    if (liveOne) throw new HttpError(400, `"${liveOne.name}" is not in the recycle bin`);
    await purge(env, "f.id IN (SELECT value FROM json_each(?1))", [list(ids)]);
    return json({ purged: ids });
  });

  /** Empty the bin of a root (`project_id`, or `home=1`). */
  r.on("DELETE", "/api/bin", async (ctx) => {
    const q = ctx.url.searchParams;
    const root = await rootFrom(ctx, q.get("project_id"), q.get("home"), "editor", false);
    const n = await purge(ctx.env, `f.deleted_with IS NULL AND ${inRoot("f", 1)}`, [root.projectId, root.userId]);
    // What is left went to the bin with a file that is gone already.
    await ctx.env.DB.prepare(`DELETE FROM files AS f WHERE f.deleted_at IS NOT NULL AND ${inRoot("f", 1)}`).bind(root.projectId, root.userId).run();
    return json({ purged: n });
  });

  /**
   * Copy a file: JSON { id (the copy's), name?, container? }. The copy takes along what is inside
   * the file and its internal files, their references and property values; a reference to a file
   * that was copied along points at the copy, any other at the same file as before. Sent again with
   * the same id it answers with the copy already made.
   */
  r.on("POST", "/api/files/:id/duplicate", async (ctx, { id }) => {
    const { env, request, tenant } = ctx;
    const src = await loadFile(ctx, assertUuid(id, "id"), "editor");
    const b = await readObject(request);
    const copyId = assertUuid(b.id, "id");
    if (await findFile(ctx, copyId, "editor")) return json({ file: await fileOut(env, copyId) });
    if (src.deleted_at) throw new HttpError(409, "the file is in the recycle bin; restore it first");
    if (src.fixed) throw new HttpError(400, `the ${src.name} folder cannot be copied`);
    const wrongName = b.name === undefined ? null : nameError(b.name);
    if (wrongName) throw new HttpError(400, wrongName);
    const tail = " copy";
    const name = b.name === undefined ? `${src.name.slice(0, MAX_FILE_NAME - tail.length)}${tail}` : (b.name as string).trim();
    const container = b.container === undefined ? src.container : b.container === null ? null : assertUuid(b.container, "container");
    if (src.internal_of && container) throw new HttpError(400, "an internal file sits in no container");
    const t = typeOf(src.type);
    if (container !== src.container) await assertPlace(env, rootOf(src), container, [{ id: src.id, type: t }]);

    const tree = (await env.DB.prepare(`${DOWN} SELECT f.id, f.type FROM files f WHERE f.id IN (SELECT id FROM down)`).bind(list([src.id])).all<{ id: string; type: string }>()).results;
    if (tree.length > MAX_BULK) throw new HttpError(400, `at most ${MAX_BULK} files in one copy; this one has ${tree.length}`);
    const ids = new Map(tree.map((f) => [f.id, f.id === src.id ? copyId : crypto.randomUUID()]));
    const map = JSON.stringify(Object.fromEntries(ids));
    const mapped = (col: string) => `coalesce((SELECT c.value FROM json_each(?1) c WHERE c.key = ${col}), ${col})`;
    const at = now();
    const stmts = [
      env.DB.prepare(
        `INSERT INTO files (id, project_id, home_of, type, name, container, internal_of, created_by, created_at, body, body_version)
         SELECT m.value, f.project_id, f.home_of, f.type, f.name, ${mapped("f.container")}, ${mapped("f.internal_of")}, ?2, ?3, f.body, f.body_version
         FROM files f JOIN json_each(?1) m ON m.key = f.id`,
      ).bind(map, tenant.userId, at),
      env.DB.prepare("UPDATE files SET name = ?2, container = ?3 WHERE id = ?1").bind(copyId, name, container),
      env.DB.prepare(
        `INSERT INTO refs (from_file, kind, position, to_file, data)
         SELECT m.value, r.kind, r.position, ${mapped("r.to_file")}, r.data FROM refs r JOIN json_each(?1) m ON m.key = r.from_file`,
      ).bind(map),
      env.DB.prepare("INSERT INTO property_values (file_id, definition_id, value) SELECT m.value, v.definition_id, v.value FROM property_values v JOIN json_each(?1) m ON m.key = v.file_id").bind(map),
      copyPhotos(env, map),
      copyFrames(env, map),
    ];
    // Reference values that name files copied along point at the copies, like references do.
    const { results: refValues } = await env.DB.prepare(
      `SELECT v.file_id, v.definition_id, v.value FROM property_values v JOIN files d ON d.id = v.definition_id
       WHERE v.file_id IN (SELECT value FROM json_each(?1)) AND json_extract(d.body, '$.field') = 'reference'`,
    ).bind(list(tree.map((f) => f.id))).all<{ file_id: string; definition_id: string; value: string }>();
    for (const v of refValues) {
      const next = (JSON.parse(v.value) as string[]).map((x) => ids.get(x) ?? x);
      if (JSON.stringify(next) !== v.value) stmts.push(env.DB.prepare("UPDATE property_values SET value = ?3 WHERE file_id = ?1 AND definition_id = ?2").bind(ids.get(v.file_id), v.definition_id, JSON.stringify(next)));
    }
    // Bodies that name files by id (a canvas's placed pictures) follow the copies.
    const remapping = tree.filter((f) => fileType(f.type)?.remap);
    if (remapping.length) {
      const { results } = await env.DB.prepare("SELECT id, type, body FROM files WHERE id IN (SELECT value FROM json_each(?1))").bind(list(remapping.map((f) => f.id))).all<FileRow>();
      for (const f of results) stmts.push(env.DB.prepare("UPDATE files SET body = ?2 WHERE id = ?1").bind(ids.get(f.id), JSON.stringify(fileType(f.type)!.remap!(parseBody(f), ids))));
    }
    await env.DB.batch(stmts);
    const canvases = tree.filter((f) => f.type === "canvas");
    if (canvases.length) await copyRenders(env, new Map(canvases.map((f) => [f.id, ids.get(f.id)!])));
    return json({ file: await fileOut(env, copyId) }, 201);
  });

  /**
   * Make an internal file a file of its root: JSON { container? }. One-way; the file it was made in
   * keeps pointing at it and no data moves (docs/rewrite/i1-interjection.md).
   */
  r.on("POST", "/api/files/:id/release", async (ctx, { id }) => {
    const { env, request } = ctx;
    const f = await loadFile(ctx, assertUuid(id, "id"), "editor");
    const b = await readObject(request);
    if (f.deleted_at) throw new HttpError(409, "the file is in the recycle bin; restore it first");
    if (!f.internal_of) throw new HttpError(400, "this is not an internal file");
    const container = b.container == null ? null : assertUuid(b.container, "container");
    await assertPlace(env, rootOf(f), container, [{ id: f.id, type: typeOf(f.type) }]);
    await env.DB.prepare("UPDATE files SET internal_of = NULL, container = ?2, updated_at = ?3 WHERE id = ?1").bind(f.id, container, now()).run();
    return json({ file: await fileOut(env, f.id) });
  });
}
