import { test } from "node:test";
import assert from "node:assert/strict";
import { CATALOGUE } from "@openclapper/ext-hardware";
import { addKeyframe, addMarker, addTrack, removeKeys, setDuration, setKeyframe } from "./edit.ts";
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
  assert.equal(one.keyframe!.at, 1200);
  assert.equal(typeof one.keyframe!.intensity, "number");
  assert.equal(addKeyframe(one.body, "t", 1190, "k2").keyframe, null);
  const cam = addKeyframe(addTrack(emptyFlow(), camera, "c"), "c", 500, "k");
  assert.deepEqual(cam.keyframe!.controls, {});
});

test("a keyframe moved stays off another's time; the start keyframe stays at 0 and is never removed", () => {
  let b = addKeyframe(addTrack(emptyFlow(), light, "t"), "t", 1000, "a").body;
  b = addKeyframe(b, "t", 2000, "b").body;
  const k = b.tracks[0].keyframes.find((x) => x.id === "b")!;
  assert.equal(setKeyframe(b, "t", { ...k, at: 1000 }).tracks[0].keyframes.find((x) => x.id === "b")!.at, 2000);
  assert.equal(setKeyframe(b, "t", { ...k, at: 3049 }).tracks[0].keyframes.find((x) => x.id === "b")!.at, 3000);
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
