import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { parseLightCommand } from "./lightProxy.ts";

describe("parseLightCommand", () => {
  test("accepts every op in range", () => {
    assert.deepEqual(parseLightCommand({ op: "power", on: true }), { op: "power", on: true });
    assert.deepEqual(parseLightCommand({ op: "intensity", value: 0.4 }), { op: "intensity", value: 0.4 });
    assert.deepEqual(parseLightCommand({ op: "cct", kelvin: 5600, gm: -10 }), { op: "cct", kelvin: 5600, gm: -10 });
    assert.deepEqual(parseLightCommand({ op: "hsi", h: 360, s: 1, i: 0 }), { op: "hsi", h: 360, s: 1, i: 0 });
    assert.deepEqual(parseLightCommand({ op: "curve", curve: "s" }), { op: "curve", curve: "s" });
    assert.deepEqual(parseLightCommand({ op: "effect", effect: null }), { op: "effect", effect: null });
    assert.deepEqual(parseLightCommand({ op: "effect", effect: "fire", settings: { choice: 1, frequency: 11 } }), { op: "effect", effect: "fire", settings: { choice: 1, frequency: 11 } });
    assert.deepEqual((parseLightCommand({ op: "effect", effect: "pulsing", settings: { color: { h: 10, s: 0.5 } } }) as { settings?: unknown } | null)?.settings, { color: { h: 10, s: 0.5 } });
    assert.deepEqual(parseLightCommand({ op: "trigger" }), { op: "trigger" });
  });

  test("drops anything malformed or out of range, and unknown fields", () => {
    for (const bad of [null, "x", {}, { op: "power" }, { op: "intensity", value: 1.5 }, { op: "intensity", value: Number.NaN }, { op: "cct", kelvin: 5600, gm: 99 },
      { op: "hsi", h: -1, s: 0, i: 0 }, { op: "curve", curve: "bezier" }, { op: "effect", effect: "disco" }, { op: "effect", effect: "fire", settings: { frequency: 12 } }, { op: "reboot" }]) {
      assert.equal(parseLightCommand(bad), null);
    }
    assert.deepEqual(parseLightCommand({ op: "power", on: false, extra: 1 }), { op: "power", on: false });
  });
});
