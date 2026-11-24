import { test } from "node:test";
import assert from "node:assert/strict";
import { eraseAt, type Erasable } from "./erase.ts";

const pen = (id: string, pts: [number, number][], more: Partial<Erasable> = {}): Erasable => ({ id, kind: "pen", x: 0, y: 0, w: 1, h: 1, pts, visible: true, locked: false, ...more });
const line: [number, number][] = Array.from({ length: 11 }, (_, i) => [i / 10, 0.5]);
let n = 0;
const id = () => `n${n++}`;

test("partial: the part of a pen stroke under the eraser goes and the stroke splits", () => {
  const out = eraseAt([pen("a", line)], [0.5, 0.5], 0.06, 1, "partial", id);
  assert.equal(out.length, 2);
  assert.equal(out[0].id, "a");
  assert.ok(out[0].x + out[0].w <= 0.45 && out[1].x >= 0.55);
});

test("partial: shapes touched go whole, untouched ones stay; nothing touched gives the same list", () => {
  const box: Erasable = { id: "r", kind: "rect", x: 0.6, y: 0.6, w: 0.2, h: 0.2, visible: true, locked: false };
  const objs = [pen("a", line), box];
  assert.equal(eraseAt(objs, [0.1, 0.1], 0.02, 1, "partial", id), objs);
  assert.deepEqual(eraseAt(objs, [0.7, 0.62], 0.05, 1, "partial", id).map((o) => o.id), ["a"]);
});

test("whole: a touched stroke goes completely; locked, hidden and grouped ones stay", () => {
  assert.deepEqual(eraseAt([pen("a", line)], [0.5, 0.5], 0.03, 1, "whole", id), []);
  const kept = [pen("l", line, { locked: true }), pen("h", line, { visible: false }), pen("g", line, { group: "g1" })];
  assert.equal(eraseAt(kept, [0.5, 0.5], 0.03, 1, "whole", id), kept);
});

test("the eraser is round on a wide surface", () => {
  const vertical = pen("v", [[0.5, 0], [0.5, 1]]);
  // On a 2:1 surface, 0.05 of the height is 0.025 of the width.
  assert.equal(eraseAt([vertical], [0.53, 0.5], 0.05, 2, "whole", id).length, 1);
  assert.equal(eraseAt([vertical], [0.52, 0.5], 0.05, 2, "whole", id).length, 0);
});
