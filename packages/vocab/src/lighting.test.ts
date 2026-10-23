import { test } from "node:test";
import assert from "node:assert/strict";
import { FIXTURE_KINDS, fixtureKind, isBleAddress } from "./lighting.ts";

test("kind ids are unique and stable", () => {
  const ids = FIXTURE_KINDS.map((k) => k.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids, ["neewer-fs230b", "neewer-fs300b", "neewer-ps099s", "aputure-mc"]);
});

test("capabilities are consistent", () => {
  for (const k of FIXTURE_KINDS) {
    if (k.caps.cct) assert.ok(k.caps.cct.min < k.caps.cct.max, k.id);
    if (k.caps.cct?.gm) assert.ok(k.caps.cct.gm.min < 0 && k.caps.cct.gm.max > 0, k.id);
    // A fixture with nothing to set reports something.
    if (!k.caps.power && !k.caps.intensity) assert.ok(k.caps.telemetry.length > 0, k.id);
  }
  assert.equal(fixtureKind("aputure-mc")?.transport, "mesh");
  assert.equal(fixtureKind("nope"), undefined);
});

test("BLE addresses as Android reports them", () => {
  assert.ok(isBleAddress("A4:C1:38:0B:2F:9E"));
  assert.ok(!isBleAddress("a4:c1:38:0b:2f:9e"));
  assert.ok(!isBleAddress("A4C1380B2F9E"));
  assert.ok(!isBleAddress(null));
});
