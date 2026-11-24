/**
 * The Hardware extension's routes (docs/features/hardware.md). Hardware lives in the account's device registry:
 * device files of the account home whose kind is a hardware type. These routes do what the general file route
 * must not: make a device (pairing), and keep the rules that span devices (one battery powers one light, one
 * unicast address per mesh network). Mesh networks are the extension's own table; their keys reach the server
 * only sealed on the phone, as a backup it cannot read.
 */
import { checkFile, fileType } from "@openclapper/model";
import { MESH_UNICAST_MAX, modelOf, newHardware, type HardwareBody } from "@openclapper/ext-hardware";
import { assertNumber, assertString, assertUuid, HttpError, json, readJson, type Router } from "@openclapper/service-kit";
import { fileOut } from "../../files.ts";
import type { Ctx } from "../../index.ts";

interface NetworkRow { id: string; name: string; iv_index: number; next_unicast: number; holder: string | null; seq_floor: number; key_backup_at: string | null; created_at: string; updated_at: string | null }
/** Everything of a network but its key backup, which only the backup route hands out. */
const COLUMNS = "id, name, iv_index, next_unicast, holder, seq_floor, key_backup_at, created_at, updated_at";
/** A network's sealed keys are small (a few hundred bytes per light); this bounds a stray upload. */
const KEY_BACKUP_MAX = 64 * 1024;
const SEQ_MAX = 0xffffff;

const assertInt = (v: unknown, field: string, min: number, max: number): number => {
  const n = assertNumber(v, field, { min, max });
  if (!Number.isInteger(n)) throw new HttpError(400, `${field} must be a whole number`);
  return n;
};
const network = (ctx: Ctx, id: string) => ctx.env.DB.prepare(`SELECT ${COLUMNS} FROM hw_mesh_networks WHERE id = ?1 AND user_id = ?2`).bind(id, ctx.tenant.userId).first<NetworkRow>();
async function ownNetwork(ctx: Ctx, id: string): Promise<NetworkRow> {
  const n = await network(ctx, id);
  if (!n) throw new HttpError(404, "mesh network not found");
  return n;
}
/** One phone sends in a network at a time: a write naming another holder is refused, so a phone that lost the network learns it. */
function assertHolder(n: NetworkRow | null, holder: string | null) {
  if (holder && n?.holder && n.holder !== holder) throw new HttpError(409, "the network is in use on another phone");
}

interface DeviceRow { id: string; body: string }
/** A hardware device of the caller's own home (any other answers 404, like a missing one). */
async function ownDevice(ctx: Ctx, id: string): Promise<{ id: string; body: HardwareBody }> {
  const row = await ctx.env.DB.prepare("SELECT id, body FROM files WHERE id = ?1 AND home_of = ?2 AND type = 'device' AND deleted_at IS NULL").bind(id, ctx.tenant.userId).first<DeviceRow>();
  const body = row ? (JSON.parse(row.body) as HardwareBody) : null;
  if (!row || !body || !modelOf(body.model)) throw new HttpError(404, "device not found");
  return { id: row.id, body };
}
const saveBody = (ctx: Ctx, id: string, body: HardwareBody, at: string) => {
  const checked = checkFile(fileType("device")!, body, 1, null);
  if (!checked.ok) throw new HttpError(400, checked.error);
  return ctx.env.DB.prepare("UPDATE files SET body = ?2, updated_at = ?3 WHERE id = ?1").bind(id, JSON.stringify(checked.body), at);
};
/** The caller's live hardware devices with their bodies. */
async function devices(ctx: Ctx): Promise<{ id: string; body: HardwareBody }[]> {
  const { results } = await ctx.env.DB.prepare("SELECT id, body FROM files WHERE home_of = ?1 AND type = 'device' AND deleted_at IS NULL").bind(ctx.tenant.userId).all<DeviceRow>();
  return results.map((r) => ({ id: r.id, body: JSON.parse(r.body) as HardwareBody })).filter((d) => !!modelOf(d.body.model));
}

export function registerHardwareRoutes(r: Router<Ctx>) {
  /**
   * Adds a device (pairing): JSON { id, model, address, name? }. Client-owned id; the same id again answers the
   * device as it is (a retry). Strict: the model must be in the catalogue and the address fit its transport.
   */
  r.on("POST", "/api/hardware/devices", async (ctx) => {
    const { env, request, tenant } = ctx;
    const b = await readJson<Record<string, unknown>>(request);
    const id = assertUuid(b.id, "id");
    const existing = await env.DB.prepare("SELECT id, home_of FROM files WHERE id = ?1").bind(id).first<{ id: string; home_of: string | null }>();
    if (existing) {
      if (existing.home_of !== tenant.userId) throw new HttpError(409, "id is taken");
      return json({ file: await fileOut(env, id) });
    }
    const model = modelOf(b.model);
    if (!model) throw new HttpError(400, "model is not in the catalogue");
    const body = newHardware(model.id, model.transport === "wifi" ? null : (b.address as string));
    const checked = checkFile(fileType("device")!, body, 1, null);
    if (!checked.ok) throw new HttpError(400, checked.error);
    const name = b.name == null ? `${model.brand} ${model.model}` : assertString(b.name, "name", 120).trim() || model.model;
    await env.DB.prepare("INSERT INTO files (id, home_of, type, name, created_by, created_at, body, body_version) VALUES (?1, ?2, 'device', ?3, ?2, ?4, ?5, 1)")
      .bind(id, tenant.userId, name, new Date().toISOString(), JSON.stringify(checked.body)).run();
    return json({ file: await fileOut(env, id) }, 201);
  });

  /**
   * JSON { battery }: the battery a light runs on, or null for a socket. Only for a light that takes one, only a
   * battery of the same account; one light per battery, so the battery leaves any other light it powered.
   */
  r.on("PUT", "/api/hardware/devices/:id/power", async (ctx, { id }) => {
    const light = await ownDevice(ctx, assertUuid(id, "id"));
    if (!modelOf(light.body.model)!.takesBattery) throw new HttpError(400, "only a light without its own battery can be given one");
    const b = await readJson<Record<string, unknown>>(ctx.request);
    const battery = b.battery == null ? null : assertUuid(b.battery, "battery");
    const at = new Date().toISOString();
    const stmts = [];
    if (battery) {
      // Another account's battery answers like a missing one.
      const bat = await ownDevice(ctx, battery).catch(() => { throw new HttpError(400, "battery does not exist"); });
      if (!modelOf(bat.body.model)!.powers) throw new HttpError(400, "battery is not a battery");
      for (const other of await devices(ctx)) if (other.id !== light.id && other.body.poweredBy === battery) stmts.push(saveBody(ctx, other.id, { ...other.body, poweredBy: null }, at));
    }
    stmts.push(saveBody(ctx, light.id, { ...light.body, poweredBy: battery }, at));
    await ctx.env.DB.batch(stmts);
    return json({ file: await fileOut(ctx.env, light.id) });
  });

  /**
   * JSON { network, unicast, elements } or { network: null }: where a mesh light sits in the phone's network,
   * after pairing (or nowhere, after a reset). One unicast address per network.
   */
  r.on("PUT", "/api/hardware/devices/:id/mesh", async (ctx, { id }) => {
    const dev = await ownDevice(ctx, assertUuid(id, "id"));
    if (modelOf(dev.body.model)!.transport !== "mesh") throw new HttpError(400, "the device is not paired through a mesh");
    const b = await readJson<Record<string, unknown>>(ctx.request);
    let mesh: HardwareBody["mesh"] = null;
    if (b.network != null) {
      const net = assertUuid(b.network, "network");
      if (!(await network(ctx, net))) throw new HttpError(400, "network does not exist");
      mesh = { network: net, unicast: assertInt(b.unicast, "unicast", 1, MESH_UNICAST_MAX), elements: assertInt(b.elements ?? 1, "elements", 1, 255) };
      const taken = (await devices(ctx)).some((d) => d.id !== dev.id && d.body.mesh?.network === net && d.body.mesh.unicast === mesh!.unicast);
      if (taken) throw new HttpError(409, "another device has that unicast address in this network");
    }
    await saveBody(ctx, dev.id, { ...dev.body, mesh }, new Date().toISOString()).run();
    return json({ file: await fileOut(ctx.env, dev.id) });
  });

  r.on("GET", "/api/hardware/mesh-networks", async (ctx) => {
    const { results } = await ctx.env.DB.prepare(`SELECT ${COLUMNS} FROM hw_mesh_networks WHERE user_id = ?1 ORDER BY name COLLATE NOCASE`).bind(ctx.tenant.userId).all<NetworkRow>();
    return json({ mesh_networks: results });
  });

  /**
   * JSON { name, iv_index?, next_unicast?, holder?, seq_floor? }. The phone is the provisioner, so its counters
   * win; the sequence floor only rises. `holder` (the phone's device id) is taken when the network has none, and
   * a different one is refused with 409. Another account's id is refused like a taken one.
   */
  r.on("PUT", "/api/hardware/mesh-networks/:id", async (ctx, { id }) => {
    const { env, request, tenant } = ctx;
    const nid = assertUuid(id, "id");
    const b = await readJson<Record<string, unknown>>(request);
    const name = assertString(b.name, "name", 60);
    const iv = assertInt(b.iv_index ?? 0, "iv_index", 0, 0xffffffff);
    const next = assertInt(b.next_unicast ?? 2, "next_unicast", 1, MESH_UNICAST_MAX + 1);
    const holder = b.holder == null ? null : assertUuid(b.holder, "holder");
    const floor = assertInt(b.seq_floor ?? 0, "seq_floor", 0, SEQ_MAX + 1);
    const other = await env.DB.prepare("SELECT user_id FROM hw_mesh_networks WHERE id = ?1").bind(nid).first<{ user_id: string }>();
    if (other && other.user_id !== tenant.userId) throw new HttpError(404, "mesh network not found");
    assertHolder(await network(ctx, nid), holder);
    const at = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO hw_mesh_networks (id, user_id, name, iv_index, next_unicast, holder, seq_floor, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT(id) DO UPDATE SET name = ?3, iv_index = ?4, next_unicast = ?5, holder = COALESCE(hw_mesh_networks.holder, ?6),
         seq_floor = MAX(hw_mesh_networks.seq_floor, ?7), updated_at = ?8`,
    ).bind(nid, tenant.userId, name, iv, next, holder, floor, at).run();
    return json({ mesh_network: await network(ctx, nid) });
  });

  /** The network's sealed keys, for a phone restoring them. */
  r.on("GET", "/api/hardware/mesh-networks/:id/key-backup", async (ctx, { id }) => {
    const nid = assertUuid(id, "id");
    await ownNetwork(ctx, nid);
    const row = await ctx.env.DB.prepare("SELECT key_backup, key_backup_at FROM hw_mesh_networks WHERE id = ?1").bind(nid).first<{ key_backup: string | null; key_backup_at: string | null }>();
    return json({ key_backup: row?.key_backup ?? null, key_backup_at: row?.key_backup_at ?? null });
  });

  /** JSON { key_backup, holder }: the phone holding the network replaces its sealed keys. Opaque to the server. */
  r.on("PUT", "/api/hardware/mesh-networks/:id/key-backup", async (ctx, { id }) => {
    const nid = assertUuid(id, "id");
    const n = await ownNetwork(ctx, nid);
    const b = await readJson<Record<string, unknown>>(ctx.request);
    const blob = assertString(b.key_backup, "key_backup", KEY_BACKUP_MAX);
    const holder = assertUuid(b.holder, "holder");
    assertHolder(n, holder);
    const at = new Date().toISOString();
    await ctx.env.DB.prepare("UPDATE hw_mesh_networks SET key_backup = ?2, key_backup_at = ?3, holder = COALESCE(holder, ?4), updated_at = ?3 WHERE id = ?1").bind(nid, blob, at, holder).run();
    return json({ mesh_network: await network(ctx, nid) });
  });

  /** JSON { holder }: this phone takes the network over (a restore, or taking it back); the answer's seq_floor says where to count from. */
  r.on("POST", "/api/hardware/mesh-networks/:id/claim", async (ctx, { id }) => {
    const nid = assertUuid(id, "id");
    await ownNetwork(ctx, nid);
    const b = await readJson<Record<string, unknown>>(ctx.request);
    const holder = assertUuid(b.holder, "holder");
    await ctx.env.DB.prepare("UPDATE hw_mesh_networks SET holder = ?2, updated_at = ?3 WHERE id = ?1").bind(nid, holder, new Date().toISOString()).run();
    return json({ mesh_network: await network(ctx, nid) });
  });

  /** Its lights stay, unpaired: they still hold the old keys until they are reset. */
  r.on("DELETE", "/api/hardware/mesh-networks/:id", async (ctx, { id }) => {
    const nid = assertUuid(id, "id");
    await ownNetwork(ctx, nid);
    const at = new Date().toISOString();
    const stmts = (await devices(ctx)).filter((d) => d.body.mesh?.network === nid).map((d) => saveBody(ctx, d.id, { ...d.body, mesh: null }, at));
    await ctx.env.DB.batch([...stmts, ctx.env.DB.prepare("DELETE FROM hw_mesh_networks WHERE id = ?1").bind(nid)]);
    return json({ deleted: nid });
  });
}
