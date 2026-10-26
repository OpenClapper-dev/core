import { test } from "node:test";
import assert from "node:assert/strict";
import { computeOverlay, previewBox } from "./framing.ts";
import { DEFAULT_SETTINGS } from "./defaults.ts";

const near = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);
const ff = { id: "p", name: "FF", sensorWidthMm: 36, sensorHeightMm: 24, speedboosterFactor: 1, vignetting: [], createdAt: "", synced: true };

test("previewBox: portrait window gets a 3:4 box limited by width", () => {
  const b = previewBox({ width: 1080, height: 2400 });
  near(b.width, 1080); near(b.height, 1440);
});
test("previewBox: landscape window gets a 4:3 box limited by height", () => {
  const b = previewBox({ width: 2400, height: 1080 });
  near(b.height, 1080); near(b.width, 1440);
});
test("overlay is centred and landscape rig in portrait preview is wider than tall", () => {
  const preview = previewBox({ width: 1080, height: 2400 });
  const o = computeOverlay({ ...DEFAULT_SETTINGS, rigOrientation: "landscape" }, ff, 50, preview);
  assert.ok(o.rect.width > o.rect.height);
  near(o.rect.left + o.rect.width / 2, preview.width / 2);
  near(o.rect.top + o.rect.height / 2, preview.height / 2);
  assert.equal(o.exceedsPreview, false);
});
test("portrait rig swaps axes; very wide lens flags clipping", () => {
  const preview = previewBox({ width: 1080, height: 2400 });
  const land = computeOverlay(DEFAULT_SETTINGS, ff, 50, preview);
  const port = computeOverlay({ ...DEFAULT_SETTINGS, rigOrientation: "portrait" }, ff, 50, preview);
  assert.ok(port.rect.height > port.rect.width);
  // Rig hfov now spans the screen's vertical axis, scaled against the phone's vertical FOV.
  const rad = Math.PI / 180;
  const expected = Math.tan((land.framing.fov.horizontal / 2) * rad) / Math.tan((port.phoneFov.verticalFovDeg / 2) * rad);
  near(port.rect.height / preview.height, expected);
  const wide = computeOverlay(DEFAULT_SETTINGS, ff, 12, preview);
  assert.equal(wide.exceedsPreview, true);
  // Rig frame fills the limiting axis exactly; camera image is shrunk inside it, centred.
  near(Math.max(wide.rect.width / preview.width, wide.rect.height / preview.height), 1);
  assert.ok(wide.camera.width < preview.width && wide.camera.height < preview.height);
  near(wide.camera.left + wide.camera.width / 2, preview.width / 2);
  // Not exceeding: camera image is the whole box.
  const n = computeOverlay(DEFAULT_SETTINGS, ff, 50, preview);
  near(n.camera.width, preview.width); near(n.camera.left, 0);
});

test("fit mode magnifies until the frame fills the limiting axis", () => {
  const preview = previewBox({ width: 1080, height: 2400 });
  const fit = computeOverlay({ ...DEFAULT_SETTINGS, fitToFrame: true }, ff, 85, preview);
  near(Math.max(fit.rect.width / preview.width, fit.rect.height / preview.height), 1);
  assert.ok(fit.camera.width > preview.width); // magnified beyond the box, clipped by overflow
  near(fit.camera.left + fit.camera.width / 2, preview.width / 2);
  assert.equal(fit.exceedsPreview, false);
});

test("human view: wider rig nests the human frame inside; narrower rig puts it outside", () => {
  const preview = previewBox({ width: 2400, height: 1080 });
  const settings = { ...DEFAULT_SETTINGS, humanViewEnabled: true, humanViewFocalMm: 50 };
  // 24 mm on FF = 24 mm-eq: wider than the 50 mm human reference.
  const wide = computeOverlay(settings, ff, 24, preview);
  assert.ok(wide.human);
  assert.equal(wide.human!.relation, "wider");
  assert.ok(wide.human!.rect.width < wide.rect.width && wide.human!.rect.height < wide.rect.height);
  assert.equal(wide.human!.fits, true);
  near(wide.human!.rect.left + wide.human!.rect.width / 2, preview.width / 2);
  // 100 mm on FF: narrower than human; the human frame is larger than the rig frame but still fits (phone is 25 mm-eq).
  const tele = computeOverlay(settings, ff, 100, preview);
  assert.equal(tele.human!.relation, "narrower");
  assert.ok(tele.human!.rect.width > tele.rect.width);
  assert.equal(tele.human!.fits, true);
  // With fit zoom the rig frame fills the box, so the (larger) human frame no longer fits.
  const fit = computeOverlay({ ...settings, fitToFrame: true }, ff, 100, preview);
  assert.equal(fit.human!.fits, false);
  // 50 mm on FF equals the reference exactly.
  assert.equal(computeOverlay(settings, ff, 50, preview).human!.relation, "equal");
  // A cropped sensor with a booster: the human frame still corresponds to 50 mm-eq. Equal FF-equivalent
  // means equal diagonal field of view, so the on-screen diagonals match (widths differ with the aspect ratio).
  const p4k = { ...ff, sensorWidthMm: 18.96, sensorHeightMm: 10, speedboosterFactor: 0.64 };
  const o = computeOverlay(settings, p4k, 24, preview); // 31 mm-eq: inside the phone view, wider than 50
  assert.equal(o.human!.relation, "wider");
  const ffHuman = computeOverlay(settings, ff, 50, preview);
  near(Math.hypot(o.human!.rect.width, o.human!.rect.height), Math.hypot(ffHuman.rect.width, ffHuman.rect.height), 1e-6);
  assert.equal(computeOverlay({ ...settings, humanViewEnabled: false }, ff, 50, preview).human, null);
});
