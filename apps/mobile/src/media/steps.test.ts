import { test } from "node:test";
import assert from "node:assert/strict";
import { nextStep, rejected, stateOf, STUCK_AFTER } from "./steps.ts";

test("an unknown step starts again from the beginning (the server takes every step again)", () => {
  assert.equal(nextStep("thumbnail"), "thumbnail");
  assert.equal(nextStep(undefined), "meta");
  assert.equal(nextStep("shot"), "meta");
});

test("the third rejection parks a photo; a file gone from the phone at once", () => {
  let r = { rejections: 0, stuck: false };
  for (let i = 1; i < STUCK_AFTER; i++) { r = rejected(r.rejections); assert.equal(r.stuck, false); }
  assert.equal(rejected(r.rejections).stuck, true);
  assert.deepEqual(rejected(0, true), { rejections: 1, stuck: true });
});

test("what a queued photo shows", () => {
  assert.equal(stateOf({ step: "meta", stuck: false }), "waiting");
  assert.equal(stateOf({ step: "preview", stuck: false }), "waiting");
  assert.equal(stateOf({ step: "original", stuck: false }), "preview");
  assert.equal(stateOf({ step: "original", stuck: true }), "stuck");
});
