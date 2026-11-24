import { test } from "node:test";
import assert from "node:assert/strict";
import { lensSet, zoomName, type CamLike } from "./lenses.ts";

const cam = (p: Partial<CamLike> & { id: string }): CamLike => ({ position: "back", type: "wide-angle", isVirtualDevice: false, physicalDevices: [], zoomLensSwitchFactors: [], minZoom: 1, maxZoom: 10, hasTorch: true, ...p });

test("zoom names", () => {
  assert.equal(zoomName(0.5), "0.5×");
  assert.equal(zoomName(1), "1×");
  assert.equal(zoomName(4.96), "5×");
  assert.equal(zoomName(12.4), "12×");
});

test("a logical camera with switch factors: the factors place the lenses", () => {
  const uw = cam({ id: "2", type: "ultra-wide-angle", focalLength: 13 });
  const w = cam({ id: "3", focalLength: 24 });
  const t = cam({ id: "4", type: "telephoto", focalLength: 120 });
  const set = lensSet([cam({ id: "0", type: "triple", isVirtualDevice: true, physicalDevices: [t, w, uw], zoomLensSwitchFactors: [5, 1], minZoom: 0.5, maxZoom: 30 }), cam({ id: "1", position: "front" })]);
  assert.deepEqual(set.lenses.map((l) => [l.name, l.focal35, l.zoom, l.camera, l.main]), [["0.5×", 13, 0.5, "0", false], ["1×", 24, 1, "0", true], ["5×", 120, 5, "0", false]]);
});

test("a logical camera without switch factors: focal ratios to the main lens", () => {
  const set = lensSet([cam({ id: "0", type: "dual-wide", isVirtualDevice: true, physicalDevices: [cam({ id: "a", focalLength: 26 }), cam({ id: "b", type: "ultra-wide-angle", focalLength: 13 })], minZoom: 0.5 })]);
  assert.deepEqual(set.lenses.map((l) => [l.name, l.zoom]), [["0.5×", 0.5], ["1×", 1]]);
});

test("a lens without a focal length and without factors is left out, the main lens stays", () => {
  const set = lensSet([cam({ id: "0", type: "dual", isVirtualDevice: true, physicalDevices: [cam({ id: "a" }), cam({ id: "b", type: "telephoto" })] })]);
  assert.deepEqual(set.lenses.map((l) => [l.name, l.focal35, l.main]), [["1×", null, true]]);
});

test("separate back cameras are opened one by one", () => {
  const set = lensSet([cam({ id: "0", focalLength: 24 }), cam({ id: "2", type: "ultra-wide-angle", focalLength: 12 }), cam({ id: "1", position: "front" })]);
  assert.deepEqual(set.lenses.map((l) => [l.name, l.camera, l.zoom, l.cameraZoom]), [["0.5×", "2", null, 1], ["1×", "0", null, 1]]);
});

test("one back camera: the main lens only", () => {
  const set = lensSet([cam({ id: "0", focalLength: 25.4, hasTorch: false })]);
  assert.deepEqual(set.lenses.map((l) => [l.name, l.focal35, l.main]), [["1×", 25.4, true]]);
  assert.equal(set.torch, false);
});

test("no back camera: no lenses", () => {
  assert.deepEqual(lensSet([cam({ id: "1", position: "front" })]).lenses, []);
});
