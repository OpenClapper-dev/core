/**
 * Lights (#208): fixtures and mesh networks. Workspace isolation is in tenancy.test.ts; this file
 * covers the rules of the routes themselves.
 */
import { beforeAll, describe, expect, test } from "vitest";
import { api, fixtureBody, newUser, ok, uuid, type User } from "./helpers.ts";

type Fixture = { id: string; workspace_id: string; kind_id: string; mesh_network_id: string | null; mesh_unicast: number | null; mesh_elements: number | null };

describe("fixtures", () => {
  let u: User;
  beforeAll(async () => { u = await newUser(); });

  const net = async () => {
    const id = uuid();
    await ok(api(u.token, "PUT", `/api/mesh-networks/${id}`, { name: "Set A" }));
    return id;
  };

  test("a GATT light: created in the caller's own workspace, listed, kept there on update", async () => {
    const id = uuid();
    const made = await ok<{ fixture: Fixture }>(api(u.token, "PUT", `/api/fixtures/${id}`, { label: "Key", kind_id: "neewer-fs230b", address: "C8:47:8C:00:11:22" }));
    expect(made.fixture).toMatchObject({ id, kind_id: "neewer-fs230b", mesh_network_id: null, mesh_unicast: null });
    await ok(api(u.token, "PUT", `/api/fixtures/${id}`, { label: "Key left", kind_id: "neewer-fs230b", address: "C8:47:8C:00:11:22" }));
    const list = await ok<{ fixtures: (Fixture & { label: string })[] }>(api(u.token, "GET", "/api/fixtures"));
    expect(list.fixtures.find((f) => f.id === id)).toMatchObject({ label: "Key left", workspace_id: made.fixture.workspace_id });
  });

  test.each([
    ["an unknown kind", { kind_id: "neewer-sl90" }],
    ["a lower-case address", { address: "c8:47:8c:00:11:22" }],
    ["no label", { label: " " }],
  ])("refuses %s", async (_name, patch) => {
    await ok(api(u.token, "PUT", `/api/fixtures/${uuid()}`, { ...fixtureBody("x"), ...patch }), 400);
  });

  test("mesh fields: only on a mesh kind, only with a known network, one unicast address each", async () => {
    const n = await net();
    await ok(api(u.token, "PUT", `/api/fixtures/${uuid()}`, { label: "x", kind_id: "neewer-fs300b", address: "C8:47:8C:00:11:23", mesh_network_id: n, mesh_unicast: 2 }), 400);
    await ok(api(u.token, "PUT", `/api/fixtures/${uuid()}`, fixtureBody("x", { mesh_network_id: uuid(), mesh_unicast: 2 })), 400);
    await ok(api(u.token, "PUT", `/api/fixtures/${uuid()}`, fixtureBody("x", { mesh_network_id: n })), 400);
    const a = uuid();
    const first = await ok<{ fixture: Fixture }>(api(u.token, "PUT", `/api/fixtures/${a}`, fixtureBody("MC 1", { mesh_network_id: n, mesh_unicast: 2 })));
    expect(first.fixture).toMatchObject({ mesh_network_id: n, mesh_unicast: 2, mesh_elements: 1 });
    await ok(api(u.token, "PUT", `/api/fixtures/${uuid()}`, fixtureBody("MC 2", { mesh_network_id: n, mesh_unicast: 2 })), 409);
    // The same fixture saved again keeps its own address.
    await ok(api(u.token, "PUT", `/api/fixtures/${a}`, fixtureBody("MC 1 renamed", { mesh_network_id: n, mesh_unicast: 2 })));
  });

  test("deleting a network leaves its fixtures, unprovisioned", async () => {
    const n = await net();
    const a = uuid();
    await ok(api(u.token, "PUT", `/api/fixtures/${a}`, fixtureBody("MC", { mesh_network_id: n, mesh_unicast: 5, mesh_elements: 2 })));
    await ok(api(u.token, "DELETE", `/api/mesh-networks/${n}`));
    const list = await ok<{ fixtures: Fixture[] }>(api(u.token, "GET", "/api/fixtures"));
    expect(list.fixtures.find((f) => f.id === a)).toMatchObject({ mesh_network_id: null, mesh_unicast: null, mesh_elements: null });
    const nets = await ok<{ mesh_networks: { id: string }[] }>(api(u.token, "GET", "/api/mesh-networks"));
    expect(nets.mesh_networks.some((x) => x.id === n)).toBe(false);
  });

  test("network counters are the phone's and are validated", async () => {
    const n = uuid();
    const made = await ok<{ mesh_network: { iv_index: number; next_unicast: number } }>(api(u.token, "PUT", `/api/mesh-networks/${n}`, { name: "Set B", iv_index: 3, next_unicast: 12 }));
    expect(made.mesh_network).toMatchObject({ iv_index: 3, next_unicast: 12 });
    await ok(api(u.token, "PUT", `/api/mesh-networks/${n}`, { name: "Set B", next_unicast: 1.5 }), 400);
    await ok(api(u.token, "PUT", `/api/mesh-networks/${n}`, { name: "Set B", iv_index: -1 }), 400);
  });

  test("deleting a fixture", async () => {
    const a = uuid();
    await ok(api(u.token, "PUT", `/api/fixtures/${a}`, fixtureBody("gone")));
    await ok(api(u.token, "DELETE", `/api/fixtures/${a}`));
    await ok(api(u.token, "DELETE", `/api/fixtures/${a}`), 404);
  });
});
