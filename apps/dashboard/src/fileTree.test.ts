import { test } from "node:test";
import assert from "node:assert/strict";
import type { Folder, FolderItem } from "./api.ts";
import { childFolders, folderPath, freeCell, matches, moveTargets, placementOf, shortcutFor, subtree } from "./fileTree.ts";

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
