import { test } from "node:test";
import assert from "node:assert/strict";
import { fromHex, toHex } from "../bytes.ts";
import { batteryHelloFrames, batteryModel, FrameAssembler, parseReadout, pollFrame } from "./neewerBattery.ts";

// Real replies from a PS099S (#207/#210; they carry no address): idle, and feeding an FS300B at ~100 W.
const IDLE = "78 18 51 01 60 40 1e 00 28 39 00 02 63 00 02 00 01 03 00 00 14 26 00 04 64 00 00 04 00 00 00 00 00 00 64 00 00 05 00 02 00 00 00 00 00 00 00 06 00 02 1f 40 00 00 00 00 00 07 00 02 2e e0 00 00 00 00 00 08 00 00 40 1e 00 00 00 00 00 09 00 00 00 00 00 00 6a";
const LOAD_CHUNKS = [
  "78 18 51 01 5f 3c 88 19 7a 39 02 02 63 00 02 00 01 03 00 00",
  "14 26 00 04 64 00 00 04 00 00 00 00 00 00 64 00 00 05 00 02",
  "00 00 00 00 00 00 00 06 00 02 1f 40 00 00 00 00 00 07 00 02",
  "2e e0 00 00 00 00 00 08 00 00 3c 88 00 00 00 00 00 09 00 00",
  "00 00 00 00 a2",
];

test("the app's frames, byte for byte", () => {
  assert.equal(toHex(pollFrame()), "78 cd 01 00 46");
  const hello = batteryHelloFrames("A1:B2:C3:D4:E5:F6").map(toHex);
  assert.equal(hello[0], "78 cd 01 01 47");
  assert.equal(hello[2], "78 80 00 f8");
  assert.ok(hello[1].startsWith("78 95 06 a1 b2 c3 d4 e5 f6"));
});

test("idle: 96 %, 16.414 V, 40 mA", () => {
  const r = parseReadout(fromHex(IDLE))!;
  assert.equal(r.charge, 96);
  assert.equal(r.volts, 16.414);
  assert.equal(r.amps, 0.04);
  assert.ok(Math.abs(r.watts - 0.657) < 0.001);
  assert.equal(r.discharging, false);
});

test("under a 100 W load, from five notifications", () => {
  const a = new FrameAssembler();
  const frames = LOAD_CHUNKS.flatMap((c) => a.push(fromHex(c)));
  assert.equal(frames.length, 1);
  const r = parseReadout(frames[0])!;
  assert.equal(r.charge, 95);
  assert.equal(r.volts, 15.496);
  assert.equal(r.amps, 6.522);
  assert.ok(Math.abs(r.watts - 101.07) < 0.01, String(r.watts));
  assert.equal(r.discharging, true);
});

test("a broken checksum or a short status is not a readout", () => {
  const bad = fromHex(IDLE);
  bad[84] ^= 1;
  assert.equal(parseReadout(bad), null);
  assert.equal(parseReadout(fromHex("78 18 08 01 2d 40 1e 00 34 39 00 91")), null);
});

test("the assembler: one frame per notification, long ones joined, odd ones handled", () => {
  const a = new FrameAssembler();
  assert.deepEqual(a.push(fromHex("78 78")), []); // the hello's bare reply
  assert.deepEqual(a.push(fromHex("14 26 00 04")), []); // a stray continuation
  // The info reply: 16 bytes in one notification although its third byte says 0x13.
  const info = a.push(fromHex("78 00 13 01 00 00 00 01 02 50 53 30 39 39 53 27"));
  assert.equal(info.length, 1);
  assert.equal(batteryModel(info[0]), "PS099S");
  // A large MTU brings the readout in one piece, or two back to back.
  assert.equal(parseReadout(a.push(fromHex(IDLE))[0])?.charge, 96);
  assert.equal(a.push(fromHex(`${IDLE} ${IDLE}`)).length, 2);
  // And the next split reply still lines up.
  assert.equal(LOAD_CHUNKS.flatMap((c) => a.push(fromHex(c))).length, 1);
});

test("a reply missing a notification is dropped at the second poll, not the first", () => {
  const a = new FrameAssembler();
  a.push(fromHex(LOAD_CHUNKS[0]));
  a.dropStale(); // poll while the reply is arriving: kept
  assert.equal(LOAD_CHUNKS.slice(1).flatMap((c) => a.push(fromHex(c))).length, 1);
  a.push(fromHex(LOAD_CHUNKS[0])); // the rest of this one never comes
  a.dropStale();
  a.dropStale(); // next poll: dropped
  assert.equal(parseReadout(a.push(fromHex(IDLE))[0])?.charge, 96);
});
