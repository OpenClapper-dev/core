import { assertNumber, assertString, assertUuid, HttpError, json, readJson, type Router } from "@fielder/service-kit";
import type { Ctx } from "./index.ts";
import { accessIfExists, assertAccess, assertRef, inWorkspaces } from "./tenancy.ts";

export interface SpotRow {
  id: string;
  location_id: string;
  name: string;
  /** The spot's pin; both null when none is set. */
  lat: number | null;
  lon: number | null;
  created_at: string;
  updated_at: string | null;
  shot_count?: number;
}

const LIST_SQL = `SELECT sp.*, count(s.id) AS shot_count FROM spots sp LEFT JOIN shots s ON s.spot_id = sp.id AND s.deleted_at IS NULL
  WHERE sp.location_id IN (SELECT id FROM locations WHERE deleted_at IS NULL)`;

/**
 * The spot `id` as seen from `locationId`: itself when it belongs there, else the location's spot of the
 * same name, created as a copy when `create` (a move or a lenient upload) and missing. Null without a
 * location, when the spot does not exist or is of another workspace, or when it has no counterpart
 * and `create` is off.
 */
export async function spotUnder(env: Ctx["env"], id: string, locationId: string | null, create: boolean): Promise<string | null> {
  if (!locationId) return null;
  const sp = await env.DB.prepare(
    `SELECT sp.location_id, sp.name, sp.lat, sp.lon FROM spots sp JOIN locations l ON l.id = sp.location_id JOIN projects p ON p.id = l.project_id
     WHERE sp.id = ?1 AND p.workspace_id = (SELECT p2.workspace_id FROM locations l2 JOIN projects p2 ON p2.id = l2.project_id WHERE l2.id = ?2)`,
  ).bind(id, locationId).first<{ location_id: string; name: string; lat: number | null; lon: number | null }>();
  if (!sp) return null;
  if (sp.location_id === locationId) return id;
  const same = await env.DB.prepare("SELECT id FROM spots WHERE location_id = ?1 AND name = ?2 COLLATE NOCASE").bind(locationId, sp.name).first<{ id: string }>();
  if (same) return same.id;
  if (!create) return null;
  const copy = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO spots (id, location_id, name, lat, lon) VALUES (?1, ?2, ?3, ?4, ?5)").bind(copy, locationId, sp.name, sp.lat, sp.lon).run();
  return copy;
}

/** Spots (issue #44): named places within a location, with an optional pin. Client-owned UUIDs, upserts. */
export function registerSpotRoutes(r: Router<Ctx>) {
  // The spots in the caller's workspaces (each carries location_id), or one project's with ?project_id=.
  r.on("GET", "/api/spots", async ({ env, url, tenant }) => {
    const project = url.searchParams.get("project_id");
    const mine = `sp.location_id IN (SELECT l.id FROM locations l JOIN projects p ON p.id = l.project_id WHERE ${inWorkspaces("p.workspace_id", 1)})`;
    const stmt = project
      ? env.DB.prepare(`${LIST_SQL} AND ${mine} AND sp.location_id IN (SELECT id FROM locations WHERE project_id = ?2) GROUP BY sp.id ORDER BY sp.name COLLATE NOCASE`).bind(tenant.wsList, assertUuid(project, "project_id"))
      : env.DB.prepare(`${LIST_SQL} AND ${mine} GROUP BY sp.id ORDER BY sp.name COLLATE NOCASE`).bind(tenant.wsList);
    const { results } = await stmt.all<SpotRow>();
    return json({ spots: results });
  });

  // location_id is required to create a spot and never changes. lat/lon like locations: absent keeps
  // the pin, null for both clears it. Names are unique per location: a clash answers 409 + existing_id.
  r.on("PUT", "/api/spots/:id", async (ctx, { id }) => {
    const { env, request } = ctx;
    const sid = assertUuid(id, "id");
    const b = await readJson<Record<string, unknown>>(request);
    const name = assertString(b.name, "name", 80);
    await accessIfExists(ctx, "spot", sid, "editor");
    const stored = await env.DB.prepare("SELECT location_id FROM spots WHERE id = ?1").bind(sid).first<{ location_id: string }>();
    const locationId = stored?.location_id ?? assertUuid(b.location_id, "location_id");
    if (!stored) await assertRef(ctx, "location", locationId);
    const hasPos = b.lat !== undefined || b.lon !== undefined;
    let lat: number | null = null, lon: number | null = null;
    if (hasPos && !(b.lat === null && b.lon === null)) {
      lat = assertNumber(b.lat, "lat", { min: -90, max: 90 });
      lon = assertNumber(b.lon, "lon", { min: -180, max: 180 });
    }
    const clash = await env.DB.prepare("SELECT id FROM spots WHERE location_id = ?1 AND name = ?2 COLLATE NOCASE AND id != ?3").bind(locationId, name, sid).first<{ id: string }>();
    if (clash) return json({ error: "this location already has a spot with this name", existing_id: clash.id }, 409);
    await env.DB.prepare(
      `INSERT INTO spots (id, location_id, name, updated_at, lat, lon) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT(id) DO UPDATE SET name = ?3, updated_at = ?4${hasPos ? ", lat = ?5, lon = ?6" : ""}`,
    ).bind(sid, locationId, name, new Date().toISOString(), lat, lon).run();
    const row = await env.DB.prepare(`${LIST_SQL} AND sp.id = ?1 GROUP BY sp.id`).bind(sid).first<SpotRow>();
    return json({ spot: row });
  });

  r.on("DELETE", "/api/spots/:id", async (ctx, { id }) => {
    const { env } = ctx;
    const sid = assertUuid(id, "id");
    await assertAccess(ctx, "spot", sid, "editor");
    const res = await env.DB.prepare("DELETE FROM spots WHERE id = ?1").bind(sid).run();
    if (!res.meta.changes) throw new HttpError(404, "spot not found");
    // shots.spot_id becomes NULL via ON DELETE SET NULL.
    return json({ deleted: sid });
  });
}
