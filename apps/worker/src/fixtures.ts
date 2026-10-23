import { fixtureKind, FIXTURE_LABEL_MAX, isBleAddress, MESH_UNICAST_MAX } from "@openclapper/vocab";
import { assertNumber, assertString, assertUuid, HttpError, json, readJson, type Router } from "@openclapper/service-kit";
import type { Ctx } from "./index.ts";
import { accessIfExists, assertAccess, assertRank, defaultWorkspace, inWorkspaces, workspaceOf } from "./tenancy.ts";

export interface MeshNetworkRow {
  id: string; workspace_id: string; name: string; iv_index: number; next_unicast: number; created_at: string; updated_at: string | null;
}
export interface FixtureRow {
  id: string; workspace_id: string; label: string; kind_id: string; address: string;
  mesh_network_id: string | null; mesh_unicast: number | null; mesh_elements: number | null; created_at: string; updated_at: string | null;
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
 * keys never reach the server; the phone keeps them.
 */
export function registerFixtureRoutes(r: Router<Ctx>) {
  r.on("GET", "/api/mesh-networks", async ({ env, tenant }) => {
    const { results } = await env.DB.prepare(`SELECT * FROM mesh_networks WHERE ${inWorkspaces("workspace_id", 1)} ORDER BY name COLLATE NOCASE`)
      .bind(tenant.wsList).all<MeshNetworkRow>();
    return json({ mesh_networks: results });
  });

  /** JSON { name, iv_index?, next_unicast?, workspace_id? }. The phone is the provisioner, so its counters win. */
  r.on("PUT", "/api/mesh-networks/:id", async (ctx, { id }) => {
    const { env, request } = ctx;
    const nid = assertUuid(id, "id");
    const b = await readJson<Record<string, unknown>>(request);
    const ws = await targetWorkspace(ctx, "mesh_network", nid, b);
    const name = assertString(b.name, "name", FIXTURE_LABEL_MAX);
    const iv = assertInt(b.iv_index ?? 0, "iv_index", 0, 0xffffffff);
    const next = assertInt(b.next_unicast ?? 2, "next_unicast", 1, MESH_UNICAST_MAX + 1);
    await env.DB.prepare(
      `INSERT INTO mesh_networks (id, workspace_id, name, iv_index, next_unicast, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT(id) DO UPDATE SET name = ?3, iv_index = ?4, next_unicast = ?5, updated_at = ?6`,
    ).bind(nid, ws, name, iv, next, new Date().toISOString()).run();
    return json({ mesh_network: await env.DB.prepare("SELECT * FROM mesh_networks WHERE id = ?1").bind(nid).first<MeshNetworkRow>() });
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

  r.on("DELETE", "/api/fixtures/:id", async (ctx, { id }) => {
    const { env } = ctx;
    const fid = assertUuid(id, "id");
    await assertAccess(ctx, "fixture", fid, "editor");
    await env.DB.prepare("DELETE FROM fixtures WHERE id = ?1").bind(fid).run();
    return json({ deleted: fid });
  });
}
