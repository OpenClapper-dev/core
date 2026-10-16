import { test } from "node:test";
import assert from "node:assert/strict";
import { validateDeviceSpecs, type DeviceSpecs } from "./devices.ts";

const ok: DeviceSpecs = {
  v: 1, model: "motorola edge 50 pro",
  viewport: { portrait: { width: 412, height: 851 }, landscape: null },
  zoom: { min: 0.5, max: 30 }, stops: [0.5, 1, 2, 3, 5, 10], mainEquivalentMm: 25, calibration: "auto",
};

test("specs as the phone sends them pass", () => {
  assert.equal(validateDeviceSpecs(ok), null);
  assert.equal(validateDeviceSpecs({ ...ok, model: null, zoom: null, stops: [1] }), null);
});

test("odd specs are rejected with the field named", () => {
  assert.match(validateDeviceSpecs({ ...ok, v: 2 }) ?? "", /specs\.v/);
  assert.match(validateDeviceSpecs({ ...ok, viewport: { portrait: { width: 10, height: 800 }, landscape: null } }) ?? "", /viewport\.portrait/);
  assert.match(validateDeviceSpecs({ ...ok, zoom: { min: 3, max: 1 } }) ?? "", /specs\.zoom/);
  assert.match(validateDeviceSpecs({ ...ok, stops: [0] }) ?? "", /specs\.stops/);
  assert.match(validateDeviceSpecs({ ...ok, mainEquivalentMm: 1 }) ?? "", /mainEquivalentMm/);
  assert.match(validateDeviceSpecs({ ...ok, calibration: "x" }) ?? "", /calibration/);
  assert.match(validateDeviceSpecs(null) ?? "", /object/);
});
