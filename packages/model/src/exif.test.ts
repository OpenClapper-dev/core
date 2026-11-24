import { test } from "node:test";
import assert from "node:assert/strict";
import { readExif, readoutOf, takenAt, uprightSize } from "./exif.ts";

/** A minimal JPEG with an Exif APP1: IFD0 (Make, Orientation, the EXIF IFD) and an EXIF IFD (FocalLength, FocalLengthIn35mmFilm, DateTimeOriginal, OffsetTimeOriginal). */
function sample(): Uint8Array {
  const entries0 = 3, entriesE = 4;
  const ifd0 = 8, ifdE = ifd0 + 2 + entries0 * 12 + 4, data = ifdE + 2 + entriesE * 12 + 4;
  const tiff = new Uint8Array(data + 64);
  const v = new DataView(tiff.buffer);
  tiff.set([0x49, 0x49, 0x2a, 0x00]); v.setUint32(4, ifd0, true);
  const entry = (at: number, tag: number, type: number, count: number, value: number) => { v.setUint16(at, tag, true); v.setUint16(at + 2, type, true); v.setUint32(at + 4, count, true); v.setUint32(at + 8, value, true); };
  v.setUint16(ifd0, entries0, true);
  entry(ifd0 + 2, 0x010f, 2, 4, 0); tiff.set([0x46, 0x75, 0x6a, 0x00], ifd0 + 2 + 8); // "Fuj"
  entry(ifd0 + 14, 0x0112, 3, 1, 6);
  entry(ifd0 + 26, 0x8769, 4, 1, ifdE);
  v.setUint16(ifdE, entriesE, true);
  entry(ifdE + 2, 0x920a, 5, 1, data); v.setUint32(data, 230, true); v.setUint32(data + 4, 10, true); // 23 mm
  entry(ifdE + 14, 0xa405, 3, 1, 35);
  entry(ifdE + 26, 0x9003, 2, 20, data + 8); tiff.set(new TextEncoder().encode("2026:11:02 09:30:00\0"), data + 8);
  entry(ifdE + 38, 0x9011, 2, 7, data + 28); tiff.set(new TextEncoder().encode("+01:00\0"), data + 28);
  const app1 = new Uint8Array([0xff, 0xe1, 0, 0, 0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]);
  new DataView(app1.buffer).setUint16(2, app1.length - 2);
  return new Uint8Array([0xff, 0xd8, ...app1, 0xff, 0xda, 0, 2]);
}

test("reads the tags by name, through the EXIF IFD", () => {
  const e = readExif(sample());
  assert.deepEqual(e, { Make: "Fuj", Orientation: 6, FocalLength: 23, FocalLengthIn35mmFilm: 35, DateTimeOriginal: "2026:11:02 09:30:00", OffsetTimeOriginal: "+01:00" });
  assert.equal(takenAt(e), "2026-11-02T08:30:00.000Z");
  assert.deepEqual(uprightSize(6000, 4000, e.Orientation), { width: 4000, height: 6000 });
});

test("broken or missing EXIF reads as nothing, never throws", () => {
  assert.deepEqual(readExif(new Uint8Array([1, 2, 3])), {});
  assert.doesNotThrow(() => readExif(sample().slice(0, 40)));
  assert.equal(takenAt({}), null);
  assert.equal(takenAt({ DateTimeOriginal: "0000:00:00 00:00:00" }), null);
});

test("the readout drops a make repeated in the model", () => {
  assert.deepEqual(readoutOf({ Make: "Canon", Model: "Canon EOS R5", LensModel: "RF24-70mm F2.8 L IS USM" }), { make: "Canon", model: "EOS R5", lens: "RF24-70mm F2.8 L IS USM" });
  assert.deepEqual(readoutOf({ Make: "FUJIFILM", Model: "X-T5" }), { make: "FUJIFILM", model: "X-T5" });
});
