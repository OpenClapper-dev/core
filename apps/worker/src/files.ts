import { FILE_RESOURCE_TYPES, MAX_FOLDER_DEPTH, MAX_FOLDER_NAME, validateDesktopItem, type DesktopItemKind, type FileResourceType } from "@fielder/vocab";
import { assertEnum, assertString, assertUuid, HttpError, json, readJson, type Router } from "./http.ts";
import type { Ctx, Env } from "./index.ts";
import { assertProjectExists } from "./projects.ts";

/**
 * Folders and desktop shortcuts (epic #72). Everything here is interactive, so validation is
 * strict; reads are lenient about stale placements and shortcuts (a resource deleted elsewhere is
 * swept by its delete route, and the dashboard ignores what it cannot resolve).
 */

interface FolderRow { id: string; project_id: string; parent_id: string | null; name: string; created_at: string; updated_at: string | null }
interface ItemRow { resource_type: FileResourceType; resource_id: string; folder_id: string; created_at: string }
interface DesktopRow {
  id: string; project_id: string; kind: DesktopItemKind; resource_type: FileResourceType | null; resource_id: string | null;
  folder_id: string | null; app_id: string | null; label: string | null; x: number; y: number; created_at: string; updated_at: string | null;
}

/** Where each file type lives and which column names its project. */
const RESOURCE_TABLE: Record<FileResourceType, string> = {
  shot: "shots", timeline: "timelines", day: "shooting_days", view: "views", location: "locations", field: "field_definitions",
};

async function resourceProject(env: Env, type: FileResourceType, id: string): Promise<string | null> {
  const row = await env.DB.prepare(`SELECT project_id FROM ${RESOURCE_TABLE[type]} WHERE id = ?1`).bind(id).first<{ project_id: string | null }>();
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
       SELECT id, parent_id, 1 FROM folders WHERE id = ?1
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
       UNION ALL SELECT f.id, down.n + 1 FROM folders f JOIN down ON f.parent_id = down.id WHERE down.n < 64)
     SELECT max(n) AS h FROM down`,
  ).bind(folderId).first<{ h: number }>();
  return row?.h ?? 1;
}

/** The id of another folder with this name in the same directory, if any. */
async function nameClash(env: Env, projectId: string, parentId: string | null, name: string, self: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT id FROM folders WHERE project_id = ?1 AND ifnull(parent_id, '') = ifnull(?2, '') AND name = ?3 COLLATE NOCASE AND id != ?4")
    .bind(projectId, parentId, name, self).first<{ id: string }>();
  return row?.id ?? null;
}

export function registerFileRoutes(r: Router<Ctx>) {
  /** One payload for the Files app and the desktop: the project's folders, placements and shortcuts. */
  r.on("GET", "/api/files", async ({ env, url }) => {
    const pid = assertUuid(url.searchParams.get("project_id"), "project_id");
    const [folders, items, desktop] = await Promise.all([
      env.DB.prepare("SELECT * FROM folders WHERE project_id = ?1 ORDER BY name COLLATE NOCASE").bind(pid).all<FolderRow>(),
      env.DB.prepare("SELECT i.* FROM folder_items i JOIN folders f ON f.id = i.folder_id WHERE f.project_id = ?1").bind(pid).all<ItemRow>(),
      env.DB.prepare("SELECT * FROM desktop_items WHERE project_id = ?1 ORDER BY created_at").bind(pid).all<DesktopRow>(),
    ]);
    return json({ folders: folders.results, items: items.results, desktop: desktop.results });
  });

  /**
   * Upsert a folder: JSON { project_id (create only; never changes), name, parent_id? }. parent_id
   * absent keeps the current parent, null moves to the root. Rejects cycles, depth > 8 and folders
   * of another project; a name taken in the directory answers 409 + existing_id.
   */
  r.on("PUT", "/api/folders/:id", async ({ env, request }, { id }) => {
    const fid = assertUuid(id, "id");
    const b = await readJson<Record<string, unknown>>(request);
    const name = assertString(b.name, "name", MAX_FOLDER_NAME);
    const stored = await env.DB.prepare("SELECT project_id, parent_id FROM folders WHERE id = ?1").bind(fid).first<{ project_id: string; parent_id: string | null }>();
    const projectId = stored?.project_id ?? assertUuid(b.project_id, "project_id");
    if (stored && b.project_id !== undefined && b.project_id !== stored.project_id) throw new HttpError(400, "a folder cannot move to another project");
    if (!stored) await assertProjectExists(env, projectId);
    const parentId = b.parent_id === undefined ? stored?.parent_id ?? null : b.parent_id === null ? null : assertUuid(b.parent_id, "parent_id");
    if (parentId) {
      const parent = await env.DB.prepare("SELECT project_id FROM folders WHERE id = ?1").bind(parentId).first<{ project_id: string }>();
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
    const row = await env.DB.prepare("SELECT * FROM folders WHERE id = ?1").bind(fid).first<FolderRow>();
    return json({ folder: row });
  });

  /**
   * Delete a folder; its contents fall up one level (subfolders and files move to its parent, or
   * the root). A subfolder whose name is taken there gets the deleted folder's name appended.
   */
  r.on("DELETE", "/api/folders/:id", async ({ env }, { id }) => {
    const fid = assertUuid(id, "id");
    const f = await env.DB.prepare("SELECT * FROM folders WHERE id = ?1").bind(fid).first<FolderRow>();
    if (!f) throw new HttpError(404, "folder not found");
    const [children, siblings] = await Promise.all([
      env.DB.prepare("SELECT id, name FROM folders WHERE parent_id = ?1").bind(fid).all<{ id: string; name: string }>(),
      env.DB.prepare("SELECT name FROM folders WHERE project_id = ?1 AND ifnull(parent_id, '') = ifnull(?2, '') AND id != ?3").bind(f.project_id, f.parent_id, fid).all<{ name: string }>(),
    ]);
    const taken = new Set(siblings.results.map((s) => s.name.toLowerCase()));
    const stmts: D1PreparedStatement[] = [];
    const now = new Date().toISOString();
    for (const c of children.results) {
      let name = c.name;
      for (let n = 1; taken.has(name.toLowerCase()); n++) name = `${c.name} (${f.name}${n > 1 ? ` ${n}` : ""})`.slice(0, MAX_FOLDER_NAME);
      taken.add(name.toLowerCase());
      stmts.push(env.DB.prepare("UPDATE folders SET parent_id = ?1, name = ?2, updated_at = ?3 WHERE id = ?4").bind(f.parent_id, name, now, c.id));
    }
    stmts.push(f.parent_id
      ? env.DB.prepare("UPDATE folder_items SET folder_id = ?1 WHERE folder_id = ?2").bind(f.parent_id, fid)
      : env.DB.prepare("DELETE FROM folder_items WHERE folder_id = ?1").bind(fid));
    stmts.push(env.DB.prepare("DELETE FROM desktop_items WHERE folder_id = ?1").bind(fid));
    stmts.push(env.DB.prepare("DELETE FROM folders WHERE id = ?1").bind(fid));
    await env.DB.batch(stmts);
    return json({ deleted: fid, moved_to: f.parent_id });
  });

  /** Put a resource into a folder: JSON { folder_id: uuid | null }; null puts it back at the root. */
  r.on("PUT", "/api/folder-items/:type/:id", async ({ env, request }, { type, id }) => {
    const t = assertEnum(type, "type", FILE_RESOURCE_TYPES);
    const rid = assertUuid(id, "id");
    const b = await readJson<Record<string, unknown>>(request);
    if (b.folder_id === null) {
      await env.DB.prepare("DELETE FROM folder_items WHERE resource_type = ?1 AND resource_id = ?2").bind(t, rid).run();
      return json({ item: null });
    }
    const folderId = assertUuid(b.folder_id, "folder_id");
    const folder = await env.DB.prepare("SELECT project_id FROM folders WHERE id = ?1").bind(folderId).first<{ project_id: string }>();
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
   * Upsert a desktop shortcut: JSON { project_id (create only), kind, resource_type + resource_id |
   * folder_id | app_id, label?, x, y }. What it points at never changes after creation (409); a
   * target that already has a shortcut on this desktop answers 409 + existing_id.
   */
  r.on("PUT", "/api/desktop/:id", async ({ env, request }, { id }) => {
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
    const now = new Date().toISOString();
    const stored = await env.DB.prepare("SELECT * FROM desktop_items WHERE id = ?1").bind(did).first<DesktopRow>();
    if (stored) {
      if (b.project_id !== undefined && b.project_id !== stored.project_id) throw new HttpError(400, "a shortcut cannot move to another project");
      const same = stored.kind === kind && stored.resource_type === target.resource_type && stored.resource_id === target.resource_id && stored.folder_id === target.folder_id && stored.app_id === target.app_id;
      if (!same) return json({ error: "a shortcut's target cannot change; delete it and make a new one" }, 409);
      await env.DB.prepare("UPDATE desktop_items SET label = ?1, x = ?2, y = ?3, updated_at = ?4 WHERE id = ?5").bind(label, b.x, b.y, now, did).run();
    } else {
      const projectId = assertUuid(b.project_id, "project_id");
      await assertProjectExists(env, projectId);
      if (target.folder_id) {
        const folder = await env.DB.prepare("SELECT project_id FROM folders WHERE id = ?1").bind(target.folder_id).first<{ project_id: string }>();
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
           AND ifnull(folder_id, '') = ifnull(?5, '') AND ifnull(app_id, '') = ifnull(?6, '')`,
      ).bind(projectId, kind, target.resource_type, target.resource_id, target.folder_id, target.app_id).first<{ id: string }>();
      if (dup) return json({ error: "this is already on the desktop", existing_id: dup.id }, 409);
      await env.DB.prepare(
        `INSERT INTO desktop_items (id, project_id, kind, resource_type, resource_id, folder_id, app_id, label, x, y, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
      ).bind(did, projectId, kind, target.resource_type, target.resource_id, target.folder_id, target.app_id, label, b.x, b.y, now).run();
    }
    const row = await env.DB.prepare("SELECT * FROM desktop_items WHERE id = ?1").bind(did).first<DesktopRow>();
    return json({ item: row });
  });

  r.on("DELETE", "/api/desktop/:id", async ({ env }, { id }) => {
    const did = assertUuid(id, "id");
    const res = await env.DB.prepare("DELETE FROM desktop_items WHERE id = ?1").bind(did).run();
    if (!res.meta.changes) throw new HttpError(404, "shortcut not found");
    return json({ deleted: did });
  });
}
