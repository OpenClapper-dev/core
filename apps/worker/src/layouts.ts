import { validateViewfinderLayout, type ViewfinderLayout } from "@fielder/vocab";
import { assertString, assertUuid, HttpError, json, readJson, type Router } from "./http.ts";
import type { Ctx } from "./index.ts";
import { BOOTSTRAP_USER_ID } from "./tenancy.ts";

interface LayoutRow { id: string; name: string; layout: string; device_id: string | null; created_at: string; updated_at: string | null }
const toApi = (r: LayoutRow) => ({ ...r, layout: JSON.parse(r.layout) as ViewfinderLayout });

/** Viewfinder layouts (issue #49): edited on the dashboard, read by the phone. Client-owned UUIDs, upserts. */
export function registerLayoutRoutes(r: Router<Ctx>) {
  r.on("GET", "/api/viewfinder-layouts", async ({ env }) => {
    const { results } = await env.DB.prepare("SELECT * FROM viewfinder_layouts ORDER BY name COLLATE NOCASE").all<LayoutRow>();
    return json({ layouts: results.map(toApi) });
  });

  /**
   * JSON { name, layout, device_id? }, the layout checked strictly (validateViewfinderLayout).
   * device_id (issue #68) is the device the layout is designed for: absent keeps it, null clears it.
   */
  r.on("PUT", "/api/viewfinder-layouts/:id", async ({ env, request }, { id }) => {
    const lid = assertUuid(id, "id");
    const b = await readJson<Record<string, unknown>>(request);
    const name = assertString(b.name, "name", 80);
    const err = validateViewfinderLayout(b.layout);
    if (err) throw new HttpError(400, err);
    const layout = JSON.stringify(b.layout);
    if (layout.length > 16 * 1024) throw new HttpError(413, "layout too large");
    const hasDevice = b.device_id !== undefined;
    const deviceId = b.device_id == null ? null : assertUuid(b.device_id, "device_id");
    if (deviceId && !(await env.DB.prepare("SELECT 1 FROM devices WHERE id = ?1").bind(deviceId).first())) throw new HttpError(400, "device_id: no such device");
    await env.DB.prepare(
      `INSERT INTO viewfinder_layouts (id, name, layout, device_id, updated_at, user_id) VALUES (?1, ?2, ?3, ?5, ?4, ?6)
       ON CONFLICT(id) DO UPDATE SET name = ?2, layout = ?3, updated_at = ?4${hasDevice ? ", device_id = ?5" : ""}`,
    ).bind(lid, name, layout, new Date().toISOString(), deviceId, BOOTSTRAP_USER_ID).run();
    const row = await env.DB.prepare("SELECT * FROM viewfinder_layouts WHERE id = ?1").bind(lid).first<LayoutRow>();
    return json({ layout: toApi(row!) });
  });

  // A phone using a deleted layout falls back to the default on its next sync.
  r.on("DELETE", "/api/viewfinder-layouts/:id", async ({ env }, { id }) => {
    const lid = assertUuid(id, "id");
    const res = await env.DB.prepare("DELETE FROM viewfinder_layouts WHERE id = ?1").bind(lid).run();
    if (!res.meta.changes) throw new HttpError(404, "layout not found");
    return json({ deleted: lid });
  });
}
