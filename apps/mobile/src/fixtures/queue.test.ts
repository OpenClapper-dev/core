import { test } from "node:test";
import assert from "node:assert/strict";
import { CommandQueue } from "./queue.ts";

/** A clock that only moves when the queue waits, so intervals are exact. */
function fakeClock() {
  const c = { t: 0, waits: [] as number[], now: () => c.t, wait: async (ms: number) => { c.waits.push(ms); c.t += ms; } };
  return c;
}

test("one write at a time, at most one per interval", async () => {
  const clock = fakeClock();
  const q = new CommandQueue(60, clock);
  const sent: [string, number][] = [];
  const op = (k: string) => q.push(k, async () => { sent.push([k, clock.t]); });
  await Promise.all([op("a"), op("b"), op("c")]);
  assert.deepEqual(sent, [["a", 0], ["b", 60], ["c", 120]]);
});

test("a newer command of the same key replaces the queued one and moves to the back", async () => {
  const clock = fakeClock();
  const q = new CommandQueue(60, clock);
  const sent: string[] = [];
  const op = (k: string, v: string) => q.push(k, async () => { sent.push(`${k}=${v}`); });
  const all = [op("power", "on"), op("cct", "3200"), op("power", "off"), op("cct", "5600"), op("intensity", "0.5"), op("cct", "4300")];
  await Promise.all(all); // every caller resolves, including the replaced ones
  // "power=on" was already being written when the others arrived.
  assert.deepEqual(sent, ["power=on", "power=off", "intensity=0.5", "cct=4300"]);
});

test("a slider flood ends with the last value only", async () => {
  const clock = fakeClock();
  const q = new CommandQueue(60, clock);
  const sent: number[] = [];
  const pushes = Array.from({ length: 50 }, (_, i) => q.push("f1:intensity", async () => { sent.push(i); }));
  await Promise.all(pushes);
  assert.deepEqual(sent, [0, 49]);
});

test("a failed write rejects its callers; the queue goes on", async () => {
  const q = new CommandQueue(0, fakeClock());
  const bad = q.push("a", async () => { throw new Error("gatt 133"); });
  const good = q.push("b", async () => {});
  await assert.rejects(bad, /gatt 133/);
  await good;
});

test("close rejects what is queued and everything after", async () => {
  const clock = fakeClock();
  const q = new CommandQueue(60, clock);
  let release!: () => void;
  const first = q.push("a", () => new Promise<void>((r) => { release = r; }));
  const second = q.push("b", async () => {});
  q.close(new Error("disconnected"));
  release();
  await first;
  await assert.rejects(second, /disconnected/);
  await assert.rejects(q.push("c", async () => {}), /disconnected/);
  assert.equal(q.size, 0);
});
