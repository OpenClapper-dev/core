import { test } from "node:test";
import assert from "node:assert/strict";
import { aspectFrame, opticsFrame, opticsView } from "./optics.ts";

const close = (a: number, b: number, eps = 0.01) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test("full frame 50 mm sees 39.6° × 27°, and is its own full-frame equivalent", () => {
  const v = opticsView({ format: [36, 24], multiplier: 1, squeeze: 1, focal: 50 });
  close(v.horizontal, 39.6, 0.1);
  close(v.vertical, 27.0, 0.1);
  close(v.fullFrame, 50, 0.01);
});

test("a reducer widens, a squeeze widens the horizontal only, portrait swaps", () => {
  const plain = opticsView({ format: [24.89, 18.66], multiplier: 1, squeeze: 1, focal: 50 });
  const reduced = opticsView({ format: [24.89, 18.66], multiplier: 0.71, squeeze: 1, focal: 50 });
  assert.ok(reduced.horizontal > plain.horizontal);
  const ana = opticsView({ format: [24.89, 18.66], multiplier: 1, squeeze: 2, focal: 50 });
  assert.ok(ana.horizontal > plain.horizontal);
  close(ana.vertical, plain.vertical);
  const up = opticsView({ format: [36, 24], multiplier: 1, squeeze: 1, focal: 50, portrait: true });
  close(up.horizontal, 27.0, 0.1);
});

test("a frame is the ratio of tangents; the same optics as the photo fill it", () => {
  const photo = { horizontal: 2 * Math.atan(36 / 48) * 180 / Math.PI, vertical: 2 * Math.atan(24 / 48) * 180 / Math.PI }; // 24 mm on full frame
  const same = opticsFrame({ format: [36, 24], multiplier: 1, squeeze: 1, focal: 24 }, photo);
  close(same.w, 1); close(same.h, 1);
  const tele = opticsFrame({ format: [36, 24], multiplier: 1, squeeze: 1, focal: 48 }, photo);
  close(tele.w, 0.5); close(tele.h, 0.5);
  const wide = opticsFrame({ format: [36, 24], multiplier: 1, squeeze: 1, focal: 12 }, photo);
  close(wide.w, 2);
});

test("a delivery aspect is the centred inner rectangle", () => {
  const photo = { horizontal: 73.7, vertical: 53.1 };
  const f = opticsFrame({ format: [36, 24], multiplier: 1, squeeze: 1, focal: 50, delivery: 2.39 }, photo);
  close(f.inner!.w, f.w);
  close(f.inner!.h, f.h * 1.5 / 2.39);
  const narrow = opticsFrame({ format: [36, 24], multiplier: 1, squeeze: 1, focal: 50, delivery: 1 }, photo);
  close(narrow.inner!.h, narrow.h);
  close(narrow.inner!.w, narrow.w / 1.5);
});

test("an aspect frame keeps its ratio on the photo and stays inside", () => {
  const a = aspectFrame(2.39, 0.8, 4 / 3);
  close((a.w * 4 / 3) / a.h, 2.39);
  const tall = aspectFrame(1 / 2, 1, 16 / 9);
  close(tall.h, 1);
});
