import { test } from "node:test";
import assert from "node:assert/strict";
import { BMD_DEVICE_NAME, BMD_INCOMING, BMD_OUTGOING, BMD_PROTOCOL_VERSION, BMD_STATUS, BMD_TIMECODE, encodeCcu, type CameraTelemetry } from "@openclapper/vocab";
import { toHex } from "../bytes.ts";
import type { Fixture, Link } from "../types.ts";
import { bmdCamera } from "./bmdCamera.ts";

const MAC = "A1:B2:C3:D4:E5:F6";
const cam: Fixture = { id: "c1", label: "A cam", kindId: "bmd-pocket-6k", address: MAC, mesh: null, createdAt: "", synced: true };

function setup() {
  const writes: { chr: string; bytes: string; withResponse: boolean }[] = [];
  const subs = new Map<string, (b: Uint8Array) => void>();
  let tick: (() => void) | null = null;
  const link: Link = {
    address: MAC, mtu: 247,
    write: async (_s, chr, bytes, withResponse) => { writes.push({ chr, bytes: toHex(bytes), withResponse }); },
    notify: async (_s, chr, cb) => { subs.set(chr, cb); return () => { subs.delete(chr); }; },
    read: async (_s, chr) => (chr === BMD_PROTOCOL_VERSION ? new TextEncoder().encode("0.1") : new Uint8Array()),
    onDisconnect: () => () => {},
    close: async () => {},
  };
  const driver = bmdCamera({ now: () => 0, setInterval: (fn) => { tick = fn; return 1; }, clearInterval: () => { tick = null; } });
  return { writes, subs, link, driver, tick: () => tick?.() };
}

test("connect: names itself, wakes the camera (which starts bonding), then follows incoming, timecode and status", async () => {
  const { writes, subs, link, driver } = setup();
  const seen: CameraTelemetry[] = [];
  await driver.open(link, [cam], (_id, t) => { if (t.camera) seen.push(t.camera); });
  assert.deepEqual(writes.map((w) => w.chr), [BMD_DEVICE_NAME, BMD_STATUS]);
  assert.equal(writes[1].bytes, "01");
  assert.ok(writes.every((w) => w.withResponse));
  assert.deepEqual([...subs.keys()], [BMD_INCOMING, BMD_TIMECODE, BMD_STATUS]);
  assert.equal(seen.at(-1)?.protocolVersion, "0.1");
});

test("incoming parameters, timecode and status reach the hub, at most every 250 ms", async () => {
  const { subs, link, driver, tick } = setup();
  const seen: CameraTelemetry[] = [];
  await driver.open(link, [cam], (_id, t) => { if (t.camera) seen.push(t.camera); });
  const before = seen.length;
  subs.get(BMD_INCOMING)!(Uint8Array.from([...encodeCcu({ category: 1, parameter: 14, type: 3, operation: 0, data: [800] }), ...encodeCcu({ category: 4, parameter: 1, type: 2, operation: 0, data: [4] })]));
  subs.get(BMD_TIMECODE)!(Uint8Array.from([0x10, 0x53, 0x12, 0x09]));
  subs.get(BMD_STATUS)!(Uint8Array.of(0x27));
  assert.equal(seen.length, before);
  tick();
  const c = seen.at(-1)!;
  assert.deepEqual(c.params["1.14"], [800]);
  assert.deepEqual(c.params["4.1"], [4]);
  assert.equal(c.timecode, "09:12:53:10");
  assert.equal(c.status, 0x27);
  assert.equal(c.log[0], "4.1 t2 op0: [4]");
});

test("commands are camera control messages, written with response; light commands are refused", async () => {
  const { writes, link, driver } = setup();
  const s = await driver.open(link, [cam], () => {});
  writes.length = 0;
  const m = { category: 10, parameter: 1, type: 1, operation: 0, data: [2, 0, 0, 0, 0] } as const;
  await s.send(cam, { op: "ccu", message: { ...m, data: [...m.data] } });
  assert.deepEqual(writes, [{ chr: BMD_OUTGOING, bytes: toHex(encodeCcu({ ...m, data: [...m.data] })), withResponse: true }]);
  await assert.rejects(s.send(cam, { op: "intensity", value: 1 }));
});

test("per-output tools and overlays set through the phone are reported per target, and kept across a reconnect", async () => {
  const b: Fixture = { ...cam, id: "c-outputs" };
  const { link, driver, tick } = setup();
  let seen: CameraTelemetry | undefined;
  const s = await driver.open(link, [b], (_id, t) => { if (t.camera) seen = t.camera; });
  await s.send(b, { op: "ccu", message: { category: 4, parameter: 1, type: 2, operation: 0, data: [0x6, 0x2] } });
  await s.send(b, { op: "ccu", message: { category: 3, parameter: 0, type: 2, operation: 0, data: [0x1, 0x3] } });
  tick();
  assert.deepEqual(seen?.outputs, { "4.1": { 2: 0x6 }, "3.0": { 1: 0x1, 2: 0x1 } });
  await s.close();
  const again = setup();
  seen = undefined;
  await again.driver.open(again.link, [b], (_id, t) => { if (t.camera) seen = t.camera; });
  assert.deepEqual(seen?.outputs?.["4.1"], { 2: 0x6 });
});
