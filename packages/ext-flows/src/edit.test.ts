import { test } from "node:test";
import assert from "node:assert/strict";
import { CATALOGUE } from "@openclapper/ext-hardware";
import { addKeyframe, addMarker, addTrack, fmtSeconds, moveKeyframes, patchTrack, removeKeys, setDuration, setKeyframe, setMargin, snapLevel } from "./edit.ts";
import { START_KEYFRAME, type Keyframe } from "./flow.ts";
import type { FlowBody } from "./index.ts";
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
  assert.equal(addKeyframe(one.body, "t", 1200, "k2").keyframe, null);
  assert.equal(addKeyframe(one.body, "t", 1300, "k2").keyframe!.at, 1500);
  assert.equal(addKeyframe(b, "t", 200, "k3").keyframe!.at, 500);
  const cam = addKeyframe(addTrack(emptyFlow(), camera, "c"), "c", 500, "k");
  assert.deepEqual(cam.keyframe!.controls, {});
});

test("a keyframe moved stays off another's time; the start keyframe stays at 0 and is never removed", () => {
  let b = addKeyframe(addTrack(emptyFlow(), light, "t"), "t", 1000, "a").body;
  b = addKeyframe(b, "t", 2000, "b").body;
  const k = b.tracks[0].keyframes.find((x) => x.id === "b")!;
  // Onto a's time: cut short a step, to the half second after it.
  assert.equal(setKeyframe(b, "t", { ...k, at: 1000 }).tracks[0].keyframes.find((x) => x.id === "b")!.at, 1500);
  assert.equal(setKeyframe(b, "t", { ...k, at: 3490 }).tracks[0].keyframes.find((x) => x.id === "b")!.at, 3500);
  assert.equal(setKeyframe(b, "t", { ...k, at: 3200 }).tracks[0].keyframes.find((x) => x.id === "b")!.at, 3000);
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

test("times are half seconds; a keyframe from before keeps its time until it is moved", () => {
  let b = addTrack(emptyFlow(), light, "t");
  b = patchTrack(b, "t", (t) => ({ ...t, keyframes: [...t.keyframes, { id: "old", at: 2300, intensity: 0.2 }] }));
  const k = b.tracks[0].keyframes.find((x) => x.id === "old")!;
  assert.equal(setKeyframe(b, "t", { ...k, intensity: 0.9 }).tracks[0].keyframes.find((x) => x.id === "old")!.at, 2300);
  assert.equal(setKeyframe(b, "t", { ...k, at: 2100 }).tracks[0].keyframes.find((x) => x.id === "old")!.at, 2000);
  assert.equal(setKeyframe(b, "t", { ...k, at: 2400 }).tracks[0].keyframes.find((x) => x.id === "old")!.at, 2500);
  assert.equal(fmtSeconds(12_000), "12 s");
  assert.equal(fmtSeconds(12_500), "12.5 s");
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

// Margins (#426): a track with keyframes at whole seconds, each with its margins ([before, after] in seconds).
function track(ks: Record<string, [number, number?, number?]>, durationMs = 30_000): FlowBody {
  const b = { ...emptyFlow(), durationMs, tracks: [] } as FlowBody;
  const keyframes: Keyframe[] = Object.entries(ks).map(([id, [s, before, after]]) => ({
    id, at: s * 1000, ...(before ? { marginBeforeMs: before * 1000 } : {}), ...(after ? { marginAfterMs: after * 1000 } : {}),
  }));
  return { ...b, tracks: [{ id: "t", name: "T", model: light, device: null, keyframes }] };
}
const times = (b: FlowBody | null) => Object.fromEntries((b?.tracks[0].keyframes ?? []).map((k) => [k.id, k.at / 1000]));

test("margins are kept in the body and checked", () => {
  const b = track({ [START_KEYFRAME]: [0, 0, 2], a: [5, 1, 3] });
  assert.equal(flowError(b as unknown as Record<string, unknown>), null);
  const bad = track({ [START_KEYFRAME]: [0, 2] });
  assert.match(flowError(bad as unknown as Record<string, unknown>)!, /no margin before/);
  const half = { ...b, tracks: [{ ...b.tracks[0], keyframes: [b.tracks[0].keyframes[0], { id: "a", at: 5000, marginAfterMs: 1500 }] }] };
  assert.equal(flowError(half as unknown as Record<string, unknown>), null);
  const off = { ...b, tracks: [{ ...b.tracks[0], keyframes: [b.tracks[0].keyframes[0], { id: "a", at: 5000, marginAfterMs: 1200 }] }] };
  assert.match(flowError(off as unknown as Record<string, unknown>)!, /half seconds/);
});

test("moving into a neighbour's margin pushes it; those further away stay put", () => {
  const b = track({ [START_KEYFRAME]: [0], a: [5, 0, 2], n: [10], far: [20] });
  assert.deepEqual(times(moveKeyframes(b, [{ trackId: "t", id: "a", at: 9000 }])), { [START_KEYFRAME]: 0, a: 9, n: 11, far: 20 });
  // The neighbour's own margin before counts too.
  const c = track({ [START_KEYFRAME]: [0], a: [5], n: [10, 3] });
  assert.deepEqual(times(moveKeyframes(c, [{ trackId: "t", id: "a", at: 8000 }])), { [START_KEYFRAME]: 0, a: 8, n: 11 });
});

test("moving backward pushes the keyframes before it earlier", () => {
  const b = track({ [START_KEYFRAME]: [0], p: [6], a: [10, 2] });
  assert.deepEqual(times(moveKeyframes(b, [{ trackId: "t", id: "a", at: 7000 }])), { [START_KEYFRAME]: 0, p: 5, a: 7 });
});

test("a push goes on through further keyframes, each with its own margins", () => {
  const b = track({ [START_KEYFRAME]: [0], a: [2, 0, 2], n: [5, 0, 3], m: [8], z: [12, 1] });
  // a to 4: n to 6, n's margin after pushes m to 9; z (12) is still 3 away, more than its 1 s.
  assert.deepEqual(times(moveKeyframes(b, [{ trackId: "t", id: "a", at: 4000 }])), { [START_KEYFRAME]: 0, a: 4, n: 6, m: 9, z: 12 });
  // A pushed keyframe without a margin keeps a step (half a second) from the one pushing it.
  const c = track({ [START_KEYFRAME]: [0], a: [2, 0, 2], n: [5], m: [5.5] });
  assert.deepEqual(times(moveKeyframes(c, [{ trackId: "t", id: "a", at: 4000 }])), { [START_KEYFRAME]: 0, a: 4, n: 6, m: 6.5 });
});

test("a push that would leave the flow cuts the move short", () => {
  const b = track({ [START_KEYFRAME]: [0], a: [20, 0, 3], n: [25, 0, 2], m: [28] });
  // a wants 26: n would go to 29 and m to 31, past 30. The farthest a can go: 25 (n 28, m 30).
  assert.deepEqual(times(moveKeyframes(b, [{ trackId: "t", id: "a", at: 26_000 }])), { [START_KEYFRAME]: 0, a: 25, n: 28, m: 30 });
});

test("the start keyframe never moves and its margin holds the others off", () => {
  const b = track({ [START_KEYFRAME]: [0, 0, 3], p: [5], a: [9, 2] });
  // a to 6 pushes p to 4, which keeps 3 from the start... a to 4 would need p at 2: inside the start's margin, so a stops at 5.
  assert.deepEqual(times(moveKeyframes(b, [{ trackId: "t", id: "a", at: 4000 }])), { [START_KEYFRAME]: 0, p: 3, a: 5 });
  assert.deepEqual(times(moveKeyframes(b, [{ trackId: "t", id: START_KEYFRAME, at: 4000 }])), times(b));
  // A margin on the start pushes too, or is refused when nothing can make room.
  assert.deepEqual(times(setMargin(b, "t", START_KEYFRAME, "after", 6000)), { [START_KEYFRAME]: 0, p: 6, a: 9 });
  assert.deepEqual(times(setMargin(b, "t", START_KEYFRAME, "after", 29_000)), times(b));
  assert.equal(setMargin(b, "t", START_KEYFRAME, "before", 2000).tracks[0].keyframes[0].marginBeforeMs, undefined);
});

test("a selection moves together and is cut short together", () => {
  const b = track({ [START_KEYFRAME]: [0], a: [4], c: [6], n: [10, 2], far: [27, 0, 0] });
  assert.deepEqual(times(moveKeyframes(b, [{ trackId: "t", id: "a", at: 7000 }, { trackId: "t", id: "c", at: 9000 }])), { [START_KEYFRAME]: 0, a: 7, c: 9, n: 11, far: 27 });
  // Further on, n is pushed into far (27), which goes a step after it; c past 27.5 would push far off the end.
  assert.deepEqual(times(moveKeyframes(b, [{ trackId: "t", id: "a", at: 30_000 }, { trackId: "t", id: "c", at: 32_000 }])), { [START_KEYFRAME]: 0, a: 25.5, c: 27.5, n: 29.5, far: 30 });
  // A keyframe caught between two selected ones moving towards each other: cut short a step at a time until it fits.
  const s = track({ [START_KEYFRAME]: [0], a: [2, 0, 2], m: [5], c: [8, 2] });
  assert.deepEqual(times(moveKeyframes(s, [{ trackId: "t", id: "a", at: 3000 }, { trackId: "t", id: "c", at: 6000 }])), { [START_KEYFRAME]: 0, a: 2.5, m: 4.5, c: 6.5 });
});

test("without margins keyframes may pass each other but never share a time", () => {
  const b = track({ [START_KEYFRAME]: [0], a: [4], n: [6] });
  assert.deepEqual(times(moveKeyframes(b, [{ trackId: "t", id: "a", at: 8000 }])), { [START_KEYFRAME]: 0, a: 8, n: 6 });
  assert.deepEqual(times(moveKeyframes(b, [{ trackId: "t", id: "a", at: 6000 }])), { [START_KEYFRAME]: 0, a: 5.5, n: 6 });
});

test("setting a margin or a time through setKeyframe pushes the same way", () => {
  const b = track({ [START_KEYFRAME]: [0], a: [5], n: [7] });
  const m = setMargin(b, "t", "a", "after", 4000);
  assert.deepEqual(times(m), { [START_KEYFRAME]: 0, a: 5, n: 9 });
  assert.equal(m.tracks[0].keyframes.find((k) => k.id === "a")!.marginAfterMs, 4000);
  assert.equal(setMargin(m, "t", "a", "after", 0).tracks[0].keyframes.find((k) => k.id === "a")!.marginAfterMs, undefined);
  const a = m.tracks[0].keyframes.find((k) => k.id === "a")!;
  assert.deepEqual(times(setKeyframe(m, "t", { ...a, at: 8000 })), { [START_KEYFRAME]: 0, a: 8, n: 12 });
  // A keyframe added inside a margin pushes that neighbour away (here a, back to 4 s from it).
  assert.deepEqual(times(addKeyframe(m, "t", 7000, "x").body), { [START_KEYFRAME]: 0, a: 3, n: 9, x: 7 });
});
