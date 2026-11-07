import { test } from "node:test";
import assert from "node:assert/strict";
import { formatMinutes, minutesLeft, PowerSmoother, SMOOTH_S } from "./batteryEstimate.ts";

test("time left: 99 Wh at 95 % feeding 101 W is about 56 min", () => {
  assert.equal(minutesLeft(95, 99, 101), 56);
  assert.equal(minutesLeft(50, 99, 10), 297);
});

test("no estimate while idle or without data", () => {
  assert.equal(minutesLeft(96, 99, 0.7), null);
  assert.equal(minutesLeft(96, 99, Number.NaN), null);
  assert.equal(minutesLeft(-1, 99, 50), null);
});

test("smoothing: a step settles over the time constant, a one-second spike barely moves it", () => {
  const s = new PowerSmoother();
  assert.equal(s.push(0, 10), 10);
  let v = 10;
  for (let t = 1; t <= SMOOTH_S; t++) v = s.push(t * 1000, 100);
  // After one time constant 63 % of the step.
  assert.ok(Math.abs(v - (10 + 90 * (1 - Math.exp(-1)))) < 0.5, String(v));
  const flat = new PowerSmoother();
  for (let t = 0; t < 30; t++) flat.push(t * 1000, 100);
  assert.ok(flat.push(30_000, 300) < 110);
});

test("formatting", () => {
  assert.equal(formatMinutes(45), "45 min");
  assert.equal(formatMinutes(125), "2 h 05 min");
  assert.equal(formatMinutes(24 * 60 + 1), "over 24 h");
});
