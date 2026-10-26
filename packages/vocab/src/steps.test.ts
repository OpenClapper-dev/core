import { test } from "node:test";
import assert from "node:assert/strict";
import type { Framing } from "./framing.ts";
import { stepFrame, stepKey, stepsOf, stepsProblem, validateStepInput, type ShotStep } from "./steps.ts";

const fr = (id: string, photo: string, frame: Framing["frame"]): Framing => ({ id, photo_id: photo, name: id, rig_id: null, lens_mm: 35, frame, position: 0, created_at: "", updated_at: null });
const captured = { frame: { width_fraction: 0.6, height_fraction: 0.45 } };
const p1 = { id: "p1", framing: captured, framings: [fr("f1", "p1", { width_fraction: 0.3, height_fraction: 0.2, x: 0.3, y: 0.4 })], root_framing_id: null };
const p2 = { id: "p2", framing: captured, framings: [], root_framing_id: null };
const o1 = { id: "o1", photo_id: "p1", presentation: { mode: "fit", frame: { width_fraction: 0.5, height_fraction: 0.5, x: 0.7 }, framing_id: "gone", label: null }, render_url: "/r/o1" };
const o2 = { id: "o2", photo_id: "p1", presentation: { mode: "fit", frame: null, framing_id: "f1", label: null }, render_url: null };
const step = (id: string, ordinal: number, photo_id: string, framing_id: string | null = null, overlay_id: string | null = null): ShotStep => ({ id, shot_id: "s", ordinal, photo_id, framing_id, overlay_id });

test("without stored steps the photos are the steps, in order", () => {
  const out = stepsOf({ photos: [p1, p2], overlays: [o1] });
  assert.deepEqual(out.map((s) => [s.id, s.stored, s.frame?.width_fraction]), [["photo:p1", false, 0.6], ["photo:p2", false, 0.6]]);
});

test("stored steps resolve framing and overlay, sorted by ordinal; dangling ids read as null", () => {
  const out = stepsOf({ photos: [p1, p2], overlays: [o1, o2], steps: [step("b", 1, "p1", null, "o1"), step("a", 0, "p1", "f1"), step("c", 2, "p2", "nope", "o1")] });
  assert.deepEqual(out.map((s) => s.id), ["a", "b", "c"]);
  assert.equal(out[0].framing?.id, "f1");
  assert.deepEqual(out[0].frame, { width_fraction: 0.3, height_fraction: 0.2, x: 0.3, y: 0.4 });
  assert.equal(out[1].overlay?.id, "o1");
  // The overlay's framing is gone: its kept frame copy applies.
  assert.equal(out[1].frame?.x, 0.7);
  // p2 has no framing "nope" and o1 is p1's: both null, the root frame applies.
  assert.equal(out[2].framing, null);
  assert.equal(out[2].overlay, null);
  assert.equal(out[2].frame?.width_fraction, 0.6);
  assert.equal(out.every((s) => s.stored), true);
});

test("steps whose photos are all gone fall back to the photos", () => {
  assert.equal(stepsOf({ photos: [p1], steps: [step("a", 0, "deleted")] })[0].id, "photo:p1");
});

test("step frame: framing, else the overlay's presentation framing, else root", () => {
  assert.equal(stepFrame(p1, null, o2)?.width_fraction, 0.3);
  assert.equal(stepFrame(p1, null, { ...o2, presentation: { mode: "fit", frame: null, label: null } })?.width_fraction, 0.6);
  assert.equal(stepFrame({ id: "u", framing: null }, null, null), null);
  assert.equal(stepKey({ photo: p1, framing: p1.framings[0], overlay: null }), "p1|f1|");
});

test("input validation", () => {
  const id = "11111111-2222-4333-8444-555555555555", id2 = "11111111-2222-4333-8444-555555555556";
  assert.equal(validateStepInput([{ id, photo_id: id2, framing_id: null }]), null);
  assert.match(validateStepInput({})!, /array/);
  assert.match(validateStepInput([{ id: "x", photo_id: id2 }])!, /id must be a UUID/);
  assert.match(validateStepInput([{ id, photo_id: id2 }, { id, photo_id: id2 }])!, /repeats/);
  assert.match(validateStepInput([{ id, photo_id: id2, overlay_id: 3 }])!, /overlay_id/);
  assert.match(validateStepInput(Array.from({ length: 501 }, () => ({ id, photo_id: id2 })))!, /at most/);
});

test("membership: photo of the shot, framing of that photo, shot overlay of that photo", () => {
  const have = { photos: new Set(["p1", "p2"]), framingPhoto: new Map([["f1", "p1"]]), overlayPhoto: new Map([["o1", { photo_id: "p1", clip_owned: false }], ["oc", { photo_id: "p1", clip_owned: true }]]) };
  assert.equal(stepsProblem([{ id: "a", photo_id: "p1", framing_id: "f1", overlay_id: "o1" }], have), null);
  assert.match(stepsProblem([{ id: "a", photo_id: "p9" }], have)!, /not one of the shot's photos/);
  assert.match(stepsProblem([{ id: "a", photo_id: "p2", framing_id: "f1" }], have)!, /framing/);
  assert.match(stepsProblem([{ id: "a", photo_id: "p2", overlay_id: "o1" }], have)!, /overlay is not/);
  assert.match(stepsProblem([{ id: "a", photo_id: "p1", overlay_id: "oc" }], have)!, /timeline clip/);
});
