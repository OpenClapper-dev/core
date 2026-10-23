import { test } from "node:test";
import assert from "node:assert/strict";
import { toHex } from "../bytes.ts";
import { powerFrame, whiteFrame } from "../codecs/neewer.ts";
import type { Fixture, Link } from "../types.ts";
import { AFTER_POWER_ON_MS, neewerInfinity } from "./neewerInfinity.ts";

const MAC = "A1:B2:C3:D4:E5:F6";
const light: Fixture = { id: "f1", label: "Key", kindId: "neewer-fs230b", address: MAC, mesh: null, createdAt: "", synced: true };

function setup() {
  const writes: { bytes: string; withResponse: boolean; at: number }[] = [];
  const clock = { t: 0, waits: [] as number[] };
  let notifyOn = false;
  const link: Link = {
    address: MAC, mtu: 247,
    write: async (_s, _c, bytes, withResponse) => { writes.push({ bytes: toHex(bytes), withResponse, at: clock.t }); },
    notify: async () => { notifyOn = true; return () => { notifyOn = false; }; },
    onDisconnect: () => () => {},
    close: async () => {},
  };
  const driver = neewerInfinity({ now: () => clock.t, wait: async (ms) => { clock.waits.push(ms); clock.t += ms; } });
  return { writes, clock, link, driver, notifying: () => notifyOn };
}

test("opening turns notifications on and replays the app's hello, without response", async () => {
  const { writes, link, driver, notifying } = setup();
  const s = await driver.open(link, [light], () => {});
  assert.equal(notifying(), true);
  assert.equal(writes.length, 6);
  assert.ok(writes.every((w) => !w.withResponse));
  await s.close();
  assert.equal(notifying(), false);
});

test("intensity, white and curve always go out together with the last known others", async () => {
  const { writes, link, driver } = setup();
  const s = await driver.open(link, [light], () => {});
  writes.length = 0;
  await s.send(light, { op: "intensity", value: 0.3 });
  // Until set, white is the middle of the kind's range (2700–6500 → 4600 K) and the curve linear.
  assert.equal(writes[0].bytes, toHex(whiteFrame(MAC, { intensity: 0.3, kelvin: 4600, curve: "linear" })));
  await s.send(light, { op: "cct", kelvin: 3200, gm: 0 });
  await s.send(light, { op: "curve", curve: "s" });
  assert.equal(writes[2].bytes, toHex(whiteFrame(MAC, { intensity: 0.3, kelvin: 3200, curve: "s" })));
});

test("a white frame right after power-on waits for the light", async () => {
  const { writes, clock, link, driver } = setup();
  const s = await driver.open(link, [light], () => {});
  writes.length = 0;
  await s.send(light, { op: "power", on: true });
  clock.t += 40;
  await s.send(light, { op: "intensity", value: 1 });
  assert.equal(writes[0].bytes, toHex(powerFrame(MAC, true)));
  assert.deepEqual(clock.waits, [AFTER_POWER_ON_MS - 40]);
  // Long after: no wait.
  clock.t += 1000;
  await s.send(light, { op: "intensity", value: 0.5 });
  assert.equal(clock.waits.length, 1);
});

test("green/magenta goes out with the white (FS300B)", async () => {
  const { writes, link, driver } = setup();
  const fs300: Fixture = { ...light, id: "f2", kindId: "neewer-fs300b" };
  const s = await driver.open(link, [fs300], () => {});
  writes.length = 0;
  await s.send(fs300, { op: "cct", kelvin: 5600, gm: -20 });
  await s.send(fs300, { op: "intensity", value: 0.8 });
  assert.equal(writes[1].bytes, toHex(whiteFrame(MAC, { intensity: 0.8, kelvin: 5600, curve: "linear", gm: -20 })));
  assert.equal(whiteFrame(MAC, { intensity: 0.8, kelvin: 5600, curve: "linear", gm: -20 })[12], 30);
});

test("colour is refused: the bi-colour lights have none", async () => {
  const { link, driver } = setup();
  const s = await driver.open(link, [light], () => {});
  await assert.rejects(s.send(light, { op: "hsi", h: 0, s: 1, i: 1 }), /has no hsi/);
});
