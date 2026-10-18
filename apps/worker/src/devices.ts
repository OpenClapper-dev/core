import { validateDeviceSpecs, type DeviceSpecs } from "@fielder/vocab";
import { assertString, assertUuid, HttpError, json, readJson, type Router } from "@fielder/service-kit";
import type { Ctx } from "./index.ts";

interface DeviceRow { id: string; user_id: string; name: string; specs: string; created_at: string; updated_at: string | null }
const toApi = (r: DeviceRow) => ({ ...r, specs: JSON.parse(r.specs) as DeviceSpecs });

/**
 * Device specs (issue #68). Created by the dashboard from a phone's readout, then kept current by the
 * phone itself (its calibration and measured sizes); the id is the phone's own, so both write the same row.
 * A device is its user's: lists and deletes see only your own.
 */
export function registerDeviceRoutes(r: Router<Ctx>) {
  r.on("GET", "/api/devices", async ({ env, tenant }) => {
    const { results } = await env.DB.prepare("SELECT * FROM devices WHERE user_id = ?1 ORDER BY name COLLATE NOCASE").bind(tenant.userId).all<DeviceRow>();
    return json({ devices: results.map(toApi) });
  });

  /**
   * JSON { name?, specs }. Upsert, specs checked strictly. `name` is required to create a device (the
   * dashboard names it); the phone's updates leave it out and keep the stored one.
   * The id is the phone's, so a phone signed in to another account writes a row someone else has:
   * the phone has one current user, so the row becomes theirs and the old owner's layouts let go of it.
   */
  r.on("PUT", "/api/devices/:id", async ({ env, request, tenant }, { id }) => {
    const did = assertUuid(id, "id");
    const b = await readJson<Record<string, unknown>>(request);
    const err = validateDeviceSpecs(b.specs);
    if (err) throw new HttpError(400, err);
    const stored = await env.DB.prepare("SELECT name, user_id FROM devices WHERE id = ?1").bind(did).first<{ name: string; user_id: string }>();
    const name = b.name === undefined && stored ? stored.name : assertString(b.name, "name", 80);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO devices (id, name, specs, updated_at, user_id) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(id) DO UPDATE SET name = ?2, specs = ?3, updated_at = ?4, user_id = ?5`,
      ).bind(did, name, JSON.stringify(b.specs), new Date().toISOString(), tenant.userId),
      env.DB.prepare("UPDATE viewfinder_layouts SET device_id = NULL WHERE device_id = ?1 AND user_id != ?2").bind(did, tenant.userId),
    ]);
    const row = await env.DB.prepare("SELECT * FROM devices WHERE id = ?1").bind(did).first<DeviceRow>();
    return json({ device: toApi(row!) });
  });

  // Layouts designed for it keep working; they just lose the reference (ON DELETE SET NULL).
  r.on("DELETE", "/api/devices/:id", async ({ env, tenant }, { id }) => {
    const did = assertUuid(id, "id");
    const res = await env.DB.prepare("DELETE FROM devices WHERE id = ?1 AND user_id = ?2").bind(did, tenant.userId).run();
    if (!res.meta.changes) throw new HttpError(404, "device not found");
    return json({ deleted: did });
  });
}
