import { validateFilter } from "@openclapper/vocab";
import { assertString, assertUuid, HttpError, json, readJson, type Router } from "@openclapper/service-kit";
import type { Ctx } from "./index.ts";
import { accessIfExists, assertProjectRef, assertAccess, inWorkspaces } from "./tenancy.ts";
import { binResource } from "./trash.ts";

interface ViewRow { id: string; project_id: string; name: string; filter: string; created_at: string; updated_at: string | null }
const toApi = (r: ViewRow) => ({ ...r, filter: JSON.parse(r.filter) as unknown });

/** Saved Studio filters ("views"), each in one project: client-owned UUIDs, upsert semantics like presets. */
export function registerViewRoutes(r: Router<Ctx>) {
  // The views of every project in the caller's workspaces (each carries project_id).
  r.on("GET", "/api/views", async ({ env, tenant }) => {
    const { results } = await env.DB.prepare(
      `SELECT * FROM views WHERE project_id IN (SELECT id FROM projects WHERE ${inWorkspaces("workspace_id", 1)}) AND deleted_at IS NULL ORDER BY name COLLATE NOCASE`,
    ).bind(tenant.wsList).all<ViewRow>();
    return json({ views: results.map(toApi) });
  });

  r.on("PUT", "/api/views/:id", async (ctx, { id }) => {
    const { env, request } = ctx;
    const vid = assertUuid(id, "id");
    const b = await readJson<Record<string, unknown>>(request);
    const name = assertString(b.name, "name", 80);
    await accessIfExists(ctx, "view", vid, "editor");
    const stored = await env.DB.prepare("SELECT project_id FROM views WHERE id = ?1").bind(vid).first<{ project_id: string }>();
    const projectId = stored?.project_id ?? assertUuid(b.project_id, "project_id");
    if (!stored) await assertProjectRef(ctx, projectId);
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

  /** Moves the view to the recycle bin. */
  r.on("DELETE", "/api/views/:id", async (ctx, { id }) => {
    const rid = assertUuid(id, "id");
    await assertAccess(ctx, "view", rid, "editor");
    return json(await binResource(ctx.env, "view", rid));
  });
}
