import { test } from "node:test";
import assert from "node:assert/strict";
import { k2, k4, ofHex } from "../mesh/crypto.ts";
import { FakeProxyNode } from "../mesh/fakeNode.testlib.ts";
import { SeqAllocator } from "../mesh/seq.ts";
import { batteryRequest, cct, curve, effect, effectOff, hsi, intensity, power, statusRequest } from "../codecs/sidus.ts";
import type { Fixture, Telemetry } from "../types.ts";
import { sidusMesh } from "./sidusMesh.ts";

const NET_KEY = ofHex("7dd7364cd842ad18c17c2b820c84c3d6");
const APP_KEY = ofHex("63964771734fbd76e3b40519d1d94a48");
const DEV_KEY = ofHex("0520adad5e0142aa3e325087b4ec16d8");
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const mc = (id: string, unicast: number, mesh = true): Fixture =>
  ({ id, label: id, kindId: "aputure-mc", address: `DC:2C:26:00:00:0${unicast}`, mesh: mesh ? { networkId: "n1", unicast, elements: 3 } : null, createdAt: "", synced: true });

function setup(status?: Uint8Array, battery?: Uint8Array) {
  const node = new FakeProxyNode({ netKey: NET_KEY, ivIndex: 0x12345678, unicast: 3, devKey: DEV_KEY, composition: new Uint8Array(10), appKey: APP_KEY, status, battery });
  const seq = new SeqAllocator({ load: () => null, save: () => {} });
  const driver = sidusMesh({
    access: () => ({ keysFor: (id) => (id === "n1" ? { keys: { netKey: NET_KEY, net: k2(NET_KEY), appKey: APP_KEY, aid: k4(APP_KEY), ivIndex: 0x12345678, src: 1, devKeyOf: () => undefined }, seq, onIvIndex: () => {} } : null) }),
    wait: async () => {}, setupWaitMs: 100, repeats: 2, setInterval: () => 0, clearInterval: () => {},
  });
  return { node, driver };
}

test("one connection per network; only paired lights can be the proxy", () => {
  const { driver } = setup();
  assert.equal(driver.linkKey(mc("a", 3)), driver.linkKey(mc("b", 6)));
  assert.notEqual(driver.linkKey(mc("c", 0, false)), driver.linkKey(mc("a", 3)));
  assert.deepEqual(driver.addressesFor("mesh:n1", [mc("a", 3), mc("c", 0, false)]), ["DC:2C:26:00:00:03"]);
});

test("opening asks the light what it shows; its report becomes the screen's state", async () => {
  // The light is on, white 4300 K, +3 magenta, 25 %.
  const reported = cct(4300, 0.25, 3);
  reported[1] |= 1;
  reported[0] = (reported[0] + 1) & 0xff;
  const { node, driver } = setup(reported);
  const got: Telemetry[] = [];
  const s = await driver.open(node.link(), [mc("MC 3", 3)], (_id, t) => got.push(t));
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(node.telink.slice(0, 2), [hex(statusRequest()), hex(batteryRequest())]);
  assert.deepEqual(got.at(-1)?.state, { power: true, intensity: 0.25, cct: { kelvin: 4300, gm: 3 }, effect: null });
  await s.close();
});

test("commands reach the light as Telink messages, each sent twice; white keeps the last intensity", async () => {
  const { node, driver } = setup();
  const light = mc("MC 3", 3);
  const s = await driver.open(node.link(), [light], () => {});
  await new Promise((r) => setTimeout(r, 10));
  node.telink.length = 0;
  await s.send(light, { op: "power", on: true });
  await s.send(light, { op: "intensity", value: 0.4 });
  await s.send(light, { op: "cct", kelvin: 3200, gm: -2 });
  await s.send(light, { op: "hsi", h: 120, s: 1, i: 0.8 });
  assert.deepEqual(node.telink, [power(true), power(true), intensity(0.4), intensity(0.4), cct(3200, 0.4, -2), cct(3200, 0.4, -2), hsi(120, 1, 0.8), hsi(120, 1, 0.8)].map(hex));
  await s.send(light, { op: "curve", curve: "s" });
  assert.deepEqual(node.telink.slice(-2), [hex(curve("s")), hex(curve("s"))]);
  await s.close();
});

test("the light's battery page becomes telemetry", async () => {
  const page = Uint8Array.of(0, 0, 0, 0x2c, (77 << 1) | 1, 0xe8, 0x1c, 0, 0, 0x0a);
  page[0] = page.slice(1).reduce((a, b) => a + b, 0) & 0xff;
  const { node, driver } = setup(undefined, page);
  const got: Telemetry[] = [];
  const s = await driver.open(node.link(), [mc("MC 3", 3)], (_id, t) => got.push(t));
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(got.find((t) => t.battery !== undefined), { at: got.find((t) => t.battery !== undefined)!.at, battery: 77, volts: 7.4, minutesLeft: 300, plugged: false });
  await s.close();
});

test("effects: run, intensity re-sends the effect, white ends it, off stops it and asks for the state", async () => {
  const { node, driver } = setup();
  const light = mc("MC 3", 3);
  const s = await driver.open(node.link(), [light], () => {});
  await new Promise((r) => setTimeout(r, 10));
  await s.send(light, { op: "intensity", value: 0.6 });
  node.telink.length = 0;
  await s.send(light, { op: "effect", effect: "faulty_bulb" });
  await s.send(light, { op: "intensity", value: 0.3 });
  await s.send(light, { op: "cct", kelvin: 4300, gm: 0 });
  await s.send(light, { op: "intensity", value: 0.2 });
  await s.send(light, { op: "effect", effect: "fire" });
  await s.send(light, { op: "effect", effect: null });
  const once = (b: Uint8Array) => [hex(b), hex(b)];
  assert.deepEqual(node.telink, [
    ...once(effect("faulty_bulb", 0.6)), ...once(effect("faulty_bulb", 0.3)), ...once(cct(4300, 0.3, 0)), ...once(intensity(0.2)),
    ...once(effect("fire", 0.2)), ...once(effectOff()), hex(statusRequest()),
  ]);
  await s.close();
});

test("an effect's options travel with it and survive an intensity change", async () => {
  const { node, driver } = setup();
  const light = mc("MC 3", 3);
  const s = await driver.open(node.link(), [light], () => {});
  await new Promise((r) => setTimeout(r, 10));
  await s.send(light, { op: "intensity", value: 0.5 });
  node.telink.length = 0;
  const o = { frequency: 2, speed: 9, color: { kelvin: 2700 } };
  await s.send(light, { op: "effect", effect: "faulty_bulb", settings: o });
  await s.send(light, { op: "intensity", value: 0.8 });
  assert.deepEqual(node.telink.filter((_, i) => i % 2 === 0), [hex(effect("faulty_bulb", 0.5, o)), hex(effect("faulty_bulb", 0.8, o))]);
  await s.close();
});

test("a Lightning strike goes out once, with the running effect's options", async () => {
  const { node, driver } = setup();
  const light = mc("MC 3", 3);
  const s = await driver.open(node.link(), [light], () => {});
  await new Promise((r) => setTimeout(r, 10));
  await s.send(light, { op: "intensity", value: 1 });
  const o = { kelvin: 6000, frequency: 3, speed: 4 };
  await s.send(light, { op: "effect", effect: "lightning", settings: o });
  node.telink.length = 0;
  await s.send(light, { op: "trigger" });
  assert.deepEqual(node.telink, [hex(effect("lightning", 1, o, true))]);
  await s.close();
});

test("without the network's keys on this phone the connection is refused", async () => {
  const { node } = setup();
  const driver = sidusMesh({ access: () => ({ keysFor: () => null }) });
  await assert.rejects(driver.open(node.link(), [mc("MC 3", 3)], () => {}), /keys are not on this phone/);
});
