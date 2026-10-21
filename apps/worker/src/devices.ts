import { validateDeviceSpecs, type DeviceSpecs } from "@openclapper/vocab";
import { assertString, assertUuid, HttpError, json, readJson, type Router } from "@openclapper/service-kit";
import type { Ctx } from "./index.ts";

interface DeviceRow { id: string; user_id: string; name: string; specs: string; created_at: string; updated_at: string | null }
const toApi = (r: DeviceRow) => ({ ...r, specs: JSON.parse(r.specs) as DeviceSpecs });

/**
 * Device specs (issue #68). Created by the Studio from a phone's readout, then kept current by the
 * phone itself (its calibration and measured sizes); the id is the phone's own, so both write the same row.
 * A device is its user's, keyed (user_id, id) since #224: every route sees only the caller's own rows,
 * and two accounts that save the same phone each have their own.
 */
export function registerDeviceRoutes(r: Router<Ctx>) {
  r.on("GET", "/api/devices", async ({ env, tenant }) => {
    const { results } = await env.DB.prepare("SELECT * FROM devices WHERE user_id = ?1 ORDER BY name COLLATE NOCASE").bind(tenant.userId).all<DeviceRow>();
    return json({ devices: results.map(toApi) });
  });

  /**
   * JSON { name?, specs }. Upsert of the caller's own row, specs checked strictly. `name` is required
   * to create a device (the Studio names it); the phone's updates leave it out and keep the stored one.
   * The same phone id under another account is that account's row and stays untouched.
   */
  r.on("PUT", "/api/devices/:id", async ({ env, request, tenant }, { id }) => {
    const did = assertUuid(id, "id");
    const b = await readJson<Record<string, unknown>>(request);
    const err = validateDeviceSpecs(b.specs);
    if (err) throw new HttpError(400, err);
    const stored = await env.DB.prepare("SELECT name FROM devices WHERE user_id = ?1 AND id = ?2").bind(tenant.userId, did).first<{ name: string }>();
    const name = b.name === undefined && stored ? stored.name : assertString(b.name, "name", 80);
    await env.DB.prepare(
      `INSERT INTO devices (user_id, id, name, specs, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(user_id, id) DO UPDATE SET name = ?3, specs = ?4, updated_at = ?5`,
    ).bind(tenant.userId, did, name, JSON.stringify(b.specs), new Date().toISOString()).run();
    const row = await env.DB.prepare("SELECT * FROM devices WHERE user_id = ?1 AND id = ?2").bind(tenant.userId, did).first<DeviceRow>();
    return json({ device: toApi(row!) }, stored ? 200 : 201);
  });

  // Layouts designed for it keep working; they just lose the reference, in the same batch (the
  // composite foreign key of migration 0026 has no ON DELETE action: SET NULL would clear user_id too).
  r.on("DELETE", "/api/devices/:id", async ({ env, tenant }, { id }) => {
    const did = assertUuid(id, "id");
    const [, res] = await env.DB.batch([
      env.DB.prepare("UPDATE viewfinder_layouts SET device_id = NULL WHERE user_id = ?1 AND device_id = ?2").bind(tenant.userId, did),
      env.DB.prepare("DELETE FROM devices WHERE user_id = ?1 AND id = ?2").bind(tenant.userId, did),
    ]);
    if (!res.meta.changes) throw new HttpError(404, "device not found");
    return json({ deleted: did });
  });
}
