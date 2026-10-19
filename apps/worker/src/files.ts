import { FILE_RESOURCE_TYPES, MAX_FOLDER_DEPTH, MAX_FOLDER_NAME, validateDesktopItem, type DesktopArea, type DesktopItemKind, type FileResourceType } from "@fielder/vocab";
import { assertEnum, assertString, assertUuid, HttpError, json, readJson, type Router } from "@fielder/service-kit";
import type { Ctx, Env } from "./index.ts";
import { accessIfExists, assertAccess, assertProjectRef } from "./tenancy.ts";
import { binFolder } from "./trash.ts";

/**
 * Folders and desktop shortcuts (epic #72). Everything here is interactive, so validation is
 * strict; reads are lenient about stale placements and shortcuts (a resource deleted elsewhere is
 * swept by its delete route, and the Studio ignores what it cannot resolve).
 */

interface FolderRow { id: string; project_id: string; parent_id: string | null; name: string; kind: "normal" | "desktop"; created_at: string; updated_at: string | null }
/** The columns a client sees (the bin markers stay server-side). */
const FOLDER_COLS = "id, project_id, parent_id, name, kind, created_at, updated_at";
/** The Desktop folder's name: fixed, at the root of every project. */
export const DESKTOP_FOLDER = "Desktop";
interface ItemRow { resource_type: FileResourceType; resource_id: string; folder_id: string; created_at: string }
interface DesktopRow {
  id: string; project_id: string; kind: DesktopItemKind; resource_type: FileResourceType | null; resource_id: string | null;
  folder_id: string | null; app_id: string | null; label: string | null; x: number; y: number; area: DesktopArea; position: number | null; created_at: string; updated_at: string | null;
}

/** Where each file type lives and which column names its project. */
export const RESOURCE_TABLE: Record<FileResourceType, string> = {
  shot: "shots", timeline: "timelines", day: "shooting_days", view: "views", location: "locations", field: "field_definitions",
};

/** The project of a live (not binned) resource, or null. */
async function resourceProject(env: Env, type: FileResourceType, id: string): Promise<string | null> {
  const row = await env.DB.prepare(`SELECT project_id FROM ${RESOURCE_TABLE[type]} WHERE id = ?1 AND deleted_at IS NULL`).bind(id).first<{ project_id: string | null }>();
  return row?.project_id ?? null;
}

/**
 * The statements that drop a deleted (or moved) resource's placement and shortcuts. Each delete
 * route runs them next to its own DELETE; `ids` is a JSON array. With `keepProject`, shortcuts on
 * that project's desktop stay (a shot moved there).
 */
export function fileRefCleanup(env: Env, type: FileResourceType, ids: string, keepProject?: string): D1PreparedStatement[] {
  return [
    env.DB.prepare("DELETE FROM folder_items WHERE resource_type = ?1 AND resource_id IN (SELECT value FROM json_each(?2))").bind(type, ids),
    keepProject
      ? env.DB.prepare("DELETE FROM desktop_items WHERE resource_type = ?1 AND resource_id IN (SELECT value FROM json_each(?2)) AND project_id != ?3").bind(type, ids, keepProject)
      : env.DB.prepare("DELETE FROM desktop_items WHERE resource_type = ?1 AND resource_id IN (SELECT value FROM json_each(?2))").bind(type, ids),
  ];
}

/** Ancestors of a folder, itself first: their ids and the folder's depth (top level = 1). */
async function ancestry(env: Env, folderId: string): Promise<{ ids: string[]; depth: number }> {
  const { results } = await env.DB.prepare(
    `WITH RECURSIVE up(id, parent_id, n) AS (
       SELECT id, parent_id, 1 FROM folders WHERE id = ?1 AND deleted_at IS NULL
       UNION ALL SELECT f.id, f.parent_id, up.n + 1 FROM folders f JOIN up ON f.id = up.parent_id WHERE up.n < 64)
     SELECT id, n FROM up`,
  ).bind(folderId).all<{ id: string; n: number }>();
  return { ids: results.map((r) => r.id), depth: results.length };
}

/** Levels in a folder's subtree, itself included (a folder without subfolders = 1). */
async function subtreeHeight(env: Env, folderId: string): Promise<number> {
  const row = await env.DB.prepare(
    `WITH RECURSIVE down(id, n) AS (
       SELECT ?1, 1
       UNION ALL SELECT f.id, down.n + 1 FROM folders f JOIN down ON f.parent_id = down.id WHERE f.deleted_at IS NULL AND down.n < 64)
     SELECT max(n) AS h FROM down`,
  ).bind(folderId).first<{ h: number }>();
  return row?.h ?? 1;
}

/** The id of another folder with this name in the same directory, if any. */
async function nameClash(env: Env, projectId: string, parentId: string | null, name: string, self: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT id FROM folders WHERE project_id = ?1 AND ifnull(parent_id, '') = ifnull(?2, '') AND name = ?3 COLLATE NOCASE AND id != ?4 AND deleted_at IS NULL")
    .bind(projectId, parentId, name, self).first<{ id: string }>();
  return row?.id ?? null;
}

export function registerFileRoutes(r: Router<Ctx>) {
  /**
   * One payload for the Files app and the desktop: the project's live folders (the Desktop folder
   * among them, created here on first use), placements in them, and the desktop and taskbar items.
   */
  r.on("GET", "/api/files", async (ctx) => {
    const { env, url } = ctx;
    const pid = assertUuid(url.searchParams.get("project_id"), "project_id");
    await assertAccess(ctx, "project", pid, "viewer");
    await ensureDesktopFolder(env, pid);
    const [folders, items, desktop] = await Promise.all([
      env.DB.prepare(`SELECT ${FOLDER_COLS} FROM folders WHERE project_id = ?1 AND deleted_at IS NULL ORDER BY name COLLATE NOCASE`).bind(pid).all<FolderRow>(),
      env.DB.prepare("SELECT i.* FROM folder_items i JOIN folders f ON f.id = i.folder_id WHERE f.project_id = ?1 AND f.deleted_at IS NULL").bind(pid).all<ItemRow>(),
      env.DB.prepare("SELECT * FROM desktop_items WHERE project_id = ?1 ORDER BY area, position, created_at").bind(pid).all<DesktopRow>(),
    ]);
    return json({ folders: folders.results, items: items.results, desktop: desktop.results });
  });

  /**
   * Upsert a folder: JSON { project_id (create only; never changes), name, parent_id? }. parent_id
   * absent keeps the current parent, null moves to the root. Rejects cycles, depth > 8 and folders
   * of another project; a name taken in the directory answers 409 + existing_id.
   */
  r.on("PUT", "/api/folders/:id", async (ctx, { id }) => {
    const { env, request } = ctx;
    const fid = assertUuid(id, "id");
    const b = await readJson<Record<string, unknown>>(request);
    const name = assertString(b.name, "name", MAX_FOLDER_NAME);
    await accessIfExists(ctx, "folder", fid, "editor");
    const stored = await env.DB.prepare("SELECT project_id, parent_id, name, kind, deleted_at FROM folders WHERE id = ?1").bind(fid).first<{ project_id: string; parent_id: string | null; name: string; kind: string; deleted_at: string | null }>();
    if (stored?.deleted_at) throw new HttpError(409, "the folder is in the recycle bin; restore it first");
    const projectId = stored?.project_id ?? assertUuid(b.project_id, "project_id");
    if (stored && b.project_id !== undefined && b.project_id !== stored.project_id) throw new HttpError(400, "a folder cannot move to another project");
    if (!stored) await assertProjectRef(ctx, projectId);
    const parentId = b.parent_id === undefined ? stored?.parent_id ?? null : b.parent_id === null ? null : assertUuid(b.parent_id, "parent_id");
    // The Desktop folder is fixed: always "Desktop", always at the top level.
    if (stored?.kind === "desktop" && (name !== stored.name || parentId !== null)) throw new HttpError(400, "the Desktop folder cannot be renamed or moved");
    if (parentId) {
      const parent = await env.DB.prepare("SELECT project_id FROM folders WHERE id = ?1 AND deleted_at IS NULL").bind(parentId).first<{ project_id: string }>();
      if (!parent) throw new HttpError(400, "parent_id: folder not found");
      if (parent.project_id !== projectId) throw new HttpError(400, "parent_id: folder of another project");
      const up = await ancestry(env, parentId);
      if (up.ids.includes(fid)) throw new HttpError(400, "parent_id: a folder cannot go inside itself");
      const height = stored ? await subtreeHeight(env, fid) : 1;
      if (up.depth + height > MAX_FOLDER_DEPTH) throw new HttpError(400, `folders nest at most ${MAX_FOLDER_DEPTH} deep`);
    }
    const clash = await nameClash(env, projectId, parentId, name, fid);
    if (clash) return json({ error: "a folder with this name already exists here", existing_id: clash }, 409);
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO folders (id, project_id, parent_id, name, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(id) DO UPDATE SET parent_id = ?3, name = ?4, updated_at = ?5`,
    ).bind(fid, projectId, parentId, name, now).run();
    const row = await env.DB.prepare(`SELECT ${FOLDER_COLS} FROM folders WHERE id = ?1`).bind(fid).first<FolderRow>();
    return json({ folder: row });
  });

  /** Moves a folder to the recycle bin with everything in it (see trash.ts); the Desktop folder stays. */
  r.on("DELETE", "/api/folders/:id", async (ctx, { id }) => {
    const fid = assertUuid(id, "id");
    await assertAccess(ctx, "folder", fid, "editor");
    return json(await binFolder(ctx.env, fid));
  });

  /** Put a resource into a folder: JSON { folder_id: uuid | null }; null puts it back at the root. */
  r.on("PUT", "/api/folder-items/:type/:id", async (ctx, { type, id }) => {
    const { env, request } = ctx;
    const t = assertEnum(type, "type", FILE_RESOURCE_TYPES);
    const rid = assertUuid(id, "id");
    // The folder must be of the resource's project (checked below), so one check covers both.
    await assertAccess(ctx, t, rid, "editor");
    const b = await readJson<Record<string, unknown>>(request);
    if (b.folder_id === null) {
      await env.DB.prepare("DELETE FROM folder_items WHERE resource_type = ?1 AND resource_id = ?2").bind(t, rid).run();
      return json({ item: null });
    }
    const folderId = assertUuid(b.folder_id, "folder_id");
    const folder = await env.DB.prepare("SELECT project_id FROM folders WHERE id = ?1 AND deleted_at IS NULL").bind(folderId).first<{ project_id: string }>();
    if (!folder) throw new HttpError(400, "folder_id: folder not found");
    const owner = await resourceProject(env, t, rid);
    if (!owner) throw new HttpError(404, `${t} not found`);
    if (owner !== folder.project_id) throw new HttpError(400, `folder_id: the ${t} belongs to another project`);
    await env.DB.prepare(
      `INSERT INTO folder_items (resource_type, resource_id, folder_id) VALUES (?1, ?2, ?3)
       ON CONFLICT(resource_type, resource_id) DO UPDATE SET folder_id = ?3`,
    ).bind(t, rid, folderId).run();
    const row = await env.DB.prepare("SELECT * FROM folder_items WHERE resource_type = ?1 AND resource_id = ?2").bind(t, rid).first<ItemRow>();
    return json({ item: row });
  });

  /**
   * Upsert a desktop item: JSON { project_id (create only), kind, resource_type + resource_id |
   * folder_id | app_id, label?, area? (desktop | taskbar, create only), position? (taskbar order), x, y }.
   * What it points at and its area never change after creation (409); a target that already has an
   * item in this area answers 409 + existing_id.
   */
  r.on("PUT", "/api/desktop/:id", async (ctx, { id }) => {
    const { env, request } = ctx;
    const did = assertUuid(id, "id");
    const b = await readJson<Record<string, unknown>>(request);
    const bad = validateDesktopItem(b);
    if (bad) throw new HttpError(400, bad);
    const kind = b.kind as DesktopItemKind;
    const target = {
      resource_type: kind === "resource" ? (b.resource_type as FileResourceType) : null,
      resource_id: kind === "resource" ? assertUuid(b.resource_id, "resource_id") : null,
      folder_id: kind === "folder" ? assertUuid(b.folder_id, "folder_id") : null,
      app_id: kind === "app" ? (b.app_id as string) : null,
    };
    const label = typeof b.label === "string" ? b.label.trim() : null;
    const area: DesktopArea = b.area === "taskbar" ? "taskbar" : "desktop";
    const position = typeof b.position === "number" ? b.position : null;
    const now = new Date().toISOString();
    const stored = await env.DB.prepare("SELECT * FROM desktop_items WHERE id = ?1").bind(did).first<DesktopRow>();
    if (stored) {
      await assertAccess(ctx, "project", stored.project_id, "editor");
      if (b.project_id !== undefined && b.project_id !== stored.project_id) throw new HttpError(400, "a shortcut cannot move to another project");
      const same = stored.kind === kind && stored.resource_type === target.resource_type && stored.resource_id === target.resource_id && stored.folder_id === target.folder_id && stored.app_id === target.app_id
        && (b.area === undefined || stored.area === area);
      if (!same) return json({ error: "a shortcut's target and area cannot change; delete it and make a new one" }, 409);
      await env.DB.prepare("UPDATE desktop_items SET label = ?1, x = ?2, y = ?3, position = ?4, updated_at = ?5 WHERE id = ?6").bind(label, b.x, b.y, position, now, did).run();
    } else {
      const projectId = assertUuid(b.project_id, "project_id");
      await assertProjectRef(ctx, projectId);
      if (target.folder_id) {
        const folder = await env.DB.prepare("SELECT project_id FROM folders WHERE id = ?1 AND deleted_at IS NULL").bind(target.folder_id).first<{ project_id: string }>();
        if (!folder) throw new HttpError(400, "folder_id: folder not found");
        if (folder.project_id !== projectId) throw new HttpError(400, "folder_id: folder of another project");
      }
      if (target.resource_type && target.resource_id) {
        const owner = await resourceProject(env, target.resource_type, target.resource_id);
        if (!owner) throw new HttpError(404, `${target.resource_type} not found`);
        if (owner !== projectId) throw new HttpError(400, `resource_id: the ${target.resource_type} belongs to another project`);
      }
      const dup = await env.DB.prepare(
        `SELECT id FROM desktop_items WHERE project_id = ?1 AND kind = ?2 AND ifnull(resource_type, '') = ifnull(?3, '') AND ifnull(resource_id, '') = ifnull(?4, '')
           AND ifnull(folder_id, '') = ifnull(?5, '') AND ifnull(app_id, '') = ifnull(?6, '') AND area = ?7`,
      ).bind(projectId, kind, target.resource_type, target.resource_id, target.folder_id, target.app_id, area).first<{ id: string }>();
      if (dup) return json({ error: area === "taskbar" ? "this is already pinned" : "this is already on the desktop", existing_id: dup.id }, 409);
      try {
        await env.DB.prepare(
          `INSERT INTO desktop_items (id, project_id, kind, resource_type, resource_id, folder_id, app_id, label, x, y, area, position, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
        ).bind(did, projectId, kind, target.resource_type, target.resource_id, target.folder_id, target.app_id, label, b.x, b.y, area, position, now).run();
      } catch (e) {
        // Two clients (or two tabs) adding the same target at once: the second one is a duplicate too.
        if (!String(e).includes("desktop_target_idx")) throw e;
        const won = await env.DB.prepare(
          `SELECT id FROM desktop_items WHERE project_id = ?1 AND kind = ?2 AND ifnull(resource_type, '') = ifnull(?3, '') AND ifnull(resource_id, '') = ifnull(?4, '')
             AND ifnull(folder_id, '') = ifnull(?5, '') AND ifnull(app_id, '') = ifnull(?6, '') AND area = ?7`,
        ).bind(projectId, kind, target.resource_type, target.resource_id, target.folder_id, target.app_id, area).first<{ id: string }>();
        return json({ error: "this is already there", existing_id: won?.id ?? null }, 409);
      }
    }
    const row = await env.DB.prepare("SELECT * FROM desktop_items WHERE id = ?1").bind(did).first<DesktopRow>();
    return json({ item: row });
  });

  r.on("DELETE", "/api/desktop/:id", async (ctx, { id }) => {
    const { env } = ctx;
    const did = assertUuid(id, "id");
    const item = await env.DB.prepare("SELECT project_id FROM desktop_items WHERE id = ?1").bind(did).first<{ project_id: string }>();
    if (!item) throw new HttpError(404, "shortcut not found");
    await assertAccess(ctx, "project", item.project_id, "editor");
    const res = await env.DB.prepare("DELETE FROM desktop_items WHERE id = ?1").bind(did).run();
    if (!res.meta.changes) throw new HttpError(404, "shortcut not found");
    return json({ deleted: did });
  });
}

/**
 * Every project has one Desktop folder at its root (what sits on the desktop as a real item). It
 * is made on first use; a top-level folder already called "Desktop" becomes it.
 */
async function ensureDesktopFolder(env: Env, projectId: string): Promise<void> {
  if (await env.DB.prepare("SELECT 1 FROM folders WHERE project_id = ?1 AND kind = 'desktop'").bind(projectId).first()) return;
  const adopted = await env.DB.prepare("UPDATE folders SET kind = 'desktop', name = ?2 WHERE project_id = ?1 AND parent_id IS NULL AND name = ?2 COLLATE NOCASE AND deleted_at IS NULL")
    .bind(projectId, DESKTOP_FOLDER).run();
  if (adopted.meta.changes) return;
  await env.DB.prepare("INSERT OR IGNORE INTO folders (id, project_id, parent_id, name, kind) VALUES (?1, ?2, NULL, ?3, 'desktop')").bind(crypto.randomUUID(), projectId, DESKTOP_FOLDER).run();
}
