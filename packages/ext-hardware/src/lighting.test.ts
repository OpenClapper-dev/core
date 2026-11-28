import { test } from "node:test";
import assert from "node:assert/strict";
import { FIXTURE_KINDS, fixtureKind, hsiCss, isBleAddress } from "./lighting.ts";

test("kind ids are unique and stable", () => {
  const ids = FIXTURE_KINDS.map((k) => k.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids, ["neewer-fs230b", "neewer-fs300b", "neewer-ps099s", "aputure-mc", "bmd-pocket-6k"]);
});

test("capabilities are consistent", () => {
  for (const k of FIXTURE_KINDS) {
    if (k.caps.cct) assert.ok(k.caps.cct.min < k.caps.cct.max, k.id);
    if (k.caps.cct?.gm) assert.ok(k.caps.cct.gm.min < 0 && k.caps.cct.gm.max > 0, k.id);
    // A fixture with nothing to set reports something (a camera is controlled by its own messages).
    if (!k.caps.power && !k.caps.intensity && !k.caps.camera) assert.ok(k.caps.telemetry.length > 0, k.id);
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

test("the MC offers nine of the fifteen effects, all of them known ids", async () => {
  const { EFFECTS } = await import("./lighting.ts");
  const mc = fixtureKind("aputure-mc")!;
  assert.equal(mc.caps.effects?.length, 9);
  assert.ok(mc.caps.effects!.every((id) => EFFECTS.some((e) => e.id === id)));
  assert.ok(!mc.caps.effects!.includes("strobe"));
});

test("a light's colour is its hue mixed with white by the saturation", () => {
  assert.equal(hsiCss(0, 1), "rgb(255, 0, 0)");
  assert.equal(hsiCss(120, 1), "rgb(0, 255, 0)");
  assert.equal(hsiCss(240, 0.5), "rgb(128, 128, 255)");
  assert.equal(hsiCss(77, 0), "rgb(255, 255, 255)");
  assert.equal(hsiCss(360, 1), hsiCss(0, 1));
});

test("each effect with options says how it takes its light, and holds a locked one where it can", async () => {
  const { effectLightKind, effectHolds, holdEffect, effectLight } = await import("./effects.ts");
  const { EFFECT_OPTIONS } = await import("./lighting.ts");
  for (const id of Object.keys(EFFECT_OPTIONS) as (keyof typeof EFFECT_OPTIONS)[]) assert.ok(["white", "either", "whiteChoice", "own"].includes(effectLightKind(id)), id);
  assert.equal(effectLightKind("paparazzi"), "white");
  assert.equal(effectLightKind("faulty_bulb"), "either");
  assert.equal(effectLightKind("cop_car"), "own");
  assert.equal(effectLightKind("nw_candle"), "white");
  assert.equal(effectLightKind("nw_cct_loop"), "own");
  // A locked white: paparazzi takes its temperature, faulty bulb turns white at it, cop car cannot.
  assert.equal(holdEffect("paparazzi", { kelvin: 3000, frequency: 2 }, { kelvin: 4600 })!.kelvin, 4600);
  assert.deepEqual(holdEffect("faulty_bulb", { color: { h: 10, s: 1 } }, { kelvin: 4600 })!.color, { kelvin: 4600 });
  assert.equal(effectHolds("cop_car", { kelvin: 4600 }), false);
  assert.equal(holdEffect("fireworks", { choice: 2 }, { kelvin: 4600 })!.choice, 0);
  // A locked colour: only an effect with a colour option.
  assert.deepEqual(holdEffect("pulsing", { color: { kelvin: 3000 } }, { h: 200, s: 0.5 })!.color, { h: 200, s: 0.5 });
  assert.equal(effectHolds("paparazzi", { h: 200, s: 0.5 }), false);
  // What is drawn while it runs.
  assert.deepEqual(effectLight("faulty_bulb", { color: { kelvin: 4600 } }), { kelvin: 4600 });
  assert.deepEqual(effectLight("cop_car", { choice: 1 }), { h: 228, s: 1 });
  assert.equal(effectLight("party_lights"), null);
});
