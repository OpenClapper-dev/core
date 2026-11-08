import { test } from "node:test";
import assert from "node:assert/strict";
import { EFFECTS } from "@openclapper/vocab";
import { batteryRequest, cct, curve, effect, effectOff, hsi, intensity, parseBattery, parseEffect, parseStatus, power, programFade, statusRequest } from "./sidus.ts";

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

test("battery page: request, and a report decoded field by field", () => {
  assert.equal(hex(batteryRequest()), "0a00000000000000000a");
  // 300 min (0x12c: byte 3 = 0x2c, bit 0 of byte 4 = 1), 77 % (bits 1-7), 7.400 V, no external supply.
  const p = Uint8Array.of(0, 0, 0, 0x2c, (77 << 1) | 1, 0xe8, 0x1c, 0, 0, 0x0a);
  p[0] = p.slice(1).reduce((a, b) => a + b, 0) & 0xff;
  assert.deepEqual(parseBattery(p), { minutesLeft: 300, charge: 77, volts: 7.4, plugged: false });
  // On a 15 V supply.
  const q = Uint8Array.from(p);
  q[7] = 0x98; q[8] = 0x3a;
  q[0] = q.slice(1).reduce((a, b) => a + b, 0) & 0xff;
  assert.equal(parseBattery(q)?.plugged, true);
  assert.equal(parseBattery(cct(5600, 1)), null);
});

// The reference's first-generation table (neyako/amaran-hacs effects.py) as 80-bit values, to check
// our byte packing against an independent BigInt computation: [code, defaults, intensity bit].
const REF: Record<string, [number, bigint, number]> = {
  club_lights: [0, 5n << 50n, 54], paparazzi: [1, (10n << 33n) | (560n << 40n) | (5n << 50n), 54],
  lightning: [2, (5n << 27n) | (2n << 31n) | (10n << 33n) | (560n << 40n) | (5n << 50n), 54],
  tv: [3, 5n << 50n, 54], candle: [4, 5n << 50n, 54], fire: [5, 5n << 50n, 54],
  strobe: [6, (2n << 28n) | (100n << 30n) | (5n << 56n) | (1n << 60n), 46],
  explosion: [7, (1n << 28n) | (100n << 30n) | (5n << 56n) | (1n << 60n), 46],
  faulty_bulb: [8, (5n << 24n) | (2n << 28n) | (100n << 30n) | (5n << 56n) | (1n << 60n), 46],
  pulsing: [9, (5n << 24n) | (2n << 28n) | (100n << 30n) | (5n << 56n) | (1n << 60n), 46],
  welding: [10, (18n << 21n) | (2n << 28n) | (100n << 30n) | (5n << 56n) | (1n << 60n), 46],
  cop_car: [11, (2n << 46n) | (5n << 50n), 54], color_chase: [12, (100n << 43n) | (5n << 50n), 54],
  party_lights: [13, (100n << 43n) | (5n << 50n), 54], fireworks: [14, 5n << 50n, 54],
};
function reference(id: string, i1000: number): string {
  const [code, defaults, bit] = REF[id];
  const v = (0x87n << 72n) | (BigInt(code) << 64n) | defaults | (1n << 8n) | (BigInt(i1000) << BigInt(bit));
  const b = Array.from({ length: 10 }, (_, k) => Number((v >> BigInt(k * 8)) & 0xffn));
  b[0] = b.slice(1).reduce((a, x) => a + x, 0) & 0xff;
  return b.map((x) => x.toString(16).padStart(2, "0")).join("");
}

test("effects: all 15 match the reference table, decode back, and stop as the reference's packet", () => {
  // The MC's own first-generation set; NEEWER's (nw_…) are its own codec's.
  const MC = EFFECTS.filter((e) => !e.id.startsWith("nw_"));
  assert.equal(MC.length, 15);
  for (const { id } of MC) {
    for (const [i, i1000] of [[1, 1000], [0.5, 500], [0.05, 50]] as const) {
      assert.equal(hex(effect(id, i)), reference(id, i1000), `${id} at ${i1000}`);
      const back = parseEffect(effect(id, i))!;
      assert.deepEqual({ effect: back.effect, on: back.on, intensity: back.intensity }, { effect: id, on: true, intensity: i }, id);
    }
  }
  // The reference test's own checks: Candle's code and command, intensity at bit 54; the stop packet.
  const candle = effect("candle", 1);
  assert.deepEqual([candle[8], candle[9]], [4, 0x87]);
  assert.equal(hex(effectOff()), "96000000000000000f87");
  assert.deepEqual(parseEffect(effectOff()), { effect: null, on: false, intensity: 0 });
  assert.equal(parseEffect(cct(5600, 1)), null);
});

test("dimming curve: its own command, the value in byte 8, as Sidus Link 2.0.42 sends it", () => {
  assert.equal(hex(curve("linear")), "88000000000000000088");
  assert.equal(hex(curve("exp")), "89000000000000000188");
  assert.equal(hex(curve("log")), "8a000000000000000288");
  assert.equal(hex(curve("s")), "8b000000000000000388");
});

test("Faulty bulb and Pulsing options: the defaults are the reference preset, white and colour round-trip", () => {
  // Without options, and with the default options, they send the reference table's preset (checked above).
  for (const id of ["faulty_bulb", "pulsing"] as const) {
    assert.equal(hex(effect(id, 0.5, { frequency: 5, speed: 5, color: { h: 0, s: 1 } })), reference(id, 500));
  }
  // White, 3200 K, frequency 3, speed 8: fields at the Sidus Link 2.0.42 positions.
  const w = effect("faulty_bulb", 0.4, { frequency: 3, speed: 8, color: { kelvin: 3200 } });
  assert.deepEqual(parseEffect(w), { effect: "faulty_bulb", on: true, intensity: 0.4, settings: { frequency: 3, speed: 8, color: { kelvin: 3200 } } });
  // Colour, hue 200, saturation 60 %, random frequency and speed (11).
  const c = effect("pulsing", 1, { frequency: 11, speed: 11, color: { h: 200, s: 0.6 } });
  assert.deepEqual(parseEffect(c)?.settings, { frequency: 11, speed: 11, color: { h: 200, s: 0.6 } });
  // Out of range is clamped: 0 → 1, 15 → 11.
  assert.equal(parseEffect(effect("faulty_bulb", 1, { frequency: 0, speed: 15, color: { kelvin: 5600 } }))?.settings?.frequency, 1);
});

test("the other MC effects' options round-trip at the app's positions (#300)", () => {
  const cases: [Parameters<typeof effect>[0], NonNullable<Parameters<typeof effect>[2]>][] = [
    ["paparazzi", { kelvin: 3200, frequency: 9 }],
    ["lightning", { kelvin: 6500, frequency: 11, speed: 2 }],
    ["tv", { choice: 2, frequency: 7 }],
    ["fire", { choice: 1, frequency: 11 }],
    ["cop_car", { choice: 4, frequency: 8 }],
    ["party_lights", { saturation: 0.3, frequency: 3 }],
    ["fireworks", { choice: 2, frequency: 10 }],
  ];
  for (const [id, o] of cases) assert.deepEqual(parseEffect(effect(id, 0.7, o)), { effect: id, on: true, intensity: 0.7, settings: o }, id);
  // Ranges: Paparazzi and Cop car stop at 10, choices at their last value.
  assert.equal(parseEffect(effect("paparazzi", 1, { frequency: 11 }))?.settings?.frequency, 10);
  assert.equal(parseEffect(effect("cop_car", 1, { choice: 9 }))?.settings?.choice, 4);
});

test("Lightning: trigger 1 strikes once, 2 is the automatic pattern", () => {
  const auto = effect("lightning", 1);
  const strike = effect("lightning", 1, undefined, true);
  const field = (p: Uint8Array) => ((p[3] >> 7) & 1) | ((p[4] & 1) << 1); // bits 31-32
  assert.deepEqual([field(auto), field(strike)], [2, 1]);
});

/**
 * Sidus Link's packer, ported from its BinaryKit: each field MSB-first, reversed, concatenated;
 * bit k lands in byte k >> 3 at bit k & 7; byte 0 is the sum of the others.
 */
function sidusPack(fields: [number, number][]): Uint8Array {
  const bits = fields.map(([v, n]) => (v | (1 << n)).toString(2).slice(1).split("").reverse().join("")).join("");
  const p = new Uint8Array(10);
  for (let k = 0; k < 80; k++) if (bits[k] === "1") p[k >> 3] |= 1 << (k & 7);
  p[0] = (p[1] + p[2] + p[3] + p[4] + p[5] + p[6] + p[7] + p[8] + p[9]) & 0xff;
  return p;
}

test("program continue (native fade, #289) matches Sidus Link's ProgramContinueProtocol", () => {
  // White: lightType 0, fade-out linear 0 s, hold for ever, fade-in S over 5 s, G/M neutral, 5600 K, 80 %.
  const white = sidusPack([[0, 8], [0, 1], [0, 3], [0, 8], [1023, 10], [3, 3], [50, 8], [10, 6], [560, 10], [800, 10], [0, 2], [0, 3], [21, 7], [1, 1]]);
  assert.deepEqual(programFade({ intensity: 0.8, fadeInMs: 5000, curve: "s", white: { kelvin: 5600, gm: 0 } }), white);
  // Colour: hue 240, saturation 70 %, 30 %, expo over 12.5 s, hold 3 s, fade out log over 2 s.
  const colour = sidusPack([[0, 8], [0, 1], [2, 3], [20, 8], [30, 10], [1, 3], [125, 8], [70, 7], [240, 9], [300, 10], [1, 2], [1, 3], [21, 7], [1, 1]]);
  assert.deepEqual(programFade({ intensity: 0.3, fadeInMs: 12_500, curve: "exp", colour: { h: 240, s: 0.7 }, holdMs: 3000, fadeOutMs: 2000, fadeOutCurve: "log" }), colour);
});
