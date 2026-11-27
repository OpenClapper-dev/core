import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { LightCommand } from "@openclapper/ext-hardware";
import { NATIVE_FADES, START_KEYFRAME, type Flow } from "./flow.ts";
import { FlowPlayer } from "./player.ts";

function clock() {
  let now = 0;
  let fn: (() => void) | null = null;
  return {
    now: () => now,
    setInterval: (f: () => void) => { fn = f; return 1; },
    clearInterval: () => { fn = null; },
    /** Moves time on in 100 ms ticks. */
    advance(ms: number) { for (let i = 0; i < ms / 100; i++) { now += 100; fn?.(); } },
    get running() { return fn != null; },
  };
}

const seq = (loop: boolean, model = "neewer-fs230b"): Flow => ({
  id: "s", name: "S", durationMs: 1000, loop, updatedAt: "",
  tracks: [{ id: "t", name: "T", model, device: "f", keyframes: [
    { id: START_KEYFRAME, at: 0, power: true, intensity: 0.2, kelvin: 4000, gm: 0 },
    { id: "k", at: 500, intensity: 1, fadeIn: "linear" },
  ] }],
});

test("plays from a position on its own clock, and stops after sending the last state", () => {
  const c = clock();
  const sent: LightCommand[] = [];
  const ticks: number[] = [];
  let ended: number | null = null;
  const s = seq(false);
  const p = new FlowPlayer(() => s, (_id, cmd) => sent.push(cmd), c, { tick: (t) => ticks.push(t), end: (t) => { ended = t; } });
  p.play(0);
  assert.ok(sent.some((x) => x.op === "power") && sent.some((x) => x.op === "cct"));
  c.advance(1000);
  assert.equal(ended, 1000);
  assert.equal(p.playing, false);
  assert.equal(c.running, false);
  assert.deepEqual(ticks.slice(0, 3), [0, 100, 200]);
  const last = sent.filter((x): x is Extract<LightCommand, { op: "intensity" }> => x.op === "intensity").at(-1);
  assert.equal(last?.value, 1);
});

test("a loop starts over and sends every value again", () => {
  const c = clock();
  const sent: LightCommand[] = [];
  const s = seq(true);
  const p = new FlowPlayer(() => s, (_id, cmd) => sent.push(cmd), c);
  p.play(0);
  const powersBefore = sent.filter((x) => x.op === "power").length;
  c.advance(1100);
  assert.equal(p.playing, true);
  assert.equal(sent.filter((x) => x.op === "power").length, powersBefore + 1);
  p.stop();
  assert.equal(c.running, false);
});

test("native fades are off: a light that could fade by itself gets the fade in steps (#426)", () => {
  assert.equal(NATIVE_FADES, false);
  const c = clock();
  const sent: LightCommand[] = [];
  const s = { ...seq(false, "aputure-mc") };
  // fadeStepped stored false (absent) would have meant "the light runs it": ignored now.
  s.tracks = [{ ...s.tracks[0], keyframes: [{ id: START_KEYFRAME, at: 0, power: true, intensity: 0.2, kelvin: 4000, gm: 0 }, { id: "k", at: 1000, intensity: 1, fadeIn: "linear" }] }];
  const p = new FlowPlayer(() => s, (_id, cmd) => sent.push(cmd), c);
  p.play(0);
  c.advance(900);
  // The start state, then one intensity per tick and no native fade.
  assert.equal(sent.filter((x) => x.op === "fade").length, 0);
  assert.equal(sent.filter((x) => x.op === "intensity").length, 10);
});

test("a locked parameter sends the start keyframe's value only (#426)", () => {
  const c = clock();
  const sent: LightCommand[] = [];
  const s = seq(false);
  s.tracks = [{ ...s.tracks[0], locked: ["intensity"], keyframes: [{ id: START_KEYFRAME, at: 0, power: true, intensity: 0.2, kelvin: 4000, gm: 0 }, { id: "k", at: 500, intensity: 1, kelvin: 5600 }] }];
  const p = new FlowPlayer(() => s, (_id, cmd) => sent.push(cmd), c);
  p.play(0);
  c.advance(1000);
  // White follows the keyframe; intensity stays at the start's 20 %.
  assert.deepEqual(sent.filter((x) => x.op === "intensity").map((x) => (x as { value: number }).value), [0.2]);
  assert.ok(sent.some((x) => x.op === "cct" && x.kelvin === 5600));
});
