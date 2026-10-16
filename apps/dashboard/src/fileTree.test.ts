import { test } from "node:test";
import assert from "node:assert/strict";
import type { Folder, FolderItem } from "./api.ts";
import { cellAt, cellKey, cellSpot, childFolders, folderPath, freeCell, matches, moveTargets, nearestFreeCell, placementOf, shortcutFor, subtree } from "./fileTree.ts";

const f = (id: string, parent: string | null, name = id): Folder => ({ id, project_id: "p", parent_id: parent, name, created_at: "", updated_at: null });
const folders = [f("a", null, "Scouting"), f("b", "a", "Roof"), f("c", "b", "North"), f("d", null, "archive")];

test("placements: a missing folder counts as root", () => {
  const items: FolderItem[] = [{ resource_type: "shot", resource_id: "s1", folder_id: "b", created_at: "" }, { resource_type: "shot", resource_id: "s2", folder_id: "gone", created_at: "" }];
  const at = placementOf(items, folders);
  assert.equal(at("shot", "s1"), "b");
  assert.equal(at("shot", "s2"), null);
  assert.equal(at("timeline", "s1"), null);
});

test("tree helpers: children by name, path, subtree, move targets", () => {
  assert.deepEqual(childFolders(folders, null).map((x) => x.name), ["archive", "Scouting"]);
  assert.deepEqual(folderPath(folders, "c").map((x) => x.id), ["a", "b", "c"]);
  assert.deepEqual(folderPath(folders, null), []);
  assert.deepEqual([...subtree(folders, "a")].sort(), ["a", "b", "c"]);
  assert.deepEqual(moveTargets(folders, "b").map((x) => x.id).sort(), ["a", "d"]);
});

test("a broken parent chain or cycle does not hang", () => {
  const loop = [f("x", "y"), f("y", "x")];
  assert.equal(folderPath(loop, "x").length, 2);
  assert.deepEqual([...subtree(loop, "x")].sort(), ["x", "y"]);
});

test("search, shortcut lookup, free desktop cell", () => {
  assert.ok(matches("roo", "Roof", null));
  assert.ok(!matches("cellar", "Roof"));
  assert.ok(matches("  ", "anything"));
  const desk = [{ id: "1", project_id: "p", kind: "app" as const, resource_type: null, resource_id: null, folder_id: null, app_id: "gallery" as const, label: null, x: 0, y: 0, created_at: "", updated_at: null }];
  assert.equal(shortcutFor(desk, { kind: "app", app_id: "gallery" })?.id, "1");
  assert.equal(shortcutFor(desk, { kind: "app", app_id: "files" }), undefined);
  assert.deepEqual(freeCell([{ x: 0, y: 0 }, { x: 0, y: 100 }], { w: 96, h: 100 }, 3), { x: 0, y: 200 });
  assert.deepEqual(freeCell([{ x: 0, y: 0 }, { x: 0, y: 100 }], { w: 96, h: 100 }, 2), { x: 96, y: 0 });
});

test("desktop grid: cells and spots round-trip", () => {
  const g = { w: 96, h: 100, pad: 12, cols: 10, rows: 6 };
  assert.deepEqual(cellAt(g, 12, 12), { c: 0, r: 0 });
  assert.deepEqual(cellAt(g, 12 + 96 * 2 + 40, 12 + 100 * 3 - 30), { c: 2, r: 3 });
  assert.deepEqual(cellAt(g, -50, -50), { c: 0, r: 0 });
  assert.deepEqual(cellSpot(g, { c: 2, r: 3 }), { x: 12 + 192, y: 312 });
});

test("nearest free cell: the wanted one, else the closest, else a new column", () => {
  const taken = new Set(["0:0", "0:1", "1:0"].map((k) => k));
  assert.deepEqual(nearestFreeCell(taken, { c: 3, r: 2 }, 5, 4), { c: 3, r: 2 });
  assert.deepEqual(nearestFreeCell(taken, { c: 0, r: 0 }, 5, 4), { c: 1, r: 1 });
  // Outside the grid: clamped to its edge first.
  assert.deepEqual(nearestFreeCell(new Set(), { c: 40, r: -3 }, 5, 4), { c: 4, r: 0 });
  // Full: the next column, top first.
  const full = new Set<string>();
  for (let c = 0; c < 2; c++) for (let r = 0; r < 2; r++) full.add(cellKey({ c, r }));
  assert.deepEqual(nearestFreeCell(full, { c: 1, r: 1 }, 2, 2), { c: 2, r: 0 });
  // Placing several in turn never stacks them.
  const t2 = new Set<string>();
  for (let i = 0; i < 5; i++) t2.add(cellKey(nearestFreeCell(t2, { c: 1, r: 1 }, 3, 3)));
  assert.equal(t2.size, 5);
});
