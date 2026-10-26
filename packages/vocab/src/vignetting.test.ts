import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeVignetting, validateVignetting, vignetteAt } from "./vignetting.ts";

const pts = [{ mm: 24, start: 0.8, end: 1, opacity: 0.2 }, { mm: 18, start: 0.6, end: 0.95, opacity: 0.8 }];

test("validation: shape, ranges, order, repeats", () => {
  assert.equal(validateVignetting(null), null);
  assert.equal(validateVignetting(pts), null);
  assert.match(validateVignetting({})!, /array/);
  assert.match(validateVignetting([{ mm: 0, start: 0, end: 1, opacity: 1 }])!, /mm must be/);
  assert.match(validateVignetting([{ mm: 18, start: 0.9, end: 0.5, opacity: 1 }])!, /below end/);
  assert.match(validateVignetting([{ mm: 18, start: 0.5, end: 0.9, opacity: 2 }])!, /opacity/);
  assert.match(validateVignetting([pts[0], pts[0]])!, /repeats/);
});

test("interpolation: widest point holds below it, none above the longest, linear between", () => {
  assert.deepEqual(normalizeVignetting(pts).map((p) => p.mm), [18, 24]);
  assert.deepEqual(vignetteAt(pts, 12), { start: 0.6, end: 0.95, opacity: 0.8 });
  assert.equal(vignetteAt(pts, 35), null);
  const mid = vignetteAt(pts, 21)!;
  assert.ok(Math.abs(mid.start - 0.7) < 1e-9 && Math.abs(mid.opacity - 0.5) < 1e-9);
  assert.equal(vignetteAt([], 18), null);
  assert.equal(vignetteAt([{ mm: 18, start: 0.5, end: 1, opacity: 0 }], 18), null);
});
