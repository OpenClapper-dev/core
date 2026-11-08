import { strict as assert } from "node:assert";
import { test } from "node:test";
import { commandsFor, ease, nativeFades, nativeStep, sampleTrack, type Keyframe } from "./lightSequence.ts";

const kf = (at: number, x: Omit<Keyframe, "id" | "at" | "ease"> & { ease?: Keyframe["ease"] }): Keyframe => ({ id: `k${at}`, at, ease: "linear", ...x });

test("easing curves start at 0, end at 1, and differ in between", () => {
  for (const c of ["linear", "exp", "log", "s"] as const) {
    assert.equal(ease(c, 0), 0);
    assert.ok(Math.abs(ease(c, 1) - 1) < 1e-9);
  }
  assert.ok(ease("exp", 0.5) < ease("linear", 0.5) && ease("log", 0.5) > ease("linear", 0.5));
  assert.equal(ease("s", 0.5), 0.5);
});

test("numbers ease between the keyframes that set them; switches step", () => {
  const k = [kf(0, { power: true, intensity: 0, kelvin: 3200 }), kf(1000, { intensity: 1 }), kf(2000, { kelvin: 5600, ease: "s" }), kf(3000, { power: false })];
  assert.deepEqual(sampleTrack(k, -1), {});
  const half = sampleTrack(k, 500);
  assert.equal(half.intensity, 0.5);
  assert.equal(half.kelvin, 3200 + (5600 - 3200) * 0.25 * 0.25 * (3 - 0.5)); // s-curve at 0.25 over 0..2000
  assert.equal(half.mode, "white");
  assert.equal(half.power, true);
  assert.equal(sampleTrack(k, 2500).intensity, 1); // held after its last keyframe
  assert.equal(sampleTrack(k, 3000).power, false);
});

test("hue takes the short way round", () => {
  const k = [kf(0, { hue: 350, sat: 1 }), kf(1000, { hue: 10 })];
  assert.equal(Math.round(sampleTrack(k, 500).hue!), 0);
  assert.equal(sampleTrack(k, 500).mode, "colour");
});

test("commands: only what changed; colour as one hsi; effects keep white/colour quiet", () => {
  const a = commandsFor(null, { power: true, mode: "white", kelvin: 5600.4, gm: 0, intensity: 0.5 });
  assert.deepEqual(a.commands, [{ op: "power", on: true }, { op: "cct", kelvin: 5600, gm: 0 }, { op: "intensity", value: 0.5 }]);
  assert.deepEqual(commandsFor(a.sent, { power: true, mode: "white", kelvin: 5601, gm: 0, intensity: 0.5 }).commands, []);
  const c = commandsFor(a.sent, { power: true, mode: "colour", hue: 120, sat: 0.8, intensity: 0.4 });
  assert.deepEqual(c.commands, [{ op: "hsi", h: 120, s: 0.8, i: 0.4 }]);
  const fx = commandsFor(c.sent, { power: true, mode: "colour", hue: 200, sat: 0.8, intensity: 0.6, effect: { id: "fire" } });
  assert.deepEqual(fx.commands, [{ op: "effect", effect: "fire" }, { op: "intensity", value: 0.6 }]);
  // Stopping the effect brings the colour back.
  const off = commandsFor(fx.sent, { power: true, mode: "colour", hue: 200, sat: 0.8, intensity: 0.6, effect: { id: null } });
  assert.deepEqual(off.commands, [{ op: "effect", effect: null }, { op: "hsi", h: 200, s: 0.8, i: 0.6 }]);
});

test("native fades (#289): one fade per stretch, nothing in between, any keyframe splits", () => {
  const k = [
    kf(0, { power: true, intensity: 0.2, kelvin: 3200 }),
    kf(4000, { intensity: 1, ease: "s" }),
    kf(6000, { kelvin: 5600 }),
    kf(8000, { intensity: 0.5 }),
  ];
  assert.deepEqual(nativeFades(k).map((f) => [f.from, f.to, f.target]), [[0, 4000, 1], [4000, 6000, 0.75], [6000, 8000, 0.5]]);
  const a = nativeStep(k, 0, null, null);
  assert.deepEqual(a.commands, [
    { op: "power", on: true }, { op: "cct", kelvin: 3200, gm: 0 }, { op: "intensity", value: 0.2 },
    { op: "fade", ms: 4000, curve: "s", intensity: 1, white: { kelvin: 3200, gm: 0 } },
  ]);
  // The light fades by itself: nothing until the stretch ends.
  assert.deepEqual(nativeStep(k, 2000, a.sent, a.key).commands, []);
  const b = nativeStep(k, 4000, a.sent, a.key);
  assert.deepEqual(b.commands, [{ op: "fade", ms: 2000, curve: "linear", intensity: 0.75, white: { kelvin: 3200, gm: 0 } }]);
  // The white keyframe at 6 s ends that fade; the next one carries the new white.
  const c = nativeStep(k, 6000, b.sent, b.key);
  assert.deepEqual(c.commands, [{ op: "cct", kelvin: 5600, gm: 0 }, { op: "fade", ms: 2000, curve: "linear", intensity: 0.5, white: { kelvin: 5600, gm: 0 } }]);
});

test("native fades: long stretches chain 25.5 s chunks; starting mid-fade jumps first", () => {
  const k = [kf(0, { intensity: 0 }), kf(60_000, { intensity: 1 })];
  const a = nativeStep(k, 0, null, null);
  assert.deepEqual(a.commands.at(-1), { op: "fade", ms: 25_500, curve: "linear", intensity: 0.425 });
  assert.deepEqual(nativeStep(k, 25_500, a.sent, a.key).commands, [{ op: "fade", ms: 25_500, curve: "linear", intensity: 0.85 }]);
  const mid = nativeStep(k, 30_000, null, null);
  assert.deepEqual(mid.commands, [{ op: "intensity", value: 0.5 }, { op: "fade", ms: 21_000, curve: "linear", intensity: 0.85 }]);
});
