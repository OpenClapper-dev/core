import { test } from "node:test";
import assert from "node:assert/strict";
import { cellAt, cellKey, cellSpot, layOut, nearestFreeCell, type Grid } from "./grid.ts";

const g: Grid = { w: 96, h: 100, pad: 12, cols: 5, rows: 4 };

test("cells and spots round-trip", () => {
  assert.deepEqual(cellSpot(g, { c: 2, r: 1 }), { x: 204, y: 112 });
  assert.deepEqual(cellAt(g, 204, 112), { c: 2, r: 1 });
  assert.deepEqual(cellAt(g, 240, 150), { c: 2, r: 1 });
  assert.deepEqual(cellAt(g, -50, -50), { c: 0, r: 0 });
});

test("nearest free cell: the wanted one, else the closest, else a new column", () => {
  const taken = new Set(["0:0", "0:1", "1:0"]);
  assert.deepEqual(nearestFreeCell(taken, { c: 3, r: 2 }, 5, 4), { c: 3, r: 2 });
  assert.deepEqual(nearestFreeCell(taken, { c: 0, r: 0 }, 5, 4), { c: 1, r: 1 });
  assert.deepEqual(nearestFreeCell(new Set(), { c: 40, r: -3 }, 5, 4), { c: 4, r: 0 });
  const full = new Set(["0:0", "0:1", "1:0", "1:1"]);
  assert.deepEqual(nearestFreeCell(full, { c: 1, r: 1 }, 2, 2), { c: 2, r: 0 });
  const t2 = new Set<string>();
  for (let i = 0; i < 5; i++) t2.add(cellKey(nearestFreeCell(t2, { c: 1, r: 1 }, 3, 3)));
  assert.equal(t2.size, 5);
});

test("laying out: saved cells hold, the rest fill in without overlap", () => {
  const cells = layOut(["a", "b", "c", "bin"], { a: { c: 1, r: 1 }, b: { c: 1, r: 1 }, c: { c: 9, r: 9 } }, g, (id) => (id === "bin" ? { c: 4, r: 3 } : undefined));
  assert.deepEqual(cells.get("a"), { c: 1, r: 1 });
  assert.notDeepEqual(cells.get("b"), { c: 1, r: 1 });
  assert.deepEqual(cells.get("c"), { c: 4, r: 3 }, "an off-screen cell comes back to the nearest one on screen");
  assert.equal(new Set([...cells.values()].map(cellKey)).size, 4);
});
