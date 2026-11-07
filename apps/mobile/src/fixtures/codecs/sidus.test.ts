import { test } from "node:test";
import assert from "node:assert/strict";
import { cct, hsi, intensity, parseStatus, power, statusRequest } from "./sidus.ts";

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const ofHex = (s: string) => Uint8Array.from(s.match(/../g)!, (h) => parseInt(h, 16));

// Produced by the reference encoder (wesbos/amaran-BLE-control telink.ts), verified on amaran lights.
test("commands, byte for byte", () => {
  assert.equal(hex(statusRequest()), "0e00000000000000000e");
  assert.equal(hex(power(true)), "8d00000000000000018c");
  assert.equal(hex(power(false)), "8c00000000000000008c");
  assert.equal(hex(intensity(0)), "8f00000000000000008f");
  assert.equal(hex(intensity(0.5)), "0c000000000000007d8f");
  assert.equal(hex(intensity(1)), "8900000000000000fa8f");
  assert.equal(hex(intensity(0.333)), "2200000000000040538f");
  assert.equal(hex(cct(3200, 0.5, 0)), "54000000004001147d82");
  assert.equal(hex(cct(5600, 1, -10)), "9f00000000000023fa82");
  assert.equal(hex(cct(6500, 0.007, 10)), "8d0000000080a2e80182");
  assert.equal(hex(cct(4300, 0.25, 3)), "db00000000a0e19a3e82");
  assert.equal(hex(hsi(0, 1, 1)), "9400000000001900fa81");
  assert.equal(hex(hsi(240, 0.5, 0.3)), "7600000000800c1e4b81");
  assert.equal(hex(hsi(359, 0.01, 0.001)), "0d0000000040e06c0081");
});

test("status reports decode back to what was set", () => {
  assert.deepEqual(parseStatus(ofHex("db00000000a0e19a3e82")), { on: false, intensity: 0.25, mode: "cct", kelvin: 4300, gm: 3 });
  assert.deepEqual(parseStatus(ofHex("7600000000800c1e4b81")), { on: false, intensity: 0.3, mode: "hsi", hue: 240, saturation: 0.5 });
  // Power is bit 8; a light that is on.
  const lit = cct(5600, 1, -10);
  lit[1] |= 1;
  lit[0] = (lit[0] + 1) & 0xff;
  assert.equal(parseStatus(lit)?.on, true);
  assert.equal(parseStatus(ofHex("db00000000a0e19a3e83")), null);
  assert.equal(parseStatus(statusRequest()), null);
});

test("above 10 000 K the offset form round-trips; inputs are clamped", () => {
  assert.equal(parseStatus(cct(12_000, 1))?.kelvin, 12_000);
  assert.equal(parseStatus(cct(500, 2))?.kelvin, 800);
  assert.equal(parseStatus(cct(5600, 2))?.intensity, 1);
});
