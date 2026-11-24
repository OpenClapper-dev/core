import { test } from "node:test";
import assert from "node:assert/strict";
import { photoAov } from "./photo.ts";

const near = (a: number, b: number, tol = 0.1) => assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);

test("from the 35 mm equivalent: a 3:2 picture at 50 mm is the textbook full-frame view", () => {
  const a = photoAov({ FocalLengthIn35mmFilm: 50 }, 6000, 4000)!;
  assert.equal(a.source, "exif-35mm");
  near(a.horizontal, 39.6);
  near(a.vertical, 27.0);
});

test("the equivalent is on the diagonal: a 4:3 phone picture at 24 mm, upright or on its side", () => {
  const land = photoAov({ FocalLengthIn35mmFilm: 24 }, 4000, 3000)!;
  near(land.horizontal, 71.6);
  near(land.vertical, 56.8);
  const port = photoAov({ FocalLengthIn35mmFilm: 24 }, 3000, 4000)!;
  near(port.horizontal, land.vertical);
  near(port.vertical, land.horizontal);
});

test("else from the focal length and the focal-plane resolution", () => {
  // A 36 mm wide sensor with 6000 px across: 6000 / 36 mm = 4233.3 px per inch.
  const a = photoAov({ FocalLength: 35, FocalPlaneXResolution: 4233.33, FocalPlaneYResolution: 4233.33, FocalPlaneResolutionUnit: 2 }, 6000, 4000)!;
  assert.equal(a.source, "exif-sensor");
  near(a.horizontal, 54.4);
  near(a.vertical, 37.8);
  // The same in centimetres.
  near(photoAov({ FocalLength: 35, FocalPlaneXResolution: 1666.67, FocalPlaneYResolution: 1666.67, FocalPlaneResolutionUnit: 3 }, 6000, 4000)!.horizontal, 54.4);
});

test("no usable tags, or a broken one: no angle of view", () => {
  assert.equal(photoAov({}, 4000, 3000), null);
  assert.equal(photoAov({ FocalLength: 35 }, 4000, 3000), null);
  assert.equal(photoAov({ FocalLengthIn35mmFilm: 0, FocalLength: "35" }, 4000, 3000), null);
  assert.equal(photoAov({ FocalLength: 35, FocalPlaneXResolution: 1, FocalPlaneYResolution: 1 }, 4000, 3000), null);
  assert.equal(photoAov({ FocalLengthIn35mmFilm: 24 }, 0, 3000), null);
});
