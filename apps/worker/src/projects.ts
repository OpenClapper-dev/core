import { assertString, assertUuid, HttpError, json, readJson, type Router } from "./http.ts";
import type { Ctx } from "./index.ts";

export interface ProjectRow {
  id: string;
  name: string;
  notes: string | null;
  created_at: string;
  updated_at: string | null;
  shot_count?: number;
  /** JSON array of the project's own field definition ids, in order. */
  field_ids?: string;
}

const toApi = (p: ProjectRow) => ({ ...p, field_ids: JSON.parse(p.field_ids ?? "[]") as string[] });

const LIST_SQL = `SELECT pr.*, (SELECT count(*) FROM shots s WHERE s.project_id = pr.id) AS shot_count,
  (SELECT json_group_array(id) FROM (SELECT id FROM field_definitions WHERE project_id = pr.id ORDER BY position, key)) AS field_ids
  FROM projects pr`;

export async function assertProjectExists(env: Ctx["env"], id: string) {
  const p = await env.DB.prepare("SELECT 1 FROM projects WHERE id = ?1").bind(id).first();
  if (!p) throw new HttpError(400, "project_id does not exist");
}

/** Every shot belongs to one project. Client-owned UUIDs with upsert semantics, like locations. */
export function registerProjectRoutes(r: Router<Ctx>) {
  r.on("GET", "/api/projects", async ({ env }) => {
    const { results } = await env.DB.prepare(`${LIST_SQL} ORDER BY pr.name COLLATE NOCASE`).all<ProjectRow>();
    return json({ projects: results.map(toApi) });
  });

  // Names are unique case-insensitively: a clash answers 409 + existing_id so the client can adopt that project.
  r.on("PUT", "/api/projects/:id", async ({ env, request }, { id }) => {
    const pid = assertUuid(id, "id");
    const b = await readJson<Record<string, unknown>>(request);
    const name = assertString(b.name, "name", 80);
    const notes = b.notes === undefined || b.notes === null || b.notes === "" ? null : assertString(b.notes, "notes", 4000);
    const clash = await env.DB.prepare("SELECT id FROM projects WHERE name = ?1 COLLATE NOCASE AND id != ?2").bind(name, pid).first<{ id: string }>();
    if (clash) return json({ error: "a project with this name already exists", existing_id: clash.id }, 409);
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO projects (id, name, notes, updated_at) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(id) DO UPDATE SET name = ?2, notes = ?3, updated_at = ?4`,
    ).bind(pid, name, notes, now).run();
    const row = await env.DB.prepare(`${LIST_SQL} WHERE pr.id = ?1`).bind(pid).first<ProjectRow>();
    return json({ project: toApi(row!) });
  });

  // Only empty projects can be deleted; shots are never removed as a side effect.
  r.on("DELETE", "/api/projects/:id", async ({ env }, { id }) => {
    const pid = assertUuid(id, "id");
    const used = await env.DB.prepare("SELECT count(*) AS n FROM shots WHERE project_id = ?1").bind(pid).first<{ n: number }>();
    if (used && used.n > 0) throw new HttpError(409, `project still has ${used.n} shot(s); move or delete them first`);
    const res = await env.DB.prepare("DELETE FROM projects WHERE id = ?1").bind(pid).run();
    if (!res.meta.changes) throw new HttpError(404, "project not found");
    return json({ deleted: pid });
  });
}
