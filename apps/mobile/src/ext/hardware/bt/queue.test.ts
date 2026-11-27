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
  const op = (k: string) => q.push("f1", k, async () => { sent.push([k, clock.t]); });
  await Promise.all([op("a"), op("b"), op("c")]);
  assert.deepEqual(sent, [["a", 0], ["b", 60], ["c", 120]]);
});

test("a newer command of the same key replaces the queued one and moves to the end of its fixture's line", async () => {
  const clock = fakeClock();
  const q = new CommandQueue(60, clock);
  const sent: string[] = [];
  const op = (k: string, v: string) => q.push("f1", k, async () => { sent.push(`${k}=${v}`); });
  const all = [op("power", "on"), op("cct", "3200"), op("power", "off"), op("cct", "5600"), op("intensity", "0.5"), op("cct", "4300")];
  await Promise.all(all); // every caller resolves, including the replaced ones
  // "power=on" was already being written when the others arrived.
  assert.deepEqual(sent, ["power=on", "power=off", "intensity=0.5", "cct=4300"]);
});

test("a slider flood ends with the last value only", async () => {
  const clock = fakeClock();
  const q = new CommandQueue(60, clock);
  const sent: number[] = [];
  const pushes = Array.from({ length: 50 }, (_, i) => q.push("f1", "f1:intensity", async () => { sent.push(i); }));
  await Promise.all(pushes);
  assert.deepEqual(sent, [0, 49]);
});

test("a failed write rejects its callers; the queue goes on", async () => {
  const q = new CommandQueue(0, fakeClock());
  const bad = q.push("f1", "a", async () => { throw new Error("gatt 133"); });
  const good = q.push("f1", "b", async () => {});
  await assert.rejects(bad, /gatt 133/);
  await good;
});

test("close rejects what is queued and everything after", async () => {
  const clock = fakeClock();
  const q = new CommandQueue(60, clock);
  let release!: () => void;
  const first = q.push("f1", "a", () => new Promise<void>((r) => { release = r; }));
  const second = q.push("f1", "b", async () => {});
  q.close(new Error("disconnected"));
  release();
  await first;
  await assert.rejects(second, /disconnected/);
  await assert.rejects(q.push("f1", "c", async () => {}), /disconnected/);
  assert.equal(q.size, 0);
});

const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };

/** Timed events on one clock: a flow's ticks and the queue's waits interleave as they would in real time. */
function timeline() {
  let seq = 0;
  const tasks = new Map<number, { at: number; fn: () => void }>();
  const t = {
    now: 0,
    at(ms: number, fn: () => void) { tasks.set(++seq, { at: ms, fn }); },
    clock: { now: () => t.now, wait: (ms: number) => new Promise<void>((r) => t.at(t.now + ms, r)) },
    async run(until: number) {
      for (;;) {
        await settle();
        const next = [...tasks.entries()].filter(([, x]) => x.at <= until).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!next) break;
        tasks.delete(next[0]);
        t.now = next[1].at;
        next[1].fn();
      }
      t.now = until;
      await settle();
    },
  };
  return t;
}

test("two fixtures stepping on one link both get updates (#426)", async () => {
  // A stepped fade on two Aputure lights on one mesh link: the flow sends both a new intensity every 0.1 s,
  // the link takes one write per 0.12 s. Before the fix the second light got none of 100 ticks (the first 84).
  const tl = timeline();
  const q = new CommandQueue(120, tl.clock);
  const got: Record<string, number[]> = { A: [], B: [] };
  for (let k = 0; k < 100; k++) {
    tl.at(k * 100, () => { for (const f of ["A", "B"]) void q.push(f, `${f}:intensity`, async () => { got[f].push(tl.now); }); });
  }
  await tl.run(9_950);
  // 10 s / 0.12 s ≈ 83 writes, shared about equally.
  assert.ok(Math.abs(got.A.length - got.B.length) <= 1, `A ${got.A.length}, B ${got.B.length}`);
  assert.ok(got.B.length >= 40, `B ${got.B.length}`);
  // Each light is updated at least every 2 × 0.12 s.
  for (const f of ["A", "B"]) for (let i = 1; i < got[f].length; i++) assert.ok(got[f][i] - got[f][i - 1] <= 240, `${f} gap at ${got[f][i]}`);
});

test("a jump on two fixtures at the same time: the second ends one write after the first (#426)", async () => {
  // Three ops each (power, white, intensity) at one keyframe. Before the fix, in push order: A's three then B's, so B
  // was done 3 writes (360 ms) after A; now the lines take turns and they are done 120 ms apart.
  const tl = timeline();
  const q = new CommandQueue(120, tl.clock);
  const sent: string[] = [];
  const done: Record<string, number> = {};
  tl.at(0, () => {
    for (const f of ["A", "B"]) for (const op of ["power", "cct", "intensity"]) void q.push(f, `${f}:${op}`, async () => { sent.push(`${f}:${op}`); done[f] = tl.now; });
  });
  await tl.run(2_000);
  assert.deepEqual(sent, ["A:power", "B:power", "A:cct", "B:cct", "A:intensity", "B:intensity"]);
  assert.equal(done.B - done.A, 120);
});

test("a replacement keeps its place unless that would send it before a later command for its fixture", async () => {
  const clock = fakeClock();
  const q = new CommandQueue(60, clock);
  const sent: string[] = [];
  const op = (f: string, k: string, v: string) => q.push(f, `${f}:${k}`, async () => { sent.push(`${f}:${k}=${v}`); });
  const all = [
    op("A", "intensity", "0.1"), // written at once
    op("A", "intensity", "0.2"), op("B", "intensity", "0.1"), op("A", "intensity", "0.3"), // B first: A was just served; 0.3 replaces 0.2 in place
    op("B", "cct", "3200"), op("B", "power", "off"), op("B", "cct", "5600"), // B's white moves behind its power off
  ];
  await Promise.all(all);
  assert.deepEqual(sent, ["A:intensity=0.1", "B:intensity=0.1", "A:intensity=0.3", "B:power=off", "B:cct=5600"]);
});
