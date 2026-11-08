import { test } from "node:test";
import assert from "node:assert/strict";
import { toHex } from "../bytes.ts";
import { effectFrame, frame, helloFrames, macBytes, modelOf, parseNotice, parseState, powerFrame, smoothFrame, whiteFrame } from "./neewer.ts";

// A made-up address; the layout and checksums were checked against a capture of the NEEWER app (#207).
const MAC = "A1:B2:C3:D4:E5:F6";

test("power", () => {
  assert.equal(toHex(powerFrame(MAC, true)), "78 8d 08 a1 b2 c3 d4 e5 f6 81 01 54");
  assert.equal(toHex(powerFrame(MAC, false)), "78 8d 08 a1 b2 c3 d4 e5 f6 81 02 55");
});

test("intensity, white and curve in one frame", () => {
  // 50 %, 6500 K, neutral, linear: as the app sends after a drag to 50.
  assert.equal(toHex(whiteFrame(MAC, { intensity: 0.5, kelvin: 6500, curve: "linear" })), "78 90 0c a1 b2 c3 d4 e5 f6 87 32 41 32 04 00 09");
  const f = whiteFrame(MAC, { intensity: 0.1, kelvin: 2700, curve: "exp" });
  assert.deepEqual(Array.from(f.subarray(9, 15)), [0x87, 10, 27, 50, 1, 0]);
  assert.equal(whiteFrame(MAC, { intensity: 1, kelvin: 4500, curve: "s" })[13], 3);
  assert.equal(whiteFrame(MAC, { intensity: 1, kelvin: 4500, curve: "log" })[13], 2);
});

test("values are clamped and rounded", () => {
  const f = whiteFrame(MAC, { intensity: 1.7, kelvin: 4449, curve: "linear", gm: 99 });
  assert.deepEqual([f[10], f[11], f[12]], [100, 44, 100]);
  assert.equal(whiteFrame(MAC, { intensity: -1, kelvin: 2700, curve: "linear" })[10], 0);
});

test("the frame layout: length counts MAC + payload, checksum is the byte sum", () => {
  const f = frame(0x95, MAC, []);
  assert.equal(f[2], 6);
  assert.equal(f.length, 10);
  assert.equal(f[9], Array.from(f.subarray(0, 9)).reduce((a, b) => a + b, 0) & 0xff);
  assert.equal(helloFrames(MAC).length, 6);
  assert.throws(() => macBytes("A1:B2"));
});

test("notifications: the info reply carries the model name", () => {
  const body = [0x78, 0x08, 0x12, ...macBytes(MAC), 0x01, 0x0a, 0x01, 0x29, 0x0f, 0x02, ...Buffer.from("FS150B")];
  const sum = body.reduce((a, b) => a + b, 0) & 0xff;
  const n = parseNotice(Uint8Array.from([...body, sum]))!;
  assert.equal(n.ok, true);
  assert.equal(n.address, MAC);
  assert.equal(modelOf(n), "FS150B");
  assert.equal(parseNotice(Uint8Array.of(0x42, 0x66)), null);
  assert.equal(modelOf(parseNotice(powerFrame(MAC, true))!), null);
});

test("effects (#206): tag 91, subtag 8B, the effect id, then its fields as NEEWER 5.8.0 lays them out", () => {
  // Flash at 50 %, 5600 K, speed 5: the example from the app's code.
  const flash = effectFrame(MAC, "nw_flash", 0.5, { kelvin: 5600, frequency: 5 });
  assert.equal(toHex(flash.subarray(0, 3)), "78 91 0b");
  assert.equal(toHex(flash.subarray(9, 14)), "8b 01 32 38 05");
  assert.equal(flash[14], flash.subarray(0, 14).reduce((a, b) => a + b, 0) & 0xff);
  // Candle: intensity range, white, G/M 50, speed, sparks; white clamped to the light's 2700 K.
  const candle = effectFrame(MAC, "nw_candle", 1, { intensityMin: 0.1, intensityMax: 0.8, kelvin: 2000, frequency: 3, ember: 7 });
  assert.equal(toHex(candle.subarray(9, 17)), "8b 0b 0a 50 1b 32 03 07");
  // White loop: the light's intensity, a white range, speed.
  assert.equal(toHex(effectFrame(MAC, "nw_cct_loop", 0.4, { kelvin: 3200, kelvinMax: 5600, frequency: 10 }).subarray(9, 15)), "8b 0d 28 20 38 0a");
  assert.throws(() => effectFrame(MAC, "fire", 1, {}));
});

test("smooth or instant changes: D3 00 or D3 01", () => {
  assert.equal(toHex(smoothFrame(MAC, true).subarray(0, 10)), "78 d3 07 a1 b2 c3 d4 e5 f6 00");
  assert.equal(smoothFrame(MAC, false)[9], 1);
});

test("state reply (tag 04): power, then white or an effect", () => {
  const white = parseNotice(frame(0x04, MAC, [0x00, 0x01, 0x01, 75, 32, 60, 3, 0]));
  assert.deepEqual(white && parseState(white), { power: true, intensity: 0.75, kelvin: 3200, gm: 10, curve: "s", effect: null });
  const fx = parseNotice(frame(0x04, MAC, [0x00, 0x02, 0x03, 11, 10, 80, 27, 50, 3, 7]));
  assert.deepEqual(fx && parseState(fx), { power: false, effect: "nw_candle" });
});
