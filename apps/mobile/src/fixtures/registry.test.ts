import { test } from "node:test";
import assert from "node:assert/strict";
import { driverFor, suggestKinds } from "./registry.ts";

test("suggestions from the advertisement", () => {
  assert.deepEqual(suggestKinds({ name: null, serviceUUIDs: ["00001827-0000-1000-8000-00805F9B34FB"] }), ["aputure-mc"]);
  // The FS230B advertises its model code; an unknown code falls back to every NEEWER kind.
  assert.deepEqual(suggestKinds({ name: "NW-20230051&FFFFFFFF", serviceUUIDs: null }), ["neewer-fs230b", "neewer-fs300b", "neewer-ps099s"]);
  assert.deepEqual(suggestKinds({ name: "NW-20239999&FFFFFFFF", serviceUUIDs: null }), ["neewer-fs230b", "neewer-fs300b", "neewer-ps099s"]);
  assert.deepEqual(suggestKinds({ name: "NEEWER FS300B", serviceUUIDs: null })[0], "neewer-fs300b");
  assert.deepEqual(suggestKinds({ name: "NEEWER-PS099S", serviceUUIDs: null })[0], "neewer-ps099s");
  assert.deepEqual(suggestKinds({ name: "Pixel Buds", serviceUUIDs: null }), []);
});

test("drivers: NEEWER lights have one; the battery and Aputure not yet (#210, #213)", () => {
  assert.equal(driverFor("neewer-fs230b")?.id, "neewer-infinity");
  assert.equal(driverFor("neewer-fs300b")?.id, "neewer-infinity");
  assert.equal(driverFor("neewer-ps099s"), undefined);
  assert.equal(driverFor("aputure-mc"), undefined);
  assert.equal(driverFor("nope"), undefined);
});
