import { test } from "node:test";
import assert from "node:assert/strict";
import { calibrationFromExif } from "./calibration.ts";

test("the 35 mm equivalent comes from EXIF when it is plausible", () => {
  assert.deepEqual(calibrationFromExif({ FocalLengthIn35mmFilm: 25, Model: "motorola edge 50 pro" }), { mm: 25, model: "motorola edge 50 pro" });
  assert.deepEqual(calibrationFromExif({ FocalLengthIn35mmFilm: "24" }), { mm: 24, model: null });
  assert.equal(calibrationFromExif({ FocalLengthIn35mmFilm: 0 }), null);
  assert.equal(calibrationFromExif({ FocalLength: 5.9 }), null);
  assert.equal(calibrationFromExif(null), null);
});
