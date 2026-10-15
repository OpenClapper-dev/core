import { test } from "node:test";
import assert from "node:assert/strict";
import { effectiveZoom, offeredZooms, zoomLabel, zoomStops } from "./zoom.ts";

test("stops: the ultra-wide below 1×, then 1× and tele stops up to the maximum", () => {
  assert.deepEqual(zoomStops({ min: 0.5, max: 30 }), [0.5, 1, 2, 3, 5, 10]);
  assert.deepEqual(zoomStops({ min: 0.6, max: 8 }), [0.6, 1, 2, 3, 5]);
  assert.deepEqual(zoomStops({ min: 1, max: 2 }), [1, 2]);
  assert.deepEqual(zoomStops(null), [1]);
  assert.deepEqual(zoomStops({ min: 0, max: 0 }), [1]); // camera not started yet
});

test("offered: all, a picked list (never empty), or the fixed one", () => {
  const stops = [0.5, 1, 2, 3];
  assert.deepEqual(offeredZooms(stops, { mode: "all" }), stops);
  assert.deepEqual(offeredZooms(stops, { mode: "list", zooms: [3, 0.5] }), [0.5, 3]);
  assert.deepEqual(offeredZooms(stops, { mode: "list", zooms: [0.6] }), [1]);
  assert.deepEqual(offeredZooms(stops, { mode: "fixed", zoom: 0.5 }), [0.5]);
  assert.deepEqual(offeredZooms([1, 2], { mode: "fixed", zoom: 0.5 }), [1]);
});

test("effective zoom falls back to the nearest offered stop", () => {
  assert.equal(effectiveZoom(2, [0.5, 1, 2]), 2);
  assert.equal(effectiveZoom(0.5, [1, 2, 3]), 1);
  assert.equal(effectiveZoom(5, [0.5, 1, 3]), 3);
  assert.equal(effectiveZoom(1, []), 1);
});

test("labels", () => {
  assert.equal(zoomLabel(0.5), "0.5×");
  assert.equal(zoomLabel(3), "3×");
});
