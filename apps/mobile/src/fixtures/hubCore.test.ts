import { test } from "node:test";
import assert from "node:assert/strict";
import { GRACE_MS, Hub, RETRY_MS } from "./hubCore.ts";
import type { Command, Driver, Fixture, Link } from "./types.ts";

const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };

/** Timers and clock that move only on advance(). */
function fakeTime() {
  let seq = 0;
  const tasks = new Map<number, { at: number; fn: () => void }>();
  const t = {
    now: 0,
    setTimeout: (fn: () => void, ms: number) => { const id = ++seq; tasks.set(id, { at: t.now + ms, fn }); return id; },
    clearTimeout: (h: unknown) => { tasks.delete(h as number); },
    pending: () => [...tasks.values()].map((x) => x.at - t.now).sort((a, b) => a - b),
    async advance(ms: number) {
      const target = t.now + ms;
      for (;;) {
        await settle();
        const next = [...tasks.entries()].filter(([, x]) => x.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        tasks.delete(next[0]);
        t.now = next[1].at;
        next[1].fn();
      }
      t.now = target;
      await settle();
    },
  };
  return t;
}

class FakeLink implements Link {
  mtu = 23;
  writes: string[] = [];
  closed = false;
  private drop = new Set<(e: unknown) => void>();
  readonly address: string;
  constructor(address: string) { this.address = address; }
  async write(_s: string, _c: string, bytes: Uint8Array) { this.writes.push(Array.from(bytes).join(",")); }
  async notify() { return () => {}; }
  onDisconnect(cb: (e: unknown) => void) { this.drop.add(cb); return () => { this.drop.delete(cb); }; }
  async close() { this.closed = true; }
  lose() { for (const cb of [...this.drop]) cb(new Error("link lost")); }
}

const fixture = (id: string, address: string, kindId = "fake"): Fixture => ({ id, label: id, kindId, address, mesh: null, createdAt: "", synced: true });

function world(opts: { fail?: number } = {}) {
  const time = fakeTime();
  const links: FakeLink[] = [];
  const connects: number[] = [];
  let failures = opts.fail ?? 0;
  const driver: Driver = {
    id: "fake",
    linkKey: (f) => f.address,
    rate: { minIntervalMs: 0 },
    addressesFor: (key) => [key],
    open: async (link) => ({
      send: async (_f, cmd: Command) => { await link.write("s", "c", Uint8Array.of(cmd.op.length), false); },
      close: async () => {},
    }),
  };
  const fixtures = [fixture("a", "AA:00:00:00:00:01"), fixture("b", "AA:00:00:00:00:02"), fixture("x", "AA:00:00:00:00:03", "unsupported")];
  const hub = new Hub({
    fixtures: () => fixtures,
    driverFor: (k) => (k === "fake" ? driver : undefined),
    connect: async (address) => {
      connects.push(time.now);
      if (failures > 0) { failures--; throw new Error("gatt 133"); }
      const l = new FakeLink(address);
      links.push(l);
      return l;
    },
    timers: time,
    clock: { now: () => time.now, wait: (ms) => new Promise((r) => time.setTimeout(r, ms)) },
    log: () => {},
  });
  return { hub, time, links, connects };
}

test("a lease connects; the link closes a grace period after the last release", async () => {
  const { hub, time, links } = world();
  const release = hub.acquire(["a"], "screen");
  await time.advance(0);
  assert.equal(hub.status("a").link, "ready");
  release();
  release(); // idempotent
  await time.advance(GRACE_MS - 1);
  assert.equal(hub.status("a").link, "ready");
  await time.advance(1);
  assert.equal(hub.status("a").link, "off");
  assert.equal(links[0].closed, true);
});

test("coming back within the grace period keeps the same connection", async () => {
  const { hub, time, links } = world();
  hub.acquire(["a"], "screen")();
  await time.advance(GRACE_MS / 2);
  const again = hub.acquire(["a"], "screen");
  await time.advance(GRACE_MS * 2);
  assert.equal(links.length, 1);
  assert.equal(hub.status("a").link, "ready");
  again();
});

test("two holders: the link stays until both let go", async () => {
  const { hub, time } = world();
  const screen = hub.acquire(["a", "b"], "screen");
  const sequence = hub.acquire(["a"], "sequence");
  await time.advance(0);
  screen();
  await time.advance(GRACE_MS * 2);
  assert.equal(hub.status("a").link, "ready");
  assert.equal(hub.status("b").link, "off");
  sequence();
});

test("failed connects retry with the backoff, the last wait repeating", async () => {
  const { hub, time, connects } = world({ fail: 7 });
  hub.acquire(["a"], "screen");
  await time.advance(0);
  assert.equal(hub.status("a").link, "retrying");
  assert.equal(hub.status("a").error, "gatt 133");
  await time.advance(200_000);
  const waits = connects.slice(1).map((t, i) => t - connects[i]);
  assert.deepEqual(waits, [...RETRY_MS, 30_000, 30_000]);
  assert.equal(hub.status("a").link, "ready");
  assert.equal(hub.status("a").attempt, 0);
});

test("a lost link reconnects while held", async () => {
  const { hub, time, links } = world();
  hub.acquire(["a"], "screen");
  await time.advance(0);
  links[0].lose();
  assert.equal(hub.status("a").link, "retrying");
  await assert.rejects(hub.send("a", { op: "power", on: true }), /not connected/);
  await time.advance(RETRY_MS[0]);
  assert.equal(hub.status("a").link, "ready");
  assert.equal(links.length, 2);
});

test("background closes everything; foreground reopens what is still held", async () => {
  const { hub, time, links } = world();
  hub.acquire(["a"], "screen");
  hub.acquire(["b"], "screen")();
  await time.advance(0);
  hub.suspend();
  await time.advance(0);
  assert.equal(hub.status("a").link, "off");
  assert.ok(links.every((l) => l.closed));
  hub.resume();
  await time.advance(0);
  assert.equal(hub.status("a").link, "ready");
  assert.equal(hub.status("b").link, "off");
});

test("sends go through the link and update the known state", async () => {
  const { hub, time, links } = world();
  hub.acquire(["a"], "screen");
  await time.advance(0);
  await hub.send("a", { op: "intensity", value: 0.4 });
  await hub.send("a", { op: "cct", kelvin: 3200, gm: 0 });
  assert.equal(links[0].writes.length, 2);
  assert.deepEqual(hub.status("a").state, { intensity: 0.4, cct: { kelvin: 3200, gm: 0 }, hsi: undefined });
});

test("a kind without a driver says so instead of connecting", async () => {
  const { hub, time, connects } = world();
  hub.acquire(["x"], "screen");
  await time.advance(0);
  assert.equal(hub.status("x").link, "failed");
  assert.equal(connects.length, 0);
  assert.equal(hub.status("nope").error, "unknown fixture");
});
