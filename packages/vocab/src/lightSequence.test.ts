import { strict as assert } from "node:assert";
import { test } from "node:test";
import { commandsFor, ease, nativeFades, nativeStep, sampleTrack, START_KEYFRAME, startKeyframe, type Keyframe } from "./lightSequence.ts";

const kf = (at: number, x: Omit<Keyframe, "id" | "at">, id = `k${at}`): Keyframe => ({ id, at, ...x });
const start = (x: Omit<Keyframe, "id" | "at">) => kf(0, x, START_KEYFRAME);

test("easing curves start at 0, end at 1, and differ in between", () => {
  for (const c of ["linear", "exp", "log", "s"] as const) {
    assert.equal(ease(c, 0), 0);
    assert.ok(Math.abs(ease(c, 1) - 1) < 1e-9);
  }
  assert.ok(ease("exp", 0.5) < ease("linear", 0.5) && ease("log", 0.5) > ease("linear", 0.5));
  assert.equal(ease("s", 0.5), 0.5);
});

test("a start keyframe holds a complete state for the kind", () => {
  assert.deepEqual(startKeyframe({ caps: { cct: { min: 3200, max: 6500 }, hsi: true } }), { id: START_KEYFRAME, at: 0, power: true, intensity: 0.5, kelvin: 4900, gm: 0 });
});

test("values jump at keyframes unless a fade connects them", () => {
  const k = [start({ power: true, intensity: 0.2, kelvin: 3200 }), kf(1000, { intensity: 1 }), kf(2000, { intensity: 0, kelvin: 5600, fadeIn: "linear" })];
  assert.equal(sampleTrack(k, 999).intensity, 0.2); // held, no fade into 1 s
  assert.equal(sampleTrack(k, 1000).intensity, 1); // jumped
  const mid = sampleTrack(k, 1500);
  assert.equal(mid.intensity, 0.5);
  assert.equal(mid.kelvin, 4400);
  assert.equal(sampleTrack(k, 2500).kelvin, 5600);
  assert.equal(sampleTrack(k, 0).power, true);
});

test("a fade blends hue the short way; white ↔ colour switches at the fade's end", () => {
  const k = [start({ hue: 350, sat: 1, intensity: 1 }), kf(1000, { hue: 10, fadeIn: "linear" }), kf(2000, { kelvin: 5600, fadeIn: "linear" })];
  assert.equal(Math.round(sampleTrack(k, 500).hue!), 0);
  assert.equal(sampleTrack(k, 1500).mode, "colour");
  assert.equal(sampleTrack(k, 2000).mode, "white");
});

test("commands: only what changed; colour as one hsi; effects keep white/colour quiet", () => {
  const a = commandsFor(null, { power: true, mode: "white", kelvin: 5600.4, gm: 0, intensity: 0.5 });
  assert.deepEqual(a.commands, [{ op: "power", on: true }, { op: "cct", kelvin: 5600, gm: 0 }, { op: "intensity", value: 0.5 }]);
  assert.deepEqual(commandsFor(a.sent, { power: true, mode: "white", kelvin: 5601, gm: 0, intensity: 0.5 }).commands, []);
  const c = commandsFor(a.sent, { power: true, mode: "colour", hue: 120, sat: 0.8, intensity: 0.4 });
  assert.deepEqual(c.commands, [{ op: "hsi", h: 120, s: 0.8, i: 0.4 }]);
  const fx = commandsFor(c.sent, { power: true, mode: "colour", hue: 200, sat: 0.8, intensity: 0.6, effect: { id: "fire" } });
  assert.deepEqual(fx.commands, [{ op: "effect", effect: "fire" }, { op: "intensity", value: 0.6 }]);
  const off = commandsFor(fx.sent, { power: true, mode: "colour", hue: 200, sat: 0.8, intensity: 0.6, effect: { id: null } });
  assert.deepEqual(off.commands, [{ op: "effect", effect: null }, { op: "hsi", h: 200, s: 0.8, i: 0.6 }]);
});

test("native fades (#289): one fade per tile to the far keyframe's values, nothing in between, jumps elsewhere", () => {
  const k = [
    start({ power: true, intensity: 0.2, kelvin: 3200, gm: 0 }),
    kf(4000, { intensity: 1, kelvin: 5600, fadeIn: "s" }),
    kf(6000, { intensity: 0.3 }),
  ];
  assert.deepEqual(nativeFades(k).map((f) => [f.from, f.to, f.curve]), [[0, 4000, "s"]]);
  const a = nativeStep(k, 0, null, null);
  assert.deepEqual(a.commands, [
    { op: "power", on: true }, { op: "cct", kelvin: 3200, gm: 0 }, { op: "intensity", value: 0.2 },
    { op: "fade", ms: 4000, curve: "s", intensity: 1, white: { kelvin: 5600, gm: 0 } },
  ]);
  assert.deepEqual(nativeStep(k, 2000, a.sent, a.key).commands, []);
  // At 4 s the light is where the fade took it: nothing to send. At 6 s it jumps.
  const b = nativeStep(k, 4000, a.sent, a.key);
  assert.deepEqual(b.commands, []);
  assert.deepEqual(nativeStep(k, 6000, b.sent, b.key).commands, [{ op: "intensity", value: 0.3 }]);
});

test("native fades: long tiles chain 25.5 s chunks; starting mid-fade jumps first", () => {
  const k = [start({ intensity: 0, kelvin: 5600 }), kf(60_000, { intensity: 1, fadeIn: "linear" })];
  const a = nativeStep(k, 0, null, null);
  assert.deepEqual(a.commands.at(-1), { op: "fade", ms: 25_500, curve: "linear", intensity: 0.425, white: { kelvin: 5600, gm: 0 } });
  assert.deepEqual(nativeStep(k, 25_500, a.sent, a.key).commands, [{ op: "fade", ms: 25_500, curve: "linear", intensity: 0.85, white: { kelvin: 5600, gm: 0 } }]);
  const mid = nativeStep(k, 30_000, null, null);
  assert.deepEqual(mid.commands, [{ op: "cct", kelvin: 5600, gm: 0 }, { op: "intensity", value: 0.5 }, { op: "fade", ms: 21_000, curve: "linear", intensity: 0.85, white: { kelvin: 5600, gm: 0 } }]);
});

test("a fade set to stepped is sent in steps even on a light that fades by itself", () => {
  const k = [start({ power: true, intensity: 0, kelvin: 5600 }), kf(1000, { intensity: 1, fadeIn: "linear", fadeStepped: true })];
  assert.deepEqual(nativeFades(k), []);
  const a = nativeStep(k, 0, null, null);
  assert.ok(!a.commands.some((c) => c.op === "fade"));
  assert.deepEqual(nativeStep(k, 500, a.sent, a.key).commands, [{ op: "intensity", value: 0.5 }]);
});
