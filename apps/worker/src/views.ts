import { validateFilter } from "@fielder/vocab";
import { assertString, assertUuid, HttpError, json, readJson, type Router } from "./http.ts";
import type { Ctx } from "./index.ts";
import { fileRefCleanup } from "./files.ts";
import { assertProjectExists } from "./projects.ts";

interface ViewRow { id: string; project_id: string; name: string; filter: string; created_at: string; updated_at: string | null }
const toApi = (r: ViewRow) => ({ ...r, filter: JSON.parse(r.filter) as unknown });

/** Saved dashboard filters ("views"), each in one project: client-owned UUIDs, upsert semantics like presets. */
export function registerViewRoutes(r: Router<Ctx>) {
  r.on("GET", "/api/views", async ({ env }) => {
    const { results } = await env.DB.prepare("SELECT * FROM views ORDER BY name COLLATE NOCASE").all<ViewRow>();
    return json({ views: results.map(toApi) });
  });

  r.on("PUT", "/api/views/:id", async ({ env, request }, { id }) => {
    const vid = assertUuid(id, "id");
    const b = await readJson<Record<string, unknown>>(request);
    const name = assertString(b.name, "name", 80);
    const stored = await env.DB.prepare("SELECT project_id FROM views WHERE id = ?1").bind(vid).first<{ project_id: string }>();
    const projectId = stored?.project_id ?? assertUuid(b.project_id, "project_id");
    if (!stored) await assertProjectExists(env, projectId);
    const err = validateFilter(b.filter);
    if (err) throw new HttpError(400, `filter: ${err}`);
    const filter = JSON.stringify(b.filter);
    if (filter.length > 32 * 1024) throw new HttpError(413, "filter too large");
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO views (id, name, filter, updated_at, project_id) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(id) DO UPDATE SET name = ?2, filter = ?3, updated_at = ?4`,
    ).bind(vid, name, filter, now, projectId).run();
    const row = await env.DB.prepare("SELECT * FROM views WHERE id = ?1").bind(vid).first<ViewRow>();
    return json({ view: toApi(row!) });
  });

  r.on("DELETE", "/api/views/:id", async ({ env }, { id }) => {
    const vid = assertUuid(id, "id");
    const [res] = await env.DB.batch([env.DB.prepare("DELETE FROM views WHERE id = ?1").bind(vid), ...fileRefCleanup(env, "view", JSON.stringify([vid]))]);
    if (!res.meta.changes) throw new HttpError(404, "view not found");
    return json({ deleted: vid });
  });
}
