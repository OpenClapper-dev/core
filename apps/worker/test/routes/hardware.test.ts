/** The Hardware extension (step B9, #381): devices in the account home, power relations, mesh networks and their key backups. */
import { beforeAll, describe, expect, test } from "vitest";
import { api, newUser, ok, uuid, type User } from "./helpers.ts";

interface Dev { id: string; name: string; home: boolean; body: { kind: string; model: string; address: string | null; mesh: unknown; poweredBy: string | null; asleep: boolean } }
let u: User;
beforeAll(async () => { u = await newUser(); });
let n = 0;
const addr = () => `AA:BB:CC:DD:${String(Math.floor(n / 100)).padStart(2, "0")}:${String(n++ % 100).padStart(2, "0")}`;
const add = async (model: string, extra: Record<string, unknown> = {}) => (await ok<{ file: Dev }>(api(u.token, "POST", "/api/hardware/devices", { id: uuid(), model, address: addr(), ...extra }), 201)).file;
const get = async (id: string) => (await ok<{ file: Dev }>(api(u.token, "GET", `/api/files/${id}`))).file;

describe("adding a device", () => {
  test("a device file in the account home, named after the model; the same id again is the same device", async () => {
    const id = uuid();
    const made = await ok<{ file: Dev }>(api(u.token, "POST", "/api/hardware/devices", { id, model: "neewer-fs300b", address: "AA:BB:CC:DD:EE:FF" }), 201);
    expect(made.file).toMatchObject({ id, name: "NEEWER FS300B", home: true, body: { kind: "light", model: "neewer-fs300b", address: "AA:BB:CC:DD:EE:FF", mesh: null, poweredBy: null, asleep: false } });
    const again = await ok<{ file: Dev }>(api(u.token, "POST", "/api/hardware/devices", { id, model: "neewer-fs230b", address: "AA:BB:CC:DD:EE:00" }), 200);
    expect(again.file.body.model).toBe("neewer-fs300b");
  });

  test("the transmitter has no Bluetooth address; refused: an unknown model, a bad address", async () => {
    const t = await add("hollyland-mars-400s-pro", { address: undefined, name: "Mars" });
    expect(t).toMatchObject({ name: "Mars", body: { kind: "transmitter", address: null } });
    await ok(api(u.token, "POST", "/api/hardware/devices", { id: uuid(), model: "toaster", address: addr() }), 400);
    await ok(api(u.token, "POST", "/api/hardware/devices", { id: uuid(), model: "neewer-fs230b", address: "nope" }), 400);
  });

  test("the general file route: rename and sleep, but not the model, the address or the battery", async () => {
    const d = await add("neewer-fs230b");
    const battery = await add("neewer-ps099s");
    await ok(api(u.token, "PUT", `/api/files/${d.id}`, { name: "Key light", body: { ...d.body, kind: "battery", model: "neewer-ps099s", address: "AA:AA:AA:AA:AA:AA", poweredBy: battery.id, asleep: true } }));
    expect(await get(d.id)).toMatchObject({ name: "Key light", body: { kind: "light", model: "neewer-fs230b", address: d.body.address, poweredBy: null, asleep: true } });
    await ok(api(u.token, "PUT", `/api/files/${d.id}`, { body: { ...d.body, asleep: "yes" } }), 400);
    await ok(api(u.token, "PUT", `/api/files/${uuid()}`, { type: "device", home: true, body: { ...d.body } }), 400);
  });
});

describe("power", () => {
  test("a battery powers one light: given to another, it leaves the first", async () => {
    const [a, b, bat] = [await add("neewer-fs230b"), await add("neewer-fs300b"), await add("neewer-ps099s")];
    await ok(api(u.token, "PUT", `/api/hardware/devices/${a.id}/power`, { battery: bat.id }));
    expect((await get(a.id)).body.poweredBy).toBe(bat.id);
    await ok(api(u.token, "PUT", `/api/hardware/devices/${b.id}/power`, { battery: bat.id }));
    expect((await get(a.id)).body.poweredBy).toBeNull();
    expect((await get(b.id)).body.poweredBy).toBe(bat.id);
    await ok(api(u.token, "PUT", `/api/hardware/devices/${b.id}/power`, { battery: null }));
    expect((await get(b.id)).body.poweredBy).toBeNull();
  });

  test("refused: a light with its own battery, a target that is no battery, another account's battery", async () => {
    const [mc, cob, other] = [await add("aputure-mc"), await add("neewer-fs230b"), await add("neewer-fs230b")];
    const bat = await add("neewer-ps099s");
    await ok(api(u.token, "PUT", `/api/hardware/devices/${mc.id}/power`, { battery: bat.id }), 400);
    await ok(api(u.token, "PUT", `/api/hardware/devices/${cob.id}/power`, { battery: other.id }), 400);
    const v = await newUser();
    const theirs = (await ok<{ file: Dev }>(api(v.token, "POST", "/api/hardware/devices", { id: uuid(), model: "neewer-ps099s", address: addr() }), 201)).file;
    await ok(api(u.token, "PUT", `/api/hardware/devices/${cob.id}/power`, { battery: theirs.id }), 400);
  });
});

describe("mesh", () => {
  test("a light's place in a network: one unicast address per network; deleting the network unpairs its lights", async () => {
    const net = uuid();
    await ok(api(u.token, "PUT", `/api/hardware/mesh-networks/${net}`, { name: "Mesh", next_unicast: 4 }));
    const [a, b] = [await add("aputure-mc"), await add("aputure-mc")];
    await ok(api(u.token, "PUT", `/api/hardware/devices/${a.id}/mesh`, { network: net, unicast: 2, elements: 1 }));
    await ok(api(u.token, "PUT", `/api/hardware/devices/${b.id}/mesh`, { network: net, unicast: 2, elements: 1 }), 409);
    await ok(api(u.token, "PUT", `/api/hardware/devices/${b.id}/mesh`, { network: uuid(), unicast: 3 }), 400);
    const cob = await add("neewer-fs230b");
    await ok(api(u.token, "PUT", `/api/hardware/devices/${cob.id}/mesh`, { network: net, unicast: 5 }), 400);
    expect((await get(a.id)).body.mesh).toEqual({ network: net, unicast: 2, elements: 1 });
    await ok(api(u.token, "DELETE", `/api/hardware/mesh-networks/${net}`));
    expect((await get(a.id)).body.mesh).toBeNull();
  });

  test("one phone sends at a time; the sequence floor only rises; the key backup is the holder's", async () => {
    const net = uuid(), phone = uuid(), other = uuid();
    const made = await ok<{ mesh_network: { holder: string; seq_floor: number } }>(api(u.token, "PUT", `/api/hardware/mesh-networks/${net}`, { name: "M", holder: phone, seq_floor: 500 }));
    expect(made.mesh_network).toMatchObject({ holder: phone, seq_floor: 500 });
    const lower = await ok<{ mesh_network: { seq_floor: number } }>(api(u.token, "PUT", `/api/hardware/mesh-networks/${net}`, { name: "M", holder: phone, seq_floor: 100 }));
    expect(lower.mesh_network.seq_floor).toBe(500);
    await ok(api(u.token, "PUT", `/api/hardware/mesh-networks/${net}`, { name: "M", holder: other }), 409);
    await ok(api(u.token, "PUT", `/api/hardware/mesh-networks/${net}/key-backup`, { key_backup: "sealed-1", holder: other }), 409);
    await ok(api(u.token, "PUT", `/api/hardware/mesh-networks/${net}/key-backup`, { key_backup: "sealed-1", holder: phone }));
    expect(await ok(api(u.token, "GET", `/api/hardware/mesh-networks/${net}/key-backup`))).toMatchObject({ key_backup: "sealed-1" });
    const claimed = await ok<{ mesh_network: { holder: string } }>(api(u.token, "POST", `/api/hardware/mesh-networks/${net}/claim`, { holder: other }));
    expect(claimed.mesh_network.holder).toBe(other);
    const list = await ok<{ mesh_networks: Record<string, unknown>[] }>(api(u.token, "GET", "/api/hardware/mesh-networks"));
    expect(list.mesh_networks.find((m) => m.id === net)).not.toHaveProperty("key_backup");
  });
});
