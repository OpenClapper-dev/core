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
    assert.deepEqual(parseLightCommand({ op: "fade", ms: 5000, curve: "s", intensity: 1, white: { kelvin: 5600, gm: 0 } }), { op: "fade", ms: 5000, curve: "s", intensity: 1, white: { kelvin: 5600, gm: 0 } });
    assert.equal(parseLightCommand({ op: "fade", ms: 30_000, curve: "s", intensity: 1 }), null);
    assert.equal(parseLightCommand({ op: "fade", ms: 1000, curve: "s", intensity: 1, colour: { h: 400, s: 1 } }), null);
  });

  test("camera control messages (#318): known types, values in range", () => {
    const m = { category: 4, parameter: 1, type: 2, operation: 0, data: [4, 2] };
    assert.deepEqual(parseLightCommand({ op: "ccu", message: m }), { op: "ccu", message: m });
    assert.deepEqual(parseLightCommand({ op: "ccu", message: { category: 12, parameter: 2, type: 5, operation: 0, data: "12A" } }), { op: "ccu", message: { category: 12, parameter: 2, type: 5, operation: 0, data: "12A" } });
    for (const bad of [{ ...m, type: 7 }, { ...m, operation: 2 }, { ...m, data: [70000] }, { ...m, category: 300 }, { ...m, data: "x" }]) assert.equal(parseLightCommand({ op: "ccu", message: bad }), null);
  });

  test("drops anything malformed or out of range, and unknown fields", () => {
    for (const bad of [null, "x", {}, { op: "power" }, { op: "intensity", value: 1.5 }, { op: "intensity", value: Number.NaN }, { op: "cct", kelvin: 5600, gm: 99 },
      { op: "hsi", h: -1, s: 0, i: 0 }, { op: "curve", curve: "bezier" }, { op: "effect", effect: "disco" }, { op: "effect", effect: "fire", settings: { frequency: 12 } }, { op: "reboot" }]) {
      assert.equal(parseLightCommand(bad), null);
    }
    assert.deepEqual(parseLightCommand({ op: "power", on: false, extra: 1 }), { op: "power", on: false });
  });
});
