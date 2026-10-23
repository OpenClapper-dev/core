import { test } from "node:test";
import assert from "node:assert/strict";
import { driverFor, suggestKinds } from "./registry.ts";

test("suggestions from the advertisement", () => {
  assert.deepEqual(suggestKinds({ name: null, serviceUUIDs: ["00001827-0000-1000-8000-00805F9B34FB"] }), ["aputure-mc"]);
  assert.deepEqual(suggestKinds({ name: "NW-20230051", serviceUUIDs: null }), ["neewer-fs230b", "neewer-fs300b", "neewer-ps099s"]);
  assert.deepEqual(suggestKinds({ name: "NEEWER FS300B", serviceUUIDs: null })[0], "neewer-fs300b");
  assert.deepEqual(suggestKinds({ name: "NEEWER-PS099S", serviceUUIDs: null })[0], "neewer-ps099s");
  assert.deepEqual(suggestKinds({ name: "Pixel Buds", serviceUUIDs: null }), []);
});

test("no driver yet for any kind (the protocols land in #209, #210, #213)", () => {
  assert.equal(driverFor("neewer-fs230b"), undefined);
  assert.equal(driverFor("nope"), undefined);
});
