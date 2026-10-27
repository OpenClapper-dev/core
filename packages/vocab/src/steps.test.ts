import { test } from "node:test";
import assert from "node:assert/strict";
import type { Framing } from "./framing.ts";
import { stepFrame, stepKey, stepsOf, stepsProblem, validateStepInput, type ShotStep } from "./steps.ts";

const fr = (id: string, photo: string, frame: Framing["frame"]): Framing => ({ id, photo_id: photo, name: id, rig_id: null, lens_mm: 35, frame, position: 0, created_at: "", updated_at: null });
const captured = { frame: { width_fraction: 0.6, height_fraction: 0.45 } };
const p1 = { id: "p1", framing: captured, framings: [fr("f1", "p1", { width_fraction: 0.3, height_fraction: 0.2, x: 0.3, y: 0.4 })], root_framing_id: null };
const p2 = { id: "p2", framing: captured, framings: [], root_framing_id: null };
const step = (id: string, ordinal: number, photo_id: string, framing_id: string | null = null): ShotStep => ({ id, shot_id: "s", ordinal, photo_id, framing_id });

test("without stored steps the photos are the steps, in order", () => {
  const out = stepsOf({ photos: [p1, p2] });
  assert.deepEqual(out.map((s) => [s.id, s.stored, s.frame?.width_fraction]), [["photo:p1", false, 0.6], ["photo:p2", false, 0.6]]);
});

test("stored steps resolve their framing, sorted by ordinal; a dangling framing reads as null", () => {
  const out = stepsOf({ photos: [p1, p2], steps: [step("b", 1, "p2", "nope"), step("a", 0, "p1", "f1")] });
  assert.deepEqual(out.map((s) => s.id), ["a", "b"]);
  assert.deepEqual(out[0].frame, { width_fraction: 0.3, height_fraction: 0.2, x: 0.3, y: 0.4 });
  assert.equal(out[1].framing, null);
  assert.equal(out[1].frame?.width_fraction, 0.6);
  assert.equal(out.every((s) => s.stored), true);
});

test("steps whose photos are all gone fall back to the photos", () => {
  assert.equal(stepsOf({ photos: [p1], steps: [step("a", 0, "deleted")] })[0].id, "photo:p1");
});

test("step frame: framing, else root; key tells pictures apart", () => {
  assert.equal(stepFrame(p1, p1.framings[0])?.width_fraction, 0.3);
  assert.equal(stepFrame(p1, null)?.width_fraction, 0.6);
  assert.equal(stepFrame({ id: "u", framing: null }, null), null);
  assert.equal(stepKey({ photo: p1, framing: p1.framings[0] }), "p1|f1");
});

test("input validation", () => {
  const id = "11111111-2222-4333-8444-555555555555", id2 = "11111111-2222-4333-8444-555555555556";
  assert.equal(validateStepInput([{ id, photo_id: id2, framing_id: null }]), null);
  assert.match(validateStepInput({})!, /array/);
  assert.match(validateStepInput([{ id: "x", photo_id: id2 }])!, /id must be a UUID/);
  assert.match(validateStepInput([{ id, photo_id: id2 }, { id, photo_id: id2 }])!, /repeats/);
  assert.match(validateStepInput([{ id, photo_id: id2, framing_id: 3 }])!, /framing_id/);
  assert.match(validateStepInput(Array.from({ length: 501 }, () => ({ id, photo_id: id2 })))!, /at most/);
});

test("membership: photo of the shot, framing of that photo", () => {
  const have = { photos: new Set(["p1", "p2"]), framingPhoto: new Map([["f1", "p1"]]) };
  assert.equal(stepsProblem([{ id: "a", photo_id: "p1", framing_id: "f1" }], have), null);
  assert.match(stepsProblem([{ id: "a", photo_id: "p9" }], have)!, /not one of the shot's photos/);
  assert.match(stepsProblem([{ id: "a", photo_id: "p2", framing_id: "f1" }], have)!, /framing/);
});
