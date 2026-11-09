import { strict as assert } from "node:assert";
import { test } from "node:test";
import { decodeCcu, encodeCcu, timecodeOf } from "./cameraControl.ts";

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(" ");

test("the documentation's examples, byte for byte", () => {
  // Trigger instant autofocus on camera 4.
  assert.equal(hex(encodeCcu({ category: 0, parameter: 1, type: 0, operation: 0, data: [] }, 4)), "04 04 00 00 00 01 00 00");
  // Exposure (shutter) 10 ms on camera 4.
  assert.equal(hex(encodeCcu({ category: 1, parameter: 5, type: 3, operation: 0, data: [10000] }, 4)), "04 08 00 00 01 05 03 00 10 27 00 00");
  // Zebra level +0.15 (fixed16) on camera 4.
  assert.equal(hex(encodeCcu({ category: 4, parameter: 2, type: 128, operation: 1, data: [0.15] }, 4)), "04 06 00 00 04 02 80 01 33 01 00 00");
});

test("decode: several messages back to back, types, strings, and back", () => {
  const a = encodeCcu({ category: 1, parameter: 14, type: 3, operation: 0, data: [800] });
  const b = encodeCcu({ category: 12, parameter: 2, type: 5, operation: 0, data: "12A" });
  const c = encodeCcu({ category: 1, parameter: 2, type: 2, operation: 0, data: [5600, -10] });
  const all = Uint8Array.from([...a, ...b, ...c]);
  assert.deepEqual(decodeCcu(all), [
    { category: 1, parameter: 14, type: 3, operation: 0, data: [800] },
    { category: 12, parameter: 2, type: 5, operation: 0, data: "12A" },
    { category: 1, parameter: 2, type: 2, operation: 0, data: [5600, -10] },
  ]);
  assert.deepEqual(decodeCcu(encodeCcu({ category: 4, parameter: 1, type: 2, operation: 0, data: [4, 2] }))[0].data, [4, 2]);
  assert.deepEqual(decodeCcu(Uint8Array.from([255, 40, 0, 0])), []);
});

test("timecode is BCD, little-endian", () => {
  assert.equal(timecodeOf(Uint8Array.from([0x10, 0x53, 0x12, 0x09])), "09:12:53:10");
});
