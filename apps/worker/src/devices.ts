import { checkFile, fileType } from "@openclapper/model";
import { HttpError, json, readJson, type Router } from "@openclapper/service-kit";
import { fileOut } from "./files.ts";
import type { Ctx } from "./index.ts";

/** The tabs of a device that never chose any (docs/rewrite/09-shells.md). */
export const DEFAULT_TABS = ["camera", "media", "shots", "setup"];

/**
 * Devices register themselves (docs/rewrite/03-capture.md). A phone calls this on start with its
 * fingerprint and what it reports; the answer is its device file. The person's own choices (the
 * name, the tabs, the camera layout) are kept; what the hardware reports is replaced (the camera's area only when sent). A device in the bin comes back.
 */
export function registerDeviceRoutes(r: Router<Ctx>) {
  r.on("POST", "/api/devices/register", async (ctx) => {
    const { env, request, tenant } = ctx;
    const b = await readJson<Record<string, unknown>>(request);
    if (typeof b !== "object" || b === null || Array.isArray(b)) throw new HttpError(400, "expected a JSON object");
    const fp = typeof b.fingerprint === "string" ? b.fingerprint.trim() : "";
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(fp)) throw new HttpError(400, "fingerprint must be 8 to 128 letters, digits or . _ : -");
    const known = await env.DB.prepare("SELECT d.file_id, f.body, f.deleted_at FROM devices d JOIN files f ON f.id = d.file_id WHERE d.user_id = ?1 AND d.fingerprint = ?2")
      .bind(tenant.userId, fp).first<{ file_id: string; body: string; deleted_at: string | null }>();
    const before = known ? (JSON.parse(known.body) as Record<string, unknown>) : null;
    const reported = { kind: b.kind, make: b.make ?? "", model: b.model ?? "", lenses: b.lenses ?? [], screen: b.screen ?? null, camera: b.camera ?? before?.camera ?? null, app: b.app ?? "" };
    // The person's choices stay: the tabs and the camera layout (set on the phone or from the Studio).
    const body = { ...reported, tabs: before?.tabs ?? DEFAULT_TABS, layout: before?.layout ?? "viewfinder" };
    const checked = checkFile(fileType("device")!, body, 1, null);
    if (!checked.ok) throw new HttpError(400, checked.error);
    const now = new Date().toISOString();
    if (known) {
      await env.DB.batch([
        env.DB.prepare("UPDATE files SET body = ?2, updated_at = ?3, deleted_at = NULL, deleted_with = NULL WHERE id = ?1").bind(known.file_id, JSON.stringify(checked.body), now),
        env.DB.prepare("UPDATE devices SET seen_at = ?2 WHERE file_id = ?1").bind(known.file_id, now),
      ]);
      return json({ file: await fileOut(env, known.file_id), restored: !!known.deleted_at });
    }
    const id = crypto.randomUUID();
    const name = (typeof b.model === "string" && b.model.trim() ? b.model.trim() : "Phone").slice(0, 120);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO files (id, home_of, type, name, created_by, created_at, body, body_version) VALUES (?1, ?2, 'device', ?3, ?2, ?4, ?5, 1)").bind(id, tenant.userId, name, now, JSON.stringify(checked.body)),
      env.DB.prepare("INSERT INTO devices (file_id, user_id, fingerprint, seen_at) VALUES (?1, ?2, ?3, ?4)").bind(id, tenant.userId, fp, now),
    ]);
    return json({ file: await fileOut(env, id) }, 201);
  });
}
