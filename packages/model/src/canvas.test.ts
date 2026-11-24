import { test } from "node:test";
import assert from "node:assert/strict";
import { canvasError, canvasRefs, emptyCanvas, focalsOf, presetChangeError, presetError, remapCanvas, type CanvasBody, type PresetBody } from "./canvas.ts";

const P = "0b8e5e3e-6f3a-4c1e-9a2b-1c2d3e4f5a6b", Q = "0b8e5e3e-6f3a-4c1e-9a2b-1c2d3e4f5a6c";
const obj = (more: Record<string, unknown> = {}) => ({ id: "o1", kind: "rect", name: "Box", x: 0.1, y: 0.1, w: 0.2, h: 0.2, stroke: 1, width: 2, opacity: 1, visible: true, locked: false, ...more });
const asBody = (b: CanvasBody) => b as unknown as Record<string, unknown>;

test("an empty canvas is valid", () => {
  assert.equal(canvasError(asBody(emptyCanvas()), []), null);
});

test("frames only on a photo; the picture is one of them; references match the surface and the placed pictures", () => {
  const blank = { ...emptyCanvas(), frames: [{ id: "f1", name: "24", color: 1, kind: "aspect", aspect: 2.39, size: 0.8, portrait: false, cx: 0.5, cy: 0.5, visible: true }] };
  assert.match(canvasError(asBody(blank as CanvasBody), [])!, /only a canvas with a base photo/);
  const photo = { ...blank, surface: { kind: "photo" } as const, picture: "f1" } as CanvasBody;
  assert.equal(canvasError(asBody(photo), [{ kind: "base", to: P }]), null);
  assert.match(canvasError(asBody(photo), [])!, /one base reference/);
  assert.match(canvasError(asBody({ ...photo, picture: "nope" }), [{ kind: "base", to: P }])!, /picture/);
  const withPic = { ...emptyCanvas(), objects: [obj({ kind: "picture", photo: Q })] } as unknown as CanvasBody;
  assert.match(canvasError(asBody(withPic), [])!, /placed reference/);
  assert.equal(canvasError(asBody(withPic), canvasRefs(withPic, null)), null);
});

test("objects are checked: ids, kinds, groups, pens, looks", () => {
  const b = (objects: unknown[]) => canvasError({ ...asBody(emptyCanvas()), objects }, []);
  assert.match(b([obj(), obj()])!, /own id/);
  assert.match(b([obj({ kind: "blob" })])!, /kind/);
  assert.match(b([obj({ group: "g1" })])!, /group that is not there/);
  assert.equal(b([obj({ id: "g1", kind: "group" }), obj({ id: "o2", group: "g1" })]), null);
  assert.match(b([obj({ kind: "pen", pts: [0, 0, 1] })])!, /pairs/);
  assert.match(b([obj({ look: { exposure: 0, contrast: 0, saturation: 0 } })])!, /only a placed picture/);
});

test("a copy's placed pictures follow the copied photos", () => {
  const b = { ...emptyCanvas(), objects: [obj({ kind: "picture", photo: P })] };
  const out = remapCanvas(asBody(b as unknown as CanvasBody), new Map([[P, Q]])) as unknown as CanvasBody;
  assert.equal(out.objects[0].photo, Q);
});

const preset: PresetBody = { format: [36, 24], formatName: "Full frame (135)", multiplier: 1, squeeze: 1, delivery: null, lenses: { kind: "primes", primes: [24, 35, 50] }, archived: false };

test("presets: valid shapes, focal lengths", () => {
  assert.equal(presetError(preset as unknown as Record<string, unknown>), null);
  assert.match(presetError({ ...preset, lenses: { kind: "zoom", from: 35, to: 18 } } as unknown as Record<string, unknown>)!, /shorter to a longer/);
  assert.match(presetError({ ...preset, lenses: { kind: "primes", primes: [24, 24] } } as unknown as Record<string, unknown>)!, /twice/);
  assert.deepEqual(focalsOf({ kind: "zoom", from: 18, to: 21 }), [18, 19, 20, 21]);
});

test("presets change additively only", () => {
  assert.equal(presetChangeError(preset, { ...preset, lenses: { kind: "primes", primes: [24, 35, 50, 85] } }, [35]), null);
  assert.equal(presetChangeError(preset, { ...preset, archived: true }, [35]), null);
  assert.match(presetChangeError(preset, { ...preset, lenses: { kind: "primes", primes: [24, 50] } }, [35])!, /35 mm is used/);
  assert.equal(presetChangeError(preset, { ...preset, lenses: { kind: "primes", primes: [24, 35] } }, [35]), null);
  assert.match(presetChangeError(preset, { ...preset, squeeze: 2 }, [])!, /cannot change/);
  assert.match(presetChangeError(preset, { ...preset, format: [24.89, 18.66], formatName: null }, [])!, /format/);
  const zoom: PresetBody = { ...preset, lenses: { kind: "zoom", from: 18, to: 35 } };
  assert.equal(presetChangeError(zoom, { ...zoom, lenses: { kind: "zoom", from: 16, to: 50 } }, [18, 35]), null);
  assert.match(presetChangeError(zoom, { ...zoom, lenses: { kind: "zoom", from: 20, to: 35 } }, [18])!, /18 mm/);
});
