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

  test("key backup (#303): opaque blob, not in the list, one holder at a time, the floor only rises", async () => {
    const n = uuid(), phoneA = uuid(), phoneB = uuid();
    type Net = { holder: string | null; seq_floor: number; key_backup_at: string | null };
    const made = await ok<{ mesh_network: Net }>(api(u.token, "PUT", `/api/mesh-networks/${n}`, { name: "Set C", holder: phoneA, seq_floor: 4096 }));
    expect(made.mesh_network).toMatchObject({ holder: phoneA, seq_floor: 4096, key_backup_at: null });
    expect(await ok<{ key_backup: string | null }>(api(u.token, "GET", `/api/mesh-networks/${n}/key-backup`))).toMatchObject({ key_backup: null });

    const saved = await ok<{ mesh_network: Net }>(api(u.token, "PUT", `/api/mesh-networks/${n}/key-backup`, { key_backup: "v1.sealed", holder: phoneA }));
    expect(saved.mesh_network.key_backup_at).not.toBeNull();
    const list = await ok<{ mesh_networks: Record<string, unknown>[] }>(api(u.token, "GET", "/api/mesh-networks"));
    expect(list.mesh_networks.find((x) => x.id === n)).not.toHaveProperty("key_backup");
    expect(await ok<{ key_backup: string }>(api(u.token, "GET", `/api/mesh-networks/${n}/key-backup`))).toMatchObject({ key_backup: "v1.sealed" });

    // Another phone may not write while A holds the network; it claims it first, and then A is refused.
    await ok(api(u.token, "PUT", `/api/mesh-networks/${n}/key-backup`, { key_backup: "v2", holder: phoneB }), 409);
    await ok(api(u.token, "PUT", `/api/mesh-networks/${n}`, { name: "Set C", holder: phoneB }), 409);
    const claimed = await ok<{ mesh_network: Net }>(api(u.token, "POST", `/api/mesh-networks/${n}/claim`, { holder: phoneB }));
    expect(claimed.mesh_network).toMatchObject({ holder: phoneB, seq_floor: 4096 });
    await ok(api(u.token, "PUT", `/api/mesh-networks/${n}`, { name: "Set C", holder: phoneA, seq_floor: 9000 }), 409);
    const lower = await ok<{ mesh_network: Net }>(api(u.token, "PUT", `/api/mesh-networks/${n}`, { name: "Set C", holder: phoneB, seq_floor: 100 }));
    expect(lower.mesh_network.seq_floor).toBe(4096);

    await ok(api(u.token, "PUT", `/api/mesh-networks/${n}/key-backup`, { key_backup: "x".repeat(64 * 1024 + 1), holder: phoneB }), 400);
    await ok(api(u.token, "POST", `/api/mesh-networks/${n}/claim`, { holder: "not-a-uuid" }), 400);
  });

  test("deleting a fixture", async () => {
    const a = uuid();
    await ok(api(u.token, "PUT", `/api/fixtures/${a}`, fixtureBody("gone")));
    await ok(api(u.token, "DELETE", `/api/fixtures/${a}`));
    await ok(api(u.token, "DELETE", `/api/fixtures/${a}`), 404);
  });
});

describe("power (#294)", () => {
  test("a battery powers one light at a time; sockets are null; only lights without a battery take one", async () => {
    const u2 = await newUser();
    const put = (id: string, label: string, kind: string, mac: string) => ok(api(u2.token, "PUT", `/api/fixtures/${id}`, { label, kind_id: kind, address: mac }));
    const [a, b, bat, mc] = [uuid(), uuid(), uuid(), uuid()];
    await put(a, "COB A", "neewer-fs230b", "C8:47:8C:00:33:01");
    await put(b, "COB B", "neewer-fs300b", "C8:47:8C:00:33:02");
    await put(bat, "Battery 1", "neewer-ps099s", "C8:47:8C:00:33:03");
    await put(mc, "MC", "aputure-mc", "DC:2C:26:00:33:04");
    type F = { id: string; powered_by: string | null };
    expect((await ok<{ fixture: F }>(api(u2.token, "PUT", `/api/fixtures/${a}/power`, { powered_by: bat }))).fixture.powered_by).toBe(bat);
    // The battery moves to B: A is left without.
    await ok(api(u2.token, "PUT", `/api/fixtures/${b}/power`, { powered_by: bat }));
    const list = (await ok<{ fixtures: F[] }>(api(u2.token, "GET", "/api/fixtures"))).fixtures;
    expect(list.find((f) => f.id === a)?.powered_by).toBeNull();
    expect(list.find((f) => f.id === b)?.powered_by).toBe(bat);
    // A rename (the full PUT) keeps the assignment.
    await put(b, "COB B renamed", "neewer-fs300b", "C8:47:8C:00:33:02");
    expect((await ok<{ fixtures: F[] }>(api(u2.token, "GET", "/api/fixtures"))).fixtures.find((f) => f.id === b)?.powered_by).toBe(bat);
    await ok(api(u2.token, "PUT", `/api/fixtures/${mc}/power`, { powered_by: bat }), 400);
    await ok(api(u2.token, "PUT", `/api/fixtures/${a}/power`, { powered_by: b }), 400);
    await ok(api(u2.token, "PUT", `/api/fixtures/${b}/power`, { powered_by: null }));
    // Deleting a battery unassigns it.
    await ok(api(u2.token, "PUT", `/api/fixtures/${a}/power`, { powered_by: bat }));
    await ok(api(u2.token, "DELETE", `/api/fixtures/${bat}`));
    expect((await ok<{ fixtures: F[] }>(api(u2.token, "GET", "/api/fixtures"))).fixtures.find((f) => f.id === a)?.powered_by).toBeNull();
  });
});
