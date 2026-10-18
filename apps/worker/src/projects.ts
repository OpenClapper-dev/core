import { assertString, assertUuid, HttpError, json, readJson, type Router } from "@fielder/service-kit";
import type { Ctx } from "./index.ts";
import { accessIfExists, assertAccess, assertRank, defaultWorkspace, inWorkspaces } from "./tenancy.ts";
import { purgeBinned } from "./trash.ts";

export interface ProjectRow {
  id: string;
  name: string;
  workspace_id: string;
  notes: string | null;
  created_at: string;
  updated_at: string | null;
  shot_count?: number;
  /** JSON array of the project's own field definition ids, in order. */
  field_ids?: string;
}

const toApi = (p: ProjectRow) => ({ ...p, field_ids: JSON.parse(p.field_ids ?? "[]") as string[] });

const LIST_SQL = `SELECT pr.*, (SELECT count(*) FROM shots s WHERE s.project_id = pr.id AND s.deleted_at IS NULL) AS shot_count,
  (SELECT json_group_array(id) FROM (SELECT id FROM field_definitions WHERE project_id = pr.id AND deleted_at IS NULL ORDER BY position, key)) AS field_ids
  FROM projects pr`;

/**
 * Every shot belongs to one project, every project to a workspace. Client-owned UUIDs with upsert
 * semantics, like locations. Lists hold the projects of all the caller's workspaces.
 */
export function registerProjectRoutes(r: Router<Ctx>) {
  r.on("GET", "/api/projects", async ({ env, tenant }) => {
    const { results } = await env.DB.prepare(`${LIST_SQL} WHERE ${inWorkspaces("pr.workspace_id", 1)} ORDER BY pr.name COLLATE NOCASE`)
      .bind(tenant.wsList).all<ProjectRow>();
    return json({ projects: results.map(toApi) });
  });

  // Names are unique case-insensitively within a workspace: a clash answers 409 + existing_id so the
  // client can adopt that project. A new project goes to `workspace_id` (default: the caller's own
  // workspace); an existing one never changes workspace.
  r.on("PUT", "/api/projects/:id", async (ctx, { id }) => {
    const { env, request } = ctx;
    const pid = assertUuid(id, "id");
    const b = await readJson<Record<string, unknown>>(request);
    const name = assertString(b.name, "name", 80);
    const notes = b.notes === undefined || b.notes === null || b.notes === "" ? null : assertString(b.notes, "notes", 4000);
    const ws = (await accessIfExists(ctx, "project", pid, "editor"))
      ?? (b.workspace_id == null ? await defaultWorkspace(ctx) : assertRank(ctx, assertUuid(b.workspace_id, "workspace_id"), "editor", "workspace not found"));
    const clash = await env.DB.prepare("SELECT id FROM projects WHERE workspace_id = ?3 AND name = ?1 COLLATE NOCASE AND id != ?2")
      .bind(name, pid, ws).first<{ id: string }>();
    if (clash) return json({ error: "a project with this name already exists", existing_id: clash.id }, 409);
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO projects (id, name, notes, updated_at, workspace_id) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(id) DO UPDATE SET name = ?2, notes = ?3, updated_at = ?4`,
    ).bind(pid, name, notes, now, ws).run();
    const row = await env.DB.prepare(`${LIST_SQL} WHERE pr.id = ?1`).bind(pid).first<ProjectRow>();
    return json({ project: toApi(row!) });
  });

  // Only projects without live shots can be deleted; their recycle bin is emptied first (the shots
  // in it would block the delete). Live shots are never removed as a side effect.
  r.on("DELETE", "/api/projects/:id", async (ctx, { id }) => {
    const { env } = ctx;
    const pid = assertUuid(id, "id");
    await assertAccess(ctx, "project", pid, "editor");
    const used = await env.DB.prepare("SELECT count(*) AS n FROM shots WHERE project_id = ?1 AND deleted_at IS NULL").bind(pid).first<{ n: number }>();
    if (used && used.n > 0) throw new HttpError(409, `project still has ${used.n} shot(s); move or delete them first`);
    await purgeBinned(env, { projectId: pid });
    const res = await env.DB.prepare("DELETE FROM projects WHERE id = ?1").bind(pid).run();
    if (!res.meta.changes) throw new HttpError(404, "project not found");
    return json({ deleted: pid });
  });
}
