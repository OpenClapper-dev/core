import { test } from "node:test";
import assert from "node:assert/strict";
import { binDaysLeft, canBeInternal, checkFile, containerTypes, fileType, MAX_BODY_BYTES, nameError, placementError, registerFileType, type Checked, type FileType } from "./files.ts";
import { FOLDER, SHORTCUT } from "./types.ts";

const id = "8f9c2b1e-1a2b-4c3d-8e4f-5a6b7c8d9e0f";
const err = (c: Checked) => (c.ok ? null : c.error);

/** Stand-ins for types later steps bring: a container of one type, a type bound to Settings, a versioned body. */
const PHOTO: FileType = { type: "t-photo", label: "Photo", plural: "Photos", roots: ["project"], version: 1, empty: () => ({}), check: () => null };
const COLLECTION: FileType = { type: "t-collection", label: "Collection", plural: "Collections", roots: ["project"], holds: ["t-photo"], version: 1, empty: () => ({}), check: () => null };
const DEFINITION: FileType = { type: "t-definition", label: "Property", plural: "Properties", roots: ["project"], onlyIn: "settings", version: 1, empty: () => ({}), check: () => null };
const NOTE: FileType = {
  type: "t-note", label: "Note", plural: "Notes", roots: ["project", "home"], refs: ["content"], version: 3,
  empty: () => ({ text: "" }),
  check: (b) => (typeof b.text === "string" ? null : "text must be a string"),
  upgrade: (b, from) => { if (from === 1) throw new Error("too old"); return { text: String(b.t ?? "") }; },
};
for (const t of [PHOTO, COLLECTION, DEFINITION, NOTE]) registerFileType(t);

test("the registry knows the core types and refuses a second type of the same name", () => {
  assert.equal(fileType("folder"), FOLDER);
  assert.equal(fileType("flow"), undefined);
  assert.deepEqual(containerTypes(), ["folder", "collection", "t-collection"]);
  registerFileType(FOLDER);
  assert.throws(() => registerFileType({ ...FOLDER }), /registered twice/);
  assert.throws(() => registerFileType({ ...FOLDER, type: "Bad Name" }), /lower-case/);
  assert.throws(() => registerFileType({ ...FOLDER, type: "v2", version: 2 }), /no upgrade/);
});

test("a folder's body is empty", () => {
  assert.equal(err(checkFile(FOLDER, {}, undefined, null)), null);
  assert.match(err(checkFile(FOLDER, { colour: 3 }, 1, null))!, /no "colour"/);
  assert.match(err(checkFile(FOLDER, [], 1, null))!, /must be an object/);
  assert.match(err(checkFile(FOLDER, {}, 1, [{ kind: "content", to: id }]))!, /keeps no "content"/);
});

test("a shortcut opens an app or points at one file", () => {
  assert.equal(err(checkFile(SHORTCUT, { app: "files" }, 1, [])), null);
  assert.equal(err(checkFile(SHORTCUT, { app: null }, 1, [{ kind: "target", to: id.toUpperCase() }])), null);
  assert.match(err(checkFile(SHORTCUT, { app: null }, 1, []))!, /one of the two/);
  assert.match(err(checkFile(SHORTCUT, { app: "files" }, 1, [{ kind: "target", to: id }]))!, /one of the two/);
  assert.match(err(checkFile(SHORTCUT, { app: "Not An Id" }, 1, []))!, /app id/);
  assert.match(err(checkFile(SHORTCUT, { app: null }, 1, [{ kind: "target", to: "nope" }]))!, /UUID/);
  assert.match(err(checkFile(SHORTCUT, { app: null }, 1, [{ kind: "property", to: id }]))!, /keeps no "property"/);
  const c = checkFile(SHORTCUT, { app: null }, 1, [{ kind: "target", to: id.toUpperCase() }]);
  assert.deepEqual(c.ok && c.refs, [{ kind: "target", to: id, data: null }]);
});

test("a body is upgraded from the version it was written at, and a newer one is refused", () => {
  const up = checkFile(NOTE, { t: "hello" }, 2, null);
  assert.deepEqual(up.ok && [up.body, up.version], [{ text: "hello" }, 3]);
  assert.match(err(checkFile(NOTE, { t: "x" }, 1, null))!, /could not be upgraded/);
  assert.match(err(checkFile(NOTE, { text: "x" }, 4, null))!, /newer version/);
  assert.match(err(checkFile(NOTE, { text: "x" }, 1.5, null))!, /positive integer/);
  assert.match(err(checkFile(NOTE, { text: 5 }, 3, null))!, /text must be a string/);
});

test("bodies and reference data are bounded", () => {
  assert.match(err(checkFile(NOTE, { text: "x".repeat(MAX_BODY_BYTES) }, 3, null))!, /larger than/);
  assert.equal(err(checkFile(NOTE, { text: "x".repeat(MAX_BODY_BYTES - 100) }, 3, null)), null);
  assert.match(err(checkFile(NOTE, { text: "" }, 3, [{ kind: "content", to: id, data: { pad: "x".repeat(3000) } }]))!, /too large/);
  assert.match(err(checkFile(NOTE, { text: "" }, 3, Array.from({ length: 2001 }, () => ({ kind: "content", to: id }))))!, /at most/);
});

test("where a file may sit", () => {
  const folder = { type: "folder", fixed: null }, desktop = { type: "folder", fixed: "desktop" }, settings = { type: "folder", fixed: "settings" };
  assert.equal(placementError(FOLDER, null, "project"), null);
  assert.equal(placementError(FOLDER, folder, "home"), null);
  assert.equal(placementError(SHORTCUT, desktop, "project"), null);
  assert.match(placementError(SHORTCUT, null, "home")!, /belongs to a project/);
  assert.match(placementError(FOLDER, { type: "shortcut", fixed: null }, "project")!, /cannot contain files/);
  assert.equal(placementError(PHOTO, { type: "t-collection", fixed: null }, "project"), null);
  assert.match(placementError(FOLDER, { type: "t-collection", fixed: null }, "project")!, /holds only photos/);
  assert.match(placementError(COLLECTION, { type: "t-collection", fixed: null }, "project")!, /holds only photos/);
  assert.equal(placementError(DEFINITION, settings, "project"), null);
  assert.match(placementError(DEFINITION, null, "project")!, /lives in the Settings folder/);
  assert.match(placementError(DEFINITION, folder, "project")!, /lives in the Settings folder/);
  assert.match(placementError(FOLDER, settings, "project")!, /holds only .*properties/);
});

test("containers and types bound to a fixed folder are never internal files", () => {
  assert.equal(canBeInternal(NOTE), true);
  assert.equal(canBeInternal(FOLDER), false);
  assert.equal(canBeInternal(DEFINITION), false);
});

test("names and the bin's countdown", () => {
  assert.equal(nameError("Scene 4"), null);
  assert.match(nameError("   ")!, /non-empty/);
  assert.match(nameError("x".repeat(121))!, /longer/);
  const now = Date.parse("2026-11-24T12:00:00Z");
  assert.equal(binDaysLeft("2026-11-24T12:00:00Z", now), 30);
  assert.equal(binDaysLeft("2026-10-01T12:00:00Z", now), 0);
});

test("preferences: known keys with valid values, in an account home", async () => {
  const { PREFERENCES } = await import("./types.ts");
  const project = "8f9c2b1e-1a2b-4c3d-8e4f-5a6b7c8d9e0f";
  assert.equal(err(checkFile(PREFERENCES, {}, 1, null)), null);
  assert.equal(err(checkFile(PREFERENCES, { theme: "dark", taskbarEdge: "left", taskbarAlign: "center", binOnDesktop: false, pins: { [project]: [{ app: "files" }, { file: id }] }, icons: { [project]: { bin: { c: 3, r: 2 }, [id]: { c: 0, r: 0 } } } }, 1, null)), null);
  assert.match(err(checkFile(PREFERENCES, { theme: "sepia" }, 1, null))!, /theme is not valid/);
  assert.match(err(checkFile(PREFERENCES, { pins: { [project]: [{ app: "files", file: id }] } }, 1, null))!, /pins is not valid/);
  assert.match(err(checkFile(PREFERENCES, { icons: { [project]: { bin: { c: -1, r: 0 } } } }, 1, null))!, /icons is not valid/);
  assert.match(err(checkFile(PREFERENCES, { colour: "red" }, 1, null))!, /no "colour"/);
  // Flows and device cards (#426): light parameters hidden per model, keyframe panel fields hidden.
  assert.equal(err(checkFile(PREFERENCES, { lightParamsHidden: { "aputure-mc": ["power", "gm", "curve"] }, keyframeFieldsHidden: ["at", "intensity"] }, 1, null)), null);
  assert.match(err(checkFile(PREFERENCES, { lightParamsHidden: { "aputure-mc": ["brightness"] } }, 1, null))!, /lightParamsHidden is not valid/);
  assert.match(err(checkFile(PREFERENCES, { keyframeFieldsHidden: ["at", "at"] }, 1, null))!, /keyframeFieldsHidden is not valid/);
  assert.match(placementError(PREFERENCES, null, "project")!, /belongs to an account home/);
  assert.equal(placementError(PREFERENCES, null, "home"), null);
});

test("photos and collections", async () => {
  const { PHOTO, COLLECTION } = await import("./types.ts");
  assert.equal(err(checkFile(PHOTO, { exif: { Make: "FUJIFILM", FocalLength: 23, SubjectArea: [1, 2] }, readout: { make: "FUJIFILM", model: "X-T5" } }, 1, null)), null);
  assert.match(err(checkFile(PHOTO, { exif: { Nested: { a: 1 } }, readout: {} }, 1, null))!, /exif values/);
  assert.match(err(checkFile(PHOTO, { exif: {}, readout: { owner: "x" } }, 1, null))!, /readout holds/);
  assert.match(err(checkFile(PHOTO, { exif: {}, readout: {}, note: "x" }, 1, null))!, /no "note"/);
  assert.equal(PHOTO.made, "upload");
  assert.equal(err(checkFile(COLLECTION, COLLECTION.empty(), 1, null)), null);
  assert.equal(err(checkFile(COLLECTION, { color: "#12ab9F", order: "manual", manual: [id] }, 1, null)), null);
  assert.match(err(checkFile(COLLECTION, { color: 9, order: "time" }, 1, null))!, /color must be/);
  assert.match(err(checkFile(COLLECTION, { color: 2, order: "name" }, 1, null))!, /order must be/);
  const coll = { type: "collection", fixed: null };
  assert.equal(placementError(PHOTO, coll, "project"), null);
  assert.match(placementError(FOLDER, coll, "project")!, /holds only photos/);
  assert.match(placementError(COLLECTION, coll, "project")!, /holds only photos/);
  assert.equal(placementError(COLLECTION, { type: "folder", fixed: null }, "project"), null);
  assert.equal(canBeInternal(PHOTO), true);
});

test("devices", async () => {
  const { DEVICE } = await import("./types.ts");
  const ok = { kind: "phone", make: "Google", model: "Pixel 9", lenses: [{ id: "0", name: "1×", focal35: 25, zoom: 1 }, { id: "2", name: "0.5×", focal35: null, zoom: null }], screen: { portrait: { w: 412, h: 915 }, landscape: { w: 915, h: 412 } }, tabs: ["camera", "media"], app: "0.16.0" };
  assert.equal(err(checkFile(DEVICE, ok, 1, null)), null);
  assert.match(err(checkFile(DEVICE, { ...ok, kind: "watch" }, 1, null))!, /phone, tablet/);
  assert.match(err(checkFile(DEVICE, { ...ok, lenses: [{ id: "0", name: "1×", focal35: -1, zoom: 1 }] }, 1, null))!, /focal35/);
  assert.match(err(checkFile(DEVICE, { ...ok, tabs: ["Camera!"] }, 1, null))!, /app ids/);
  assert.equal(DEVICE.made, "register");
  assert.match(placementError(DEVICE, null, "project")!, /account home/);
});
