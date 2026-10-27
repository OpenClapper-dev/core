import { test } from "node:test";
import assert from "node:assert/strict";
import { NEUTRAL_LOOK } from "./compose.ts";
import { bakeHash, bakeKey, clipLayersOf, freshBake, layersAt, validateLayerInput, type Layer } from "./layers.ts";

const U = (n: number) => `11111111-2222-4333-8444-${String(n).padStart(12, "0")}`;
const layer = (id: string, patch: Partial<Layer> = {}): Layer => ({
  id, shot_id: "s", kind: "drawing", name: id, description: null, position: 0, visible: true, locked: false, opacity: 1, space: "frame", photo_id: null,
  range: null, look: null, timeline_id: null, clip_id: null, created_at: "2026-10-27T10:00:00Z", updated_at: "2026-10-27T10:00:00Z", ...patch,
});
const s1 = { id: "st1", stored: true, photo: { id: "p1" } }, s2 = { id: "st2", stored: true, photo: { id: "p2" } };
const derived = { id: "photo:p1", stored: false, photo: { id: "p1" } };

test("which layers a step shows: visible, in range, on the step's photo in photo space; bottom to top", () => {
  const ls = [layer("top", { position: 5 }), layer("hidden", { visible: false }), layer("ranged", { range: ["st2"] }), layer("p2only", { space: "photo", photo_id: "p2" }), layer("below", { position: -1 }), layer("clip", { timeline_id: "t", clip_id: "c" })];
  assert.deepEqual(layersAt(ls, s1).map((l) => l.id), ["below", "top"]);
  assert.deepEqual(layersAt(ls, s2).map((l) => l.id), ["below", "p2only", "ranged", "top"]);
  // A derived step (no stored steps) only shows layers on every step.
  assert.deepEqual(layersAt([layer("ranged", { range: [] }), layer("all")], derived).map((l) => l.id), ["all"]);
  assert.deepEqual(clipLayersOf(ls, "c").map((l) => l.id), ["clip"]);
});

test("bake hash: null without layers, changes with the frame, a version or the order", () => {
  const a = layer("a"), b = layer("b", { position: 1 });
  const step = { ...s1, frame: { width_fraction: 0.5, height_fraction: 0.5 } };
  assert.equal(bakeHash(step, []), null);
  const h = bakeHash(step, [a, b])!;
  assert.match(h, /^[0-9a-f]{16}$/);
  assert.equal(bakeHash(step, [b, a]), h);
  assert.notEqual(bakeHash({ ...step, frame: { width_fraction: 0.4, height_fraction: 0.5 } }, [a, b]), h);
  assert.notEqual(bakeHash(step, [a, { ...b, updated_at: "2026-10-27T11:00:00Z" }]), h);
  assert.notEqual(bakeHash(step, [a, { ...b, position: -1 }]), h);
  assert.equal(bakeKey(s1), "st1");
  assert.equal(bakeKey(derived), "p1");
  assert.equal(freshBake([{ step_key: "st1", hash: h, url: "/x" }], s1, h)?.url, "/x");
  assert.equal(freshBake([{ step_key: "st1", hash: "old", url: "/x" }], s1, h), null);
});

test("input validation", () => {
  const ok = { shot_id: U(1), kind: "drawing", name: "Marks", position: 0, visible: true, locked: false, opacity: 1, space: "frame", shapes: [] };
  assert.equal(validateLayerInput(ok), null);
  assert.equal(validateLayerInput({ ...ok, kind: "adjustment", shapes: null, look: { ...NEUTRAL_LOOK, exposure: 0.5 } }), null);
  assert.match(validateLayerInput({ ...ok, kind: "adjustment", look: null })!, /look/);
  assert.match(validateLayerInput({ ...ok, look: NEUTRAL_LOOK })!, /no look/);
  assert.match(validateLayerInput({ ...ok, space: "photo" })!, /photo_id/);
  assert.match(validateLayerInput({ ...ok, photo_id: U(2) })!, /photo_id/);
  assert.match(validateLayerInput({ ...ok, range: [U(3), U(3)] })!, /twice/);
  assert.match(validateLayerInput({ ...ok, position: 1.5 })!, /position/);
  assert.match(validateLayerInput({ ...ok, opacity: 2 })!, /opacity/);
  assert.match(validateLayerInput({ ...ok, timeline_id: U(4) })!, /together/);
  assert.match(validateLayerInput({ ...ok, name: " " })!, /name/);
});
