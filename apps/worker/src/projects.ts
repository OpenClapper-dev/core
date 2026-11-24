import { assertString, assertUuid, HttpError, json, readJson, type Router } from "@openclapper/service-kit";
import { clearProject, fixedFolders, liveFiles } from "./files.ts";
import type { Ctx } from "./index.ts";
import { accessIfExists, assertAccess, assertRank, defaultWorkspace, inWorkspaces } from "./tenancy.ts";

interface ProjectRow { id: string; name: string; workspace_id: string; created_at: string; updated_at: string | null; file_count: number }

/** A project with how many live files it holds; its two fixed folders and internal files are not counted. */
const LIST_SQL = `SELECT pr.id, pr.name, pr.workspace_id, pr.created_at, pr.updated_at,
  (SELECT count(*) FROM files f WHERE f.project_id = pr.id AND f.deleted_at IS NULL AND f.fixed IS NULL AND f.internal_of IS NULL) AS file_count
  FROM projects pr`;

/**
 * A project is a root of files and belongs to a workspace (docs/rewrite/07-organisation.md).
 * Client-owned UUIDs with upsert semantics. Lists hold the projects of all the caller's workspaces.
 */
export function registerProjectRoutes(r: Router<Ctx>) {
  r.on("GET", "/api/projects", async ({ env, tenant }) => {
    const { results } = await env.DB.prepare(`${LIST_SQL} WHERE ${inWorkspaces("pr.workspace_id", 1)} ORDER BY pr.name COLLATE NOCASE`)
      .bind(tenant.wsList).all<ProjectRow>();
    return json({ projects: results });
  });

  // Names are unique case-insensitively within a workspace: a clash answers 409 + existing_id so the
  // client can adopt that project. A new project goes to `workspace_id` (default: the caller's own
  // workspace) and gets its fixed folders; an existing one never changes workspace.
  r.on("PUT", "/api/projects/:id", async (ctx, { id }) => {
    const { env, request, tenant } = ctx;
    const pid = assertUuid(id, "id");
    const b = await readJson<Record<string, unknown>>(request);
    const name = assertString(b.name, "name", 80);
    const stored = await accessIfExists(ctx, "project", pid, "editor");
    const ws = stored ?? (b.workspace_id == null ? await defaultWorkspace(ctx) : assertRank(ctx, assertUuid(b.workspace_id, "workspace_id"), "editor", "workspace not found"));
    const clash = await env.DB.prepare("SELECT id FROM projects WHERE workspace_id = ?3 AND name = ?1 COLLATE NOCASE AND id != ?2")
      .bind(name, pid, ws).first<{ id: string }>();
    if (clash) return json({ error: "a project with this name already exists", existing_id: clash.id }, 409);
    const now = new Date().toISOString();
    if (stored) await env.DB.prepare("UPDATE projects SET name = ?2, updated_at = ?3 WHERE id = ?1").bind(pid, name, now).run();
    else {
      await env.DB.batch([
        env.DB.prepare("INSERT INTO projects (id, name, workspace_id, created_at) VALUES (?1, ?2, ?3, ?4)").bind(pid, name, ws, now),
        ...fixedFolders(env, pid, tenant.userId),
      ]);
    }
    const row = await env.DB.prepare(`${LIST_SQL} WHERE pr.id = ?1`).bind(pid).first<ProjectRow>();
    return json({ project: row }, stored ? 200 : 201);
  });

  // Only a project without live files can be deleted; its recycle bin is emptied with it. Live
  // files are never removed as a side effect.
  r.on("DELETE", "/api/projects/:id", async (ctx, { id }) => {
    const { env } = ctx;
    const pid = assertUuid(id, "id");
    await assertAccess(ctx, "project", pid, "editor");
    const used = await liveFiles(env, pid);
    if (used > 0) throw new HttpError(409, `the project still has ${used} file(s); delete them first`);
    await clearProject(env, pid);
    await env.DB.prepare("DELETE FROM projects WHERE id = ?1").bind(pid).run();
    return json({ deleted: pid });
  });
}
