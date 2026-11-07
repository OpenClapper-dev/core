import { test } from "node:test";
import assert from "node:assert/strict";
import { fromHex, toHex } from "../bytes.ts";
import type { Fixture, Link, Telemetry } from "../types.ts";
import { neewerBattery, POLL_MS } from "./neewerBattery.ts";

const MAC = "A1:B2:C3:D4:E5:F6";
const bat: Fixture = { id: "b1", label: "Bat1", kindId: "neewer-ps099s", address: MAC, mesh: null, createdAt: "", synced: true };
const IDLE = "78 18 51 01 60 40 1e 00 28 39 00 02 63 00 02 00 01 03 00 00 14 26 00 04 64 00 00 04 00 00 00 00 00 00 64 00 00 05 00 02 00 00 00 00 00 00 00 06 00 02 1f 40 00 00 00 00 00 07 00 02 2e e0 00 00 00 00 00 08 00 00 40 1e 00 00 00 00 00 09 00 00 00 00 00 00 6a";

function setup() {
  const writes: string[] = [];
  let onNotify: ((b: Uint8Array) => void) | null = null;
  const timers: { fn: () => void; ms: number; live: boolean }[] = [];
  const link: Link = {
    address: MAC, mtu: 23,
    write: async (_s, _c, b) => { writes.push(toHex(b)); },
    notify: async (_s, _c, cb) => { onNotify = cb; return () => { onNotify = null; }; },
    onDisconnect: () => () => {},
    close: async () => {},
  };
  const driver = neewerBattery({
    now: () => 1234,
    setInterval: (fn, ms) => { const t = { fn, ms, live: true }; timers.push(t); return t; },
    clearInterval: (h) => { (h as { live: boolean }).live = false; },
  });
  return { writes, link, driver, timers, notify: (hex: string) => onNotify?.(fromHex(hex)), listening: () => !!onNotify };
}

test("open: the app's hello, a first poll, then a poll every second", async () => {
  const { writes, link, driver, timers } = setup();
  await driver.open(link, [bat], () => {});
  assert.deepEqual([writes[0], writes[2], writes[3]], ["78 cd 01 01 47", "78 80 00 f8", "78 cd 01 00 46"]);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, POLL_MS);
  timers[0].fn();
  assert.equal(writes.at(-1), "78 cd 01 00 46");
});

test("a readout split over notifications becomes telemetry", async () => {
  const { link, driver, notify } = setup();
  const got: [string, Telemetry][] = [];
  await driver.open(link, [bat], (id, t) => got.push([id, t]));
  const bytes = IDLE.split(" ");
  for (let i = 0; i < bytes.length; i += 20) notify(bytes.slice(i, i + 20).join(" "));
  assert.equal(got.length, 1);
  assert.equal(got[0][0], "b1");
  assert.deepEqual({ ...got[0][1], watts: Math.round(got[0][1].watts! * 1000) / 1000 }, { at: 1234, battery: 96, volts: 16.414, amps: 0.04, watts: 0.657, discharging: false });
});

test("close stops polling and listening; only status is accepted", async () => {
  const { link, driver, timers, listening } = setup();
  const s = await driver.open(link, [bat], () => {});
  await assert.rejects(s.send(bat, { op: "power", on: true }), /no power/);
  await s.send(bat, { op: "status" });
  await s.close();
  assert.equal(timers[0].live, false);
  assert.equal(listening(), false);
});
