import { test } from "node:test";
import assert from "node:assert/strict";
import { readExif, uprightSize } from "./exif.ts";

/** A minimal JPEG: SOI, an APP0 to skip, then APP1 Exif with IFD0 (Model, Orientation, Exif pointer) and an Exif IFD. */
function jpeg(le: boolean): Uint8Array {
  const t: number[] = [];
  const u16 = (v: number) => (le ? t.push(v & 0xff, v >> 8) : t.push(v >> 8, v & 0xff));
  const u32 = (v: number) => (le ? t.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, v >>> 24) : t.push(v >>> 24, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff));
  const model = "moto edge\0";
  // TIFF header
  t.push(...(le ? [0x49, 0x49] : [0x4d, 0x4d])); u16(42); u32(8);
  // IFD0 at 8: 3 entries -> 2 + 36 + 4 = 42 bytes, data after at 50
  u16(3);
  u16(0x0110); u16(2); u32(model.length); u32(50);
  u16(0x0112); u16(3); u32(1); u16(6); u16(0);
  u16(0x8769); u16(4); u32(1); u32(60);
  u32(0);
  while (t.length < 50) t.push(0);
  for (const ch of model) t.push(ch.charCodeAt(0));
  while (t.length < 60) t.push(0);
  // Exif IFD at 60: FocalLength (rational at 90), FocalLengthIn35mmFilm (short)
  u16(2);
  u16(0x920a); u16(5); u32(1); u32(90);
  u16(0xa405); u16(3); u32(1); u16(25); u16(0);
  u32(0);
  while (t.length < 90) t.push(0);
  u32(590); u32(100);
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...t];
  const len = app1.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xe1, len >> 8, len & 0xff, ...app1, 0xff, 0xda, 0, 2]);
}

test("reads model, orientation and focal lengths in both byte orders", () => {
  for (const le of [true, false]) {
    assert.deepEqual(readExif(jpeg(le)), { Model: "moto edge", Orientation: 6, FocalLength: 5.9, FocalLengthIn35mmFilm: 25 });
  }
});

test("anything that is not a JPEG with EXIF gives no tags", () => {
  assert.deepEqual(readExif(new Uint8Array([1, 2, 3])), {});
  assert.deepEqual(readExif(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2])), {});
});

test("a truncated file keeps what was read before the cut and does not throw", () => {
  const cut = readExif(jpeg(true).slice(0, 60));
  assert.equal(cut.FocalLengthIn35mmFilm, undefined);
});

test("orientations 5–8 swap width and height", () => {
  assert.deepEqual(uprightSize(4000, 3000, 6), { width: 3000, height: 4000 });
  assert.deepEqual(uprightSize(4000, 3000, 1), { width: 4000, height: 3000 });
  assert.deepEqual(uprightSize(4000, 3000, undefined), { width: 4000, height: 3000 });
});
