import { validateDeviceSpecs, type DeviceSpecs } from "@fielder/vocab";
import { assertString, assertUuid, HttpError, json, readJson, type Router } from "./http.ts";
import type { Ctx } from "./index.ts";
import { BOOTSTRAP_USER_ID } from "./tenancy.ts";

interface DeviceRow { id: string; name: string; specs: string; created_at: string; updated_at: string | null }
const toApi = (r: DeviceRow) => ({ ...r, specs: JSON.parse(r.specs) as DeviceSpecs });

/**
 * Device specs (issue #68). Created by the dashboard from a phone's readout, then kept current by the
 * phone itself (its calibration and measured sizes); the id is the phone's own, so both write the same row.
 */
export function registerDeviceRoutes(r: Router<Ctx>) {
  r.on("GET", "/api/devices", async ({ env }) => {
    const { results } = await env.DB.prepare("SELECT * FROM devices ORDER BY name COLLATE NOCASE").all<DeviceRow>();
    return json({ devices: results.map(toApi) });
  });

  /**
   * JSON { name?, specs }. Upsert, specs checked strictly. `name` is required to create a device (the
   * dashboard names it); the phone's updates leave it out and keep the stored one.
   */
  r.on("PUT", "/api/devices/:id", async ({ env, request }, { id }) => {
    const did = assertUuid(id, "id");
    const b = await readJson<Record<string, unknown>>(request);
    const err = validateDeviceSpecs(b.specs);
    if (err) throw new HttpError(400, err);
    const stored = await env.DB.prepare("SELECT name FROM devices WHERE id = ?1").bind(did).first<{ name: string }>();
    const name = b.name === undefined && stored ? stored.name : assertString(b.name, "name", 80);
    await env.DB.prepare(
      `INSERT INTO devices (id, name, specs, updated_at, user_id) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(id) DO UPDATE SET name = ?2, specs = ?3, updated_at = ?4`,
    ).bind(did, name, JSON.stringify(b.specs), new Date().toISOString(), BOOTSTRAP_USER_ID).run();
    const row = await env.DB.prepare("SELECT * FROM devices WHERE id = ?1").bind(did).first<DeviceRow>();
    return json({ device: toApi(row!) });
  });

  // Layouts designed for it keep working; they just lose the reference (ON DELETE SET NULL).
  r.on("DELETE", "/api/devices/:id", async ({ env }, { id }) => {
    const did = assertUuid(id, "id");
    const res = await env.DB.prepare("DELETE FROM devices WHERE id = ?1").bind(did).run();
    if (!res.meta.changes) throw new HttpError(404, "device not found");
    return json({ deleted: did });
  });
}
