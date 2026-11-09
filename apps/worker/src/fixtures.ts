import { fixtureKind, FIXTURE_LABEL_MAX, isBleAddress, MESH_UNICAST_MAX } from "@openclapper/vocab";
import { assertNumber, assertString, assertUuid, HttpError, json, readJson, type Router } from "@openclapper/service-kit";
import type { Ctx } from "./index.ts";
import { accessIfExists, assertAccess, assertRank, defaultWorkspace, inWorkspaces, workspaceOf } from "./tenancy.ts";

export interface MeshNetworkRow {
  id: string; workspace_id: string; name: string; iv_index: number; next_unicast: number;
  holder: string | null; seq_floor: number; key_backup_at: string | null; created_at: string; updated_at: string | null;
}

/** Everything of a network but its key backup, which only the backup route hands out. */
const NETWORK_COLUMNS = "id, workspace_id, name, iv_index, next_unicast, holder, seq_floor, key_backup_at, created_at, updated_at";
/** A network's encrypted keys are small (a few hundred bytes per light); this bounds a stray upload. */
const KEY_BACKUP_MAX = 64 * 1024;
const SEQ_MAX = 0xffffff;

const networkRow = (env: Ctx["env"], id: string) =>
  env.DB.prepare(`SELECT ${NETWORK_COLUMNS} FROM mesh_networks WHERE id = ?1`).bind(id).first<MeshNetworkRow>();

/** One phone at a time (#303): a write naming another holder than the network's is refused, so a phone that lost the network learns it. */
async function assertHolder(env: Ctx["env"], id: string, holder: string | null) {
  if (holder == null) return;
  const cur = await env.DB.prepare("SELECT holder FROM mesh_networks WHERE id = ?1").bind(id).first<{ holder: string | null }>();
  if (cur?.holder && cur.holder !== holder) throw new HttpError(409, "the network is in use on another phone");
}
export interface FixtureRow {
  id: string; workspace_id: string; label: string; kind_id: string; address: string;
  mesh_network_id: string | null; mesh_unicast: number | null; mesh_elements: number | null; powered_by: string | null; asleep: number; created_at: string; updated_at: string | null;
}

const assertInt = (v: unknown, field: string, min: number, max: number): number => {
  const n = assertNumber(v, field, { min, max });
  if (!Number.isInteger(n)) throw new HttpError(400, `${field} must be a whole number`);
  return n;
};

/** A new row goes to `workspace_id` (default: the caller's own workspace); an existing one keeps its workspace. */
const targetWorkspace = async (ctx: Ctx, kind: "fixture" | "mesh_network", id: string, b: Record<string, unknown>) =>
  (await accessIfExists(ctx, kind, id, "editor"))
    ?? (b.workspace_id == null ? await defaultWorkspace(ctx) : assertRank(ctx, assertUuid(b.workspace_id, "workspace_id"), "editor", "workspace not found"));

/**
 * Lights (epic #206): fixtures and the Bluetooth Mesh networks the phone provisions for them. Both
 * belong to a workspace and are shared by its projects, like rigs. Client-owned ids, upsert. Mesh
 * keys reach the server only encrypted on the phone (#303), as a backup it cannot read.
 */
export function registerFixtureRoutes(r: Router<Ctx>) {
  r.on("GET", "/api/mesh-networks", async ({ env, tenant }) => {
    const { results } = await env.DB.prepare(`SELECT ${NETWORK_COLUMNS} FROM mesh_networks WHERE ${inWorkspaces("workspace_id", 1)} ORDER BY name COLLATE NOCASE`)
      .bind(tenant.wsList).all<MeshNetworkRow>();
    return json({ mesh_networks: results });
  });

  /**
   * JSON { name, iv_index?, next_unicast?, holder?, seq_floor?, workspace_id? }. The phone is the provisioner, so its
   * counters win; the sequence floor only rises. `holder` (the phone's device id) is taken when the network has none,
   * and a different one is refused with 409 (#303).
   */
  r.on("PUT", "/api/mesh-networks/:id", async (ctx, { id }) => {
    const { env, request } = ctx;
    const nid = assertUuid(id, "id");
    const b = await readJson<Record<string, unknown>>(request);
    const ws = await targetWorkspace(ctx, "mesh_network", nid, b);
    const name = assertString(b.name, "name", FIXTURE_LABEL_MAX);
    const iv = assertInt(b.iv_index ?? 0, "iv_index", 0, 0xffffffff);
    const next = assertInt(b.next_unicast ?? 2, "next_unicast", 1, MESH_UNICAST_MAX + 1);
    const holder = b.holder == null ? null : assertUuid(b.holder, "holder");
    const floor = assertInt(b.seq_floor ?? 0, "seq_floor", 0, SEQ_MAX + 1);
    await assertHolder(env, nid, holder);
    await env.DB.prepare(
      `INSERT INTO mesh_networks (id, workspace_id, name, iv_index, next_unicast, holder, seq_floor, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT(id) DO UPDATE SET name = ?3, iv_index = ?4, next_unicast = ?5, holder = COALESCE(mesh_networks.holder, ?6),
         seq_floor = MAX(mesh_networks.seq_floor, ?7), updated_at = ?8`,
    ).bind(nid, ws, name, iv, next, holder, floor, new Date().toISOString()).run();
    return json({ mesh_network: await networkRow(env, nid) });
  });

  /** The network's encrypted keys (#303), for a phone restoring them. */
  r.on("GET", "/api/mesh-networks/:id/key-backup", async (ctx, { id }) => {
    const nid = assertUuid(id, "id");
    await assertAccess(ctx, "mesh_network", nid, "editor");
    const row = await ctx.env.DB.prepare("SELECT key_backup, key_backup_at FROM mesh_networks WHERE id = ?1").bind(nid)
      .first<{ key_backup: string | null; key_backup_at: string | null }>();
    return json({ key_backup: row?.key_backup ?? null, key_backup_at: row?.key_backup_at ?? null });
  });

  /** JSON { key_backup, holder }: the phone holding the network replaces its encrypted keys. Opaque to the server. */
  r.on("PUT", "/api/mesh-networks/:id/key-backup", async (ctx, { id }) => {
    const { env, request } = ctx;
    const nid = assertUuid(id, "id");
    await assertAccess(ctx, "mesh_network", nid, "editor");
    const b = await readJson<Record<string, unknown>>(request);
    const blob = assertString(b.key_backup, "key_backup", KEY_BACKUP_MAX);
    const holder = assertUuid(b.holder, "holder");
    await assertHolder(env, nid, holder);
    const now = new Date().toISOString();
    await env.DB.prepare("UPDATE mesh_networks SET key_backup = ?2, key_backup_at = ?3, holder = COALESCE(holder, ?4), updated_at = ?3 WHERE id = ?1")
      .bind(nid, blob, now, holder).run();
    return json({ mesh_network: await networkRow(env, nid) });
  });

  /**
   * JSON { holder }: this phone takes the network over (a restore, or taking it back). The previous holder is
   * refused from then on; the answer's seq_floor tells the new holder where to start counting.
   */
  r.on("POST", "/api/mesh-networks/:id/claim", async (ctx, { id }) => {
    const { env, request } = ctx;
    const nid = assertUuid(id, "id");
    await assertAccess(ctx, "mesh_network", nid, "editor");
    const b = await readJson<Record<string, unknown>>(request);
    const holder = assertUuid(b.holder, "holder");
    await env.DB.prepare("UPDATE mesh_networks SET holder = ?2, updated_at = ?3 WHERE id = ?1").bind(nid, holder, new Date().toISOString()).run();
    return json({ mesh_network: await networkRow(env, nid) });
  });

  /** Its fixtures stay, unprovisioned: the lights still hold the old keys until they are reset. */
  r.on("DELETE", "/api/mesh-networks/:id", async (ctx, { id }) => {
    const { env } = ctx;
    const nid = assertUuid(id, "id");
    await assertAccess(ctx, "mesh_network", nid, "editor");
    await env.DB.batch([
      env.DB.prepare("UPDATE fixtures SET mesh_network_id = NULL, mesh_unicast = NULL, mesh_elements = NULL, updated_at = ?2 WHERE mesh_network_id = ?1").bind(nid, new Date().toISOString()),
      env.DB.prepare("DELETE FROM mesh_networks WHERE id = ?1").bind(nid),
    ]);
    return json({ deleted: nid });
  });

  r.on("GET", "/api/fixtures", async ({ env, tenant }) => {
    const { results } = await env.DB.prepare(`SELECT * FROM fixtures WHERE ${inWorkspaces("workspace_id", 1)} ORDER BY label COLLATE NOCASE`)
      .bind(tenant.wsList).all<FixtureRow>();
    return json({ fixtures: results });
  });

  /**
   * JSON { label, kind_id, address, mesh_network_id?, mesh_unicast?, mesh_elements?, workspace_id? }.
   * Strict (a pairing is an interactive edit): the kind must be known, mesh fields only on a mesh
   * kind and only with a network of the fixture's own workspace, one unicast address per network.
   */
  r.on("PUT", "/api/fixtures/:id", async (ctx, { id }) => {
    const { env, request } = ctx;
    const fid = assertUuid(id, "id");
    const b = await readJson<Record<string, unknown>>(request);
    const ws = await targetWorkspace(ctx, "fixture", fid, b);
    const label = assertString(b.label, "label", FIXTURE_LABEL_MAX);
    const kind = typeof b.kind_id === "string" ? fixtureKind(b.kind_id) : undefined;
    if (!kind) throw new HttpError(400, "kind_id is not a known fixture kind");
    if (!isBleAddress(b.address)) throw new HttpError(400, "address must be a Bluetooth address like AA:BB:CC:DD:EE:FF");

    let network: string | null = null, unicast: number | null = null, elements: number | null = null;
    if (b.mesh_network_id != null) {
      if (kind.transport !== "mesh") throw new HttpError(400, `${kind.id} is not a mesh fixture`);
      network = assertUuid(b.mesh_network_id, "mesh_network_id");
      // Another workspace's network answers like a missing one (tenancy.ts assertRef).
      if ((await workspaceOf(env, "mesh_network", network)) !== ws) throw new HttpError(400, "mesh_network_id does not exist");
      unicast = assertInt(b.mesh_unicast, "mesh_unicast", 1, MESH_UNICAST_MAX);
      elements = assertInt(b.mesh_elements ?? 1, "mesh_elements", 1, 255);
      const taken = await env.DB.prepare("SELECT id FROM fixtures WHERE mesh_network_id = ?1 AND mesh_unicast = ?2 AND id != ?3").bind(network, unicast, fid).first();
      if (taken) throw new HttpError(409, "another fixture has that unicast address in this network");
    }

    await env.DB.prepare(
      `INSERT INTO fixtures (id, workspace_id, label, kind_id, address, mesh_network_id, mesh_unicast, mesh_elements, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
       ON CONFLICT(id) DO UPDATE SET label = ?3, kind_id = ?4, address = ?5, mesh_network_id = ?6, mesh_unicast = ?7, mesh_elements = ?8, updated_at = ?9`,
    ).bind(fid, ws, label, kind.id, b.address, network, unicast, elements, new Date().toISOString()).run();
    return json({ fixture: await env.DB.prepare("SELECT * FROM fixtures WHERE id = ?1").bind(fid).first<FixtureRow>() });
  });

  /**
   * JSON { powered_by }: the battery a light runs on (#294), or null for a socket. Only for lights
   * without a battery of their own, only a battery of the same workspace; one light per battery, so the
   * battery leaves any other light it was assigned to.
   */
  r.on("PUT", "/api/fixtures/:id/power", async (ctx, { id }) => {
    const { env, request } = ctx;
    const fid = assertUuid(id, "id");
    const ws = await assertAccess(ctx, "fixture", fid, "editor");
    const b = await readJson<Record<string, unknown>>(request);
    const light = await env.DB.prepare("SELECT kind_id FROM fixtures WHERE id = ?1").bind(fid).first<{ kind_id: string }>();
    const kind = light ? fixtureKind(light.kind_id) : undefined;
    if (!kind?.caps.power || kind.caps.telemetry.includes("battery")) throw new HttpError(400, "only a light without its own battery can be given one");
    const battery = b.powered_by == null ? null : assertUuid(b.powered_by, "powered_by");
    if (battery) {
      const row = await env.DB.prepare("SELECT kind_id, workspace_id FROM fixtures WHERE id = ?1").bind(battery).first<{ kind_id: string; workspace_id: string }>();
      const bk = row ? fixtureKind(row.kind_id) : undefined;
      // Another workspace's battery answers like a missing one.
      if (!row || row.workspace_id !== ws) throw new HttpError(400, "powered_by does not exist");
      if (!bk || bk.caps.power || !bk.caps.telemetry.includes("battery")) throw new HttpError(400, "powered_by is not a battery");
    }
    const now = new Date().toISOString();
    await env.DB.batch([
      ...(battery ? [env.DB.prepare("UPDATE fixtures SET powered_by = NULL, updated_at = ?3 WHERE powered_by = ?1 AND id != ?2").bind(battery, fid, now)] : []),
      env.DB.prepare("UPDATE fixtures SET powered_by = ?2, updated_at = ?3 WHERE id = ?1").bind(fid, battery, now),
    ]);
    return json({ fixture: await env.DB.prepare("SELECT * FROM fixtures WHERE id = ?1").bind(fid).first<FixtureRow>() });
  });

  /** JSON { asleep }: the phone proxy leaves a sleeping device alone (no connection attempts) until it is woken (#318). */
  r.on("PUT", "/api/fixtures/:id/sleep", async (ctx, { id }) => {
    const { env, request } = ctx;
    const fid = assertUuid(id, "id");
    await assertAccess(ctx, "fixture", fid, "editor");
    const b = await readJson<Record<string, unknown>>(request);
    if (typeof b.asleep !== "boolean") throw new HttpError(400, "asleep must be true or false");
    await env.DB.prepare("UPDATE fixtures SET asleep = ?2, updated_at = ?3 WHERE id = ?1").bind(fid, b.asleep ? 1 : 0, new Date().toISOString()).run();
    return json({ fixture: await env.DB.prepare("SELECT * FROM fixtures WHERE id = ?1").bind(fid).first<FixtureRow>() });
  });

  r.on("DELETE", "/api/fixtures/:id", async (ctx, { id }) => {
    const { env } = ctx;
    const fid = assertUuid(id, "id");
    await assertAccess(ctx, "fixture", fid, "editor");
    // A deleted battery leaves the light it powered on "not set".
    await env.DB.batch([
      env.DB.prepare("UPDATE fixtures SET powered_by = NULL WHERE powered_by = ?1").bind(fid),
      env.DB.prepare("DELETE FROM fixtures WHERE id = ?1").bind(fid),
    ]);
    return json({ deleted: fid });
  });
}
