import { assertNumber, assertString, assertUuid, HttpError, json, readJson, type Router } from "./http.ts";
import type { Ctx } from "./index.ts";

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
 * location, when the spot does not exist, or when it has no counterpart and `create` is off.
 */
export async function spotUnder(env: Ctx["env"], id: string, locationId: string | null, create: boolean): Promise<string | null> {
  if (!locationId) return null;
  const sp = await env.DB.prepare("SELECT location_id, name, lat, lon FROM spots WHERE id = ?1").bind(id)
    .first<{ location_id: string; name: string; lat: number | null; lon: number | null }>();
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
  // Every spot (each carries location_id), or one project's with ?project_id=.
  r.on("GET", "/api/spots", async ({ env, url }) => {
    const project = url.searchParams.get("project_id");
    const stmt = project
      ? env.DB.prepare(`${LIST_SQL} AND sp.location_id IN (SELECT id FROM locations WHERE project_id = ?1) GROUP BY sp.id ORDER BY sp.name COLLATE NOCASE`).bind(assertUuid(project, "project_id"))
      : env.DB.prepare(`${LIST_SQL} GROUP BY sp.id ORDER BY sp.name COLLATE NOCASE`);
    const { results } = await stmt.all<SpotRow>();
    return json({ spots: results });
  });

  // location_id is required to create a spot and never changes. lat/lon like locations: absent keeps
  // the pin, null for both clears it. Names are unique per location: a clash answers 409 + existing_id.
  r.on("PUT", "/api/spots/:id", async ({ env, request }, { id }) => {
    const sid = assertUuid(id, "id");
    const b = await readJson<Record<string, unknown>>(request);
    const name = assertString(b.name, "name", 80);
    const stored = await env.DB.prepare("SELECT location_id FROM spots WHERE id = ?1").bind(sid).first<{ location_id: string }>();
    const locationId = stored?.location_id ?? assertUuid(b.location_id, "location_id");
    if (!stored && !(await env.DB.prepare("SELECT 1 FROM locations WHERE id = ?1").bind(locationId).first())) throw new HttpError(400, "location_id does not exist");
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
    const row = await env.DB.prepare(`${LIST_SQL} WHERE sp.id = ?1 GROUP BY sp.id`).bind(sid).first<SpotRow>();
    return json({ spot: row });
  });

  r.on("DELETE", "/api/spots/:id", async ({ env }, { id }) => {
    const sid = assertUuid(id, "id");
    const res = await env.DB.prepare("DELETE FROM spots WHERE id = ?1").bind(sid).run();
    if (!res.meta.changes) throw new HttpError(404, "spot not found");
    // shots.spot_id becomes NULL via ON DELETE SET NULL.
    return json({ deleted: sid });
  });
}
