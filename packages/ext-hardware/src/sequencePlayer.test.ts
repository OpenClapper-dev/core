import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { LightCommand } from "./lightProxy.ts";
import { START_KEYFRAME, type LightSequence } from "./lightSequence.ts";
import { SequencePlayer } from "./sequencePlayer.ts";

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

const seq = (loop: boolean, kindId = "neewer-fs230b"): LightSequence => ({
  id: "s", name: "S", durationMs: 1000, loop, updatedAt: "",
  tracks: [{ id: "t", name: "T", kindId, fixtureId: "f", keyframes: [
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
  const p = new SequencePlayer(() => s, (_id, cmd) => sent.push(cmd), c, { tick: (t) => ticks.push(t), end: (t) => { ended = t; } });
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
  const p = new SequencePlayer(() => s, (_id, cmd) => sent.push(cmd), c);
  p.play(0);
  const powersBefore = sent.filter((x) => x.op === "power").length;
  c.advance(1100);
  assert.equal(p.playing, true);
  assert.equal(sent.filter((x) => x.op === "power").length, powersBefore + 1);
  p.stop();
  assert.equal(c.running, false);
});

test("a light that fades by itself gets one native fade for the tile", () => {
  const c = clock();
  const sent: LightCommand[] = [];
  const s = { ...seq(false, "aputure-mc") };
  s.tracks = [{ ...s.tracks[0], keyframes: [{ id: START_KEYFRAME, at: 0, power: true, intensity: 0.2, kelvin: 4000, gm: 0 }, { id: "k", at: 1000, intensity: 1, fadeIn: "linear" }] }];
  const p = new SequencePlayer(() => s, (_id, cmd) => sent.push(cmd), c);
  p.play(0);
  c.advance(900);
  // The start state once, then one fade and nothing in between.
  assert.equal(sent.filter((x) => x.op === "fade").length, 1);
  assert.equal(sent.filter((x) => x.op === "intensity").length, 1);
});
