import { test } from "node:test";
import assert from "node:assert/strict";
import { CATALOGUE } from "@openclapper/ext-hardware";
import { addKeyframe, addMarker, addTrack, fmtSeconds, patchTrack, removeKeys, setDuration, setKeyframe, snapLevel } from "./edit.ts";
import { START_KEYFRAME } from "./flow.ts";
import { emptyFlow, flowError } from "./index.ts";

const light = CATALOGUE.find((m) => m.type === "light")!.id;
const camera = CATALOGUE.find((m) => m.type === "camera")!.id;

test("a new track has a start keyframe and a free colour, and the body stays valid", () => {
  let b = addTrack(emptyFlow(), light, "t1");
  b = addTrack(b, light, "t2");
  assert.equal(b.tracks[0].keyframes[0].id, START_KEYFRAME);
  assert.notEqual(b.tracks[0].color, b.tracks[1].color);
  assert.match(b.tracks[1].name, / 2$/);
  assert.equal(flowError(b as unknown as Record<string, unknown>), null);
});

test("a keyframe snaps, carries the intensity there, and is not added twice at one time", () => {
  const b = addTrack(emptyFlow(), light, "t");
  const one = addKeyframe(b, "t", 1234, "k1");
  assert.equal(one.keyframe!.at, 1000);
  assert.equal(typeof one.keyframe!.intensity, "number");
  assert.equal(addKeyframe(one.body, "t", 1490, "k2").keyframe, null);
  assert.equal(addKeyframe(b, "t", 200, "k3").keyframe!.at, 1000);
  const cam = addKeyframe(addTrack(emptyFlow(), camera, "c"), "c", 500, "k");
  assert.deepEqual(cam.keyframe!.controls, {});
});

test("a keyframe moved stays off another's time; the start keyframe stays at 0 and is never removed", () => {
  let b = addKeyframe(addTrack(emptyFlow(), light, "t"), "t", 1000, "a").body;
  b = addKeyframe(b, "t", 2000, "b").body;
  const k = b.tracks[0].keyframes.find((x) => x.id === "b")!;
  assert.equal(setKeyframe(b, "t", { ...k, at: 1000 }).tracks[0].keyframes.find((x) => x.id === "b")!.at, 2000);
  assert.equal(setKeyframe(b, "t", { ...k, at: 3490 }).tracks[0].keyframes.find((x) => x.id === "b")!.at, 3000);
  const start = b.tracks[0].keyframes[0];
  assert.equal(setKeyframe(b, "t", { ...start, at: 900 }).tracks[0].keyframes[0].at, 0);
  const gone = removeKeys(b, new Set(["t/a", `t/${START_KEYFRAME}`]));
  assert.deepEqual(gone.tracks[0].keyframes.map((x) => x.id), [START_KEYFRAME, "b"]);
});

test("markers are named in order; a shorter flow brings keyframes and ranges in", () => {
  let b = addTrack(emptyFlow(), light, "t");
  b = addMarker(b, 1000, "m1").body;
  b = addMarker(b, 5000, "m2", { end: 20_000 }).body;
  assert.deepEqual(b.markers!.map((m) => m.name), ["Marker 1", "Section 2"]);
  b = addKeyframe(b, "t", 15_000, "k").body;
  const short = setDuration(b, 10_000);
  assert.equal(short.tracks[0].keyframes.length, 1);
  assert.equal(short.markers![1].end, 10_000);
  assert.equal(flowError(short as unknown as Record<string, unknown>), null);
});

test("times are whole seconds; a keyframe from before keeps its time until it is moved", () => {
  let b = addTrack(emptyFlow(), light, "t");
  b = patchTrack(b, "t", (t) => ({ ...t, keyframes: [...t.keyframes, { id: "old", at: 2300, intensity: 0.2 }] }));
  const k = b.tracks[0].keyframes.find((x) => x.id === "old")!;
  assert.equal(setKeyframe(b, "t", { ...k, intensity: 0.9 }).tracks[0].keyframes.find((x) => x.id === "old")!.at, 2300);
  assert.equal(setKeyframe(b, "t", { ...k, at: 2400 }).tracks[0].keyframes.find((x) => x.id === "old")!.at, 2000);
  assert.equal(fmtSeconds(12_000), "12 s");
  assert.equal(fmtSeconds(2300), "2.3 s");
});

test("an intensity drag snaps to the grid, from off the grid to the next line in its direction", () => {
  const pct = (v: number) => Math.round(v * 100);
  // From 3 % upwards: the first stop is the next line of each grid.
  assert.equal(pct(snapLevel(0.03, 0.04, 1)), 4);
  assert.equal(pct(snapLevel(0.03, 0.035, 5)), 5);
  assert.equal(pct(snapLevel(0.03, 0.031, 10)), 10);
  // Downwards from 3 % with 5: 0, never 5.
  assert.equal(pct(snapLevel(0.03, 0.029, 5)), 0);
  // On the grid: the nearest line, so a small wobble stays put.
  assert.equal(pct(snapLevel(0.5, 0.51, 5)), 50);
  assert.equal(pct(snapLevel(0.5, 0.53, 5)), 55);
  assert.equal(pct(snapLevel(0.5, 0.47, 10)), 50);
  assert.equal(pct(snapLevel(0.42, 0.437, 1)), 44);
  // Within 0..100 %.
  assert.equal(snapLevel(0.98, 1.4, 5), 1);
  assert.equal(snapLevel(0.02, -0.3, 10), 0);
});
