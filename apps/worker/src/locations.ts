import { assertNumber, assertString, assertUuid, HttpError, json, readJson, type Router } from "@openclapper/service-kit";
import type { Ctx } from "./index.ts";
import { accessIfExists, assertAccess, assertProjectRef, inWorkspaces } from "./tenancy.ts";
import { binResource } from "./trash.ts";

export interface LocationRow {
  id: string;
  project_id: string;
  name: string;
  /** The location's pin; both null when none is set. */
  lat: number | null;
  lon: number | null;
  created_at: string;
  updated_at: string | null;
  shot_count?: number;
  approved_count?: number;
}

const LIST_SQL = `SELECT l.*, count(s.id) AS shot_count, coalesce(sum(s.state = 'approved'), 0) AS approved_count
  FROM locations l LEFT JOIN shots s ON s.location_id = l.id AND s.deleted_at IS NULL WHERE l.deleted_at IS NULL`;

/**
 * The location `id` as seen from `projectId`: itself when it belongs there, else the project's location
 * of the same name, created as a copy when `create` (a move or a lenient upload) and missing. Null when
 * the location does not exist at all, belongs to another workspace than the project (a name and pin
 * must not cross workspaces), or has no counterpart and `create` is off.
 */
export async function locationInProject(env: Ctx["env"], id: string, projectId: string, create: boolean): Promise<string | null> {
  // A location in the recycle bin counts as gone: an upload drops it, an edit is refused.
  const l = await env.DB.prepare(
    `SELECT l.project_id, l.name, l.lat, l.lon FROM locations l JOIN projects lp ON lp.id = l.project_id
     WHERE l.id = ?1 AND l.deleted_at IS NULL AND lp.workspace_id = (SELECT workspace_id FROM projects WHERE id = ?2)`,
  ).bind(id, projectId).first<{ project_id: string; name: string; lat: number | null; lon: number | null }>();
  if (!l) return null;
  if (l.project_id === projectId) return id;
  const same = await env.DB.prepare("SELECT id FROM locations WHERE project_id = ?1 AND name = ?2 COLLATE NOCASE AND deleted_at IS NULL").bind(projectId, l.name).first<{ id: string }>();
  if (same) return same.id;
  if (!create) return null;
  const copy = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO locations (id, project_id, name, lat, lon) VALUES (?1, ?2, ?3, ?4, ?5)").bind(copy, projectId, l.name, l.lat, l.lon).run();
  return copy;
}

export function registerLocationRoutes(r: Router<Ctx>) {
  // The locations of every project in the caller's workspaces (each carries project_id), or one project's with ?project_id=.
  r.on("GET", "/api/locations", async ({ env, url, tenant }) => {
    const project = url.searchParams.get("project_id");
    const mine = `l.project_id IN (SELECT id FROM projects WHERE ${inWorkspaces("workspace_id", 1)})`;
    const stmt = project
      ? env.DB.prepare(`${LIST_SQL} AND ${mine} AND l.project_id = ?2 GROUP BY l.id ORDER BY l.name COLLATE NOCASE`).bind(tenant.wsList, assertUuid(project, "project_id"))
      : env.DB.prepare(`${LIST_SQL} AND ${mine} GROUP BY l.id ORDER BY l.name COLLATE NOCASE`).bind(tenant.wsList);
    const { results } = await stmt.all<LocationRow>();
    return json({ locations: results });
  });

  // Upsert; the client owns the id so offline-created locations can be synced later.
  // A location belongs to one project: project_id is required to create it and never changes.
  // lat/lon are optional: absent keeps the stored pin (the phone only sends the name), null clears it.
  // Names are unique per project, case-insensitively: a clash answers 409 + existing_id
  // so the client can adopt that location instead.
  r.on("PUT", "/api/locations/:id", async (ctx, { id }) => {
    const { env, request } = ctx;
    const lid = assertUuid(id, "id");
    const b = await readJson<Record<string, unknown>>(request);
    const name = assertString(b.name, "name", 80);
    await accessIfExists(ctx, "location", lid, "editor");
    const stored = await env.DB.prepare("SELECT project_id FROM locations WHERE id = ?1").bind(lid).first<{ project_id: string }>();
    const projectId = stored?.project_id ?? assertUuid(b.project_id, "project_id");
    if (!stored) await assertProjectRef(ctx, projectId);
    const hasPos = b.lat !== undefined || b.lon !== undefined;
    let lat: number | null = null, lon: number | null = null;
    if (hasPos && !(b.lat === null && b.lon === null)) {
      lat = assertNumber(b.lat, "lat", { min: -90, max: 90 });
      lon = assertNumber(b.lon, "lon", { min: -180, max: 180 });
    }
    const clash = await env.DB.prepare("SELECT id FROM locations WHERE project_id = ?1 AND name = ?2 COLLATE NOCASE AND id != ?3 AND deleted_at IS NULL").bind(projectId, name, lid).first<{ id: string }>();
    if (clash) return json({ error: "a location with this name already exists", existing_id: clash.id }, 409);
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO locations (id, project_id, name, updated_at, lat, lon) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT(id) DO UPDATE SET name = ?3, updated_at = ?4${hasPos ? ", lat = ?5, lon = ?6" : ""}`,
    ).bind(lid, projectId, name, now, lat, lon).run();
    const row = await env.DB.prepare(`${LIST_SQL} AND l.id = ?1 GROUP BY l.id`).bind(lid).first<LocationRow>();
    return json({ location: row });
  });

  /** Moves the location (with its spots) to the recycle bin; its shots read as without a location meanwhile. */
  r.on("DELETE", "/api/locations/:id", async (ctx, { id }) => {
    const rid = assertUuid(id, "id");
    await assertAccess(ctx, "location", rid, "editor");
    return json(await binResource(ctx.env, "location", rid));
  });
}
