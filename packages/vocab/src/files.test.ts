import { test } from "node:test";
import assert from "node:assert/strict";
import { APP_IDS, FILE_RESOURCE_TYPES, FILE_TYPE_META, TRASH_RETENTION_DAYS, TRASH_TYPES, trashDaysLeft, validateDesktopItem } from "./files.ts";

const id = "8f9c2b1e-1a2b-4c3d-8e4f-5a6b7c8d9e0f";

test("every file type has meta pointing at a known app", () => {
  for (const t of FILE_RESOURCE_TYPES) assert.ok((APP_IDS as readonly string[]).includes(FILE_TYPE_META[t].app), t);
});

test("desktop items need exactly their kind's target", () => {
  assert.equal(validateDesktopItem({ kind: "app", app_id: "gallery", x: 0, y: 0 }), null);
  assert.equal(validateDesktopItem({ kind: "folder", folder_id: id, x: 10, y: 20 }), null);
  assert.equal(validateDesktopItem({ kind: "resource", resource_type: "shot", resource_id: id, label: "Hero", x: 1, y: 2 }), null);
  assert.match(validateDesktopItem({ kind: "app", x: 0, y: 0 })!, /app_id is required/);
  assert.match(validateDesktopItem({ kind: "app", app_id: "gallery", folder_id: id, x: 0, y: 0 })!, /folder_id is not allowed/);
  assert.match(validateDesktopItem({ kind: "resource", resource_type: "rig", resource_id: id, x: 0, y: 0 })!, /resource_type/);
  assert.match(validateDesktopItem({ kind: "app", app_id: "photoshop", x: 0, y: 0 })!, /app_id must be one of/);
  assert.match(validateDesktopItem({ kind: "trash", x: 0, y: 0 })!, /kind/);
});

test("labels and positions are bounded", () => {
  assert.match(validateDesktopItem({ kind: "app", app_id: "files", label: "  ", x: 0, y: 0 })!, /label/);
  assert.match(validateDesktopItem({ kind: "app", app_id: "files", label: "x".repeat(81), x: 0, y: 0 })!, /label/);
  assert.match(validateDesktopItem({ kind: "app", app_id: "files", x: -1, y: 0 })!, /x must/);
  assert.match(validateDesktopItem({ kind: "app", app_id: "files", x: 0, y: Number.NaN })!, /y must/);
  assert.equal(validateDesktopItem({ kind: "app", app_id: "files", label: null, x: 0, y: 0 }), null);
});

test("taskbar items carry an area and an integer position", () => {
  assert.equal(validateDesktopItem({ kind: "app", app_id: "files", area: "taskbar", position: 3, x: 0, y: 0 }), null);
  assert.equal(validateDesktopItem({ kind: "folder", folder_id: id, area: "desktop", x: 0, y: 0 }), null);
  assert.match(validateDesktopItem({ kind: "app", app_id: "files", area: "dock", x: 0, y: 0 })!, /area/);
  assert.match(validateDesktopItem({ kind: "app", app_id: "files", area: "taskbar", position: 1.5, x: 0, y: 0 })!, /position/);
});

test("the bin takes every file type and folders, and counts down from 30 days", () => {
  assert.deepEqual([...TRASH_TYPES], [...FILE_RESOURCE_TYPES, "folder"]);
  const now = Date.parse("2026-10-16T12:00:00Z");
  assert.equal(trashDaysLeft("2026-10-16T12:00:00Z", now), TRASH_RETENTION_DAYS);
  assert.equal(trashDaysLeft("2026-10-06T11:00:00Z", now), 20);
  assert.equal(trashDaysLeft("2026-09-01T00:00:00Z", now), 0);
});
