import { assertNumber, assertString, assertUuid, HttpError, json, readJson, type Router } from "./http.ts";
import type { Ctx } from "./index.ts";
import { accessIfExists, assertAccess, assertRank, defaultWorkspace, inWorkspaces } from "./tenancy.ts";

export interface PresetRow {
  id: string;
  workspace_id: string;
  name: string;
  sensor_width_mm: number;
  sensor_height_mm: number;
  speedbooster_factor: number;
  camera_id: string | null;
  format_id: string | null;
  lens_min_mm: number | null;
  lens_max_mm: number | null;
  created_at: string;
  updated_at: string | null;
}

const optionalId = (v: unknown, field: string): string | null => {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || v.length > 60 || !/^[\w.-]+$/.test(v)) throw new HttpError(400, `${field} must be a short id`);
  return v;
};

const optionalNumber = (v: unknown, field: string, opts: { min: number; max: number }): number | null =>
  v === undefined || v === null ? null : assertNumber(v, field, opts);

/**
 * Rigs belong to a workspace and are shared by its projects. Lists hold the rigs of all the caller's
 * workspaces (each carries workspace_id), so the phone needs no notion of workspaces to pick one.
 */
export function registerPresetRoutes(r: Router<Ctx>) {
  r.on("GET", "/api/presets", async ({ env, tenant }) => {
    const { results } = await env.DB.prepare(`SELECT * FROM presets WHERE ${inWorkspaces("workspace_id", 1)} ORDER BY name COLLATE NOCASE`)
      .bind(tenant.wsList).all<PresetRow>();
    return json({ presets: results });
  });

  // Upsert. The client owns the id so offline-created presets can be synced later. A new rig goes to
  // `workspace_id` (default: the caller's own workspace); an existing one keeps its workspace.
  r.on("PUT", "/api/presets/:id", async (ctx, { id }) => {
    const { env, request } = ctx;
    const pid = assertUuid(id, "id");
    const b = await readJson<Record<string, unknown>>(request);
    const ws = (await accessIfExists(ctx, "preset", pid, "editor"))
      ?? (b.workspace_id == null ? await defaultWorkspace(ctx) : assertRank(ctx, assertUuid(b.workspace_id, "workspace_id"), "editor", "workspace not found"));
    const name = assertString(b.name, "name", 80);
    const w = assertNumber(b.sensor_width_mm, "sensor_width_mm", { min: 1, max: 100 });
    const h = assertNumber(b.sensor_height_mm, "sensor_height_mm", { min: 1, max: 100 });
    const sb = assertNumber(b.speedbooster_factor ?? 1, "speedbooster_factor", { min: 0.3, max: 2 });
    const cameraId = optionalId(b.camera_id, "camera_id");
    const formatId = optionalId(b.format_id, "format_id");
    const lensMin = optionalNumber(b.lens_min_mm, "lens_min_mm", { min: 1, max: 2000 });
    const lensMax = optionalNumber(b.lens_max_mm, "lens_max_mm", { min: 1, max: 2000 });
    if ((lensMin === null) !== (lensMax === null)) throw new HttpError(400, "lens_min_mm and lens_max_mm must be given together");
    if (lensMin !== null && lensMax !== null && lensMin >= lensMax) throw new HttpError(400, "lens_min_mm must be smaller than lens_max_mm");
    const now = new Date().toISOString();

    await env.DB.prepare(
      `INSERT INTO presets (id, name, sensor_width_mm, sensor_height_mm, speedbooster_factor, camera_id, format_id, lens_min_mm, lens_max_mm, updated_at, workspace_id)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
       ON CONFLICT(id) DO UPDATE SET name = ?2, sensor_width_mm = ?3, sensor_height_mm = ?4, speedbooster_factor = ?5,
         camera_id = ?6, format_id = ?7, lens_min_mm = ?8, lens_max_mm = ?9, updated_at = ?10`,
    ).bind(pid, name, w, h, sb, cameraId, formatId, lensMin, lensMax, now, ws).run();

    const row = await env.DB.prepare("SELECT * FROM presets WHERE id = ?1").bind(pid).first<PresetRow>();
    return json({ preset: row });
  });

  r.on("DELETE", "/api/presets/:id", async (ctx, { id }) => {
    const { env } = ctx;
    const pid = assertUuid(id, "id");
    await assertAccess(ctx, "preset", pid, "editor");
    const res = await env.DB.prepare("DELETE FROM presets WHERE id = ?1").bind(pid).run();
    if (!res.meta.changes) throw new HttpError(404, "preset not found");
    // photos.preset_id becomes NULL via ON DELETE SET NULL; the framing snapshot on
    // each photo keeps the historical config.
    return json({ deleted: pid });
  });
}
