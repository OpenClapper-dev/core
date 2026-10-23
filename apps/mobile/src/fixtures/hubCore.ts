import type { LightState } from "@openclapper/vocab";
import { CommandQueue, type Clock } from "./queue.ts";
import type { Command, Driver, Fixture, Link, Session, Telemetry } from "./types.ts";

export type LinkState = "off" | "connecting" | "ready" | "retrying" | "failed";

export interface FixtureStatus {
  link: LinkState;
  /** Failed connection attempts in a row. */
  attempt: number;
  error: string | null;
  telemetry: Telemetry | null;
  /** What the phone last set or the fixture last reported. */
  state: LightState;
}

/** Who holds a connection open: a screen showing the fixture, or a running sequence (later). */
export type Holder = "screen" | "sequence";

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface HubDeps {
  fixtures: () => Fixture[];
  driverFor: (kindId: string) => Driver | undefined;
  connect: (address: string) => Promise<Link>;
  timers: Timers;
  clock: Clock;
  log: (level: "debug" | "info" | "warn", event: string, data?: unknown) => void;
}

/** Waits between reconnect attempts; the last one repeats while the connection is still wanted. */
export const RETRY_MS = [1000, 2000, 5000, 15_000, 30_000];
/** A connection outlives its last lease this long, so going back and forth between screens does not reconnect. */
export const GRACE_MS = 2000;

interface LinkRec {
  key: string;
  driver: Driver;
  leases: number;
  state: LinkState;
  attempt: number;
  error: string | null;
  link: Link | null;
  session: Session | null;
  queue: CommandQueue | null;
  offDisconnect: (() => void) | null;
  timer: unknown;
  /** Bumped by every start and stop: an attempt that finishes after it was superseded is dropped. */
  gen: number;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The state a command leaves a light in, as far as the phone knows. */
export function applyCommand(s: LightState, cmd: Command): LightState {
  switch (cmd.op) {
    case "power": return { ...s, power: cmd.on };
    case "intensity": return { ...s, intensity: cmd.value };
    case "cct": return { ...s, cct: { kelvin: cmd.kelvin, gm: cmd.gm }, hsi: undefined };
    case "hsi": return { ...s, hsi: { h: cmd.h, s: cmd.s, i: cmd.i }, cct: undefined, intensity: cmd.i };
    default: return s;
  }
}

/**
 * The connection manager (#208). Connections exist only while something holds a lease on them,
 * reconnect with backoff while held, close a little after the last lease, and close all while the
 * app is in the background (Android stops Bluetooth work there anyway). Writes go through one
 * queue per link. Free of React Native so it runs under `node --test`; hub.ts wires it up.
 */
export class Hub {
  private links = new Map<string, LinkRec>();
  private telemetry = new Map<string, Telemetry>();
  private states = new Map<string, LightState>();
  private listeners = new Set<() => void>();
  private suspended = false;

  private readonly d: HubDeps;

  constructor(deps: HubDeps) {
    this.d = deps;
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  /** Hold the connections the fixtures need; call the result to let go (idempotent). */
  acquire(fixtureIds: string[], holder: Holder): () => void {
    const keys: string[] = [];
    for (const id of fixtureIds) {
      const r = this.resolve(id);
      if (!r) continue;
      let rec = this.links.get(r.key);
      if (!rec) {
        rec = { key: r.key, driver: r.driver, leases: 0, state: "off", attempt: 0, error: null, link: null, session: null, queue: null, offDisconnect: null, timer: null, gen: 0 };
        this.links.set(r.key, rec);
      }
      if (keys.includes(r.key)) continue;
      keys.push(r.key);
      rec.leases++;
      // Open or opening: only cancel a pending close. Otherwise (off, failed, waiting to retry) try now.
      if (rec.state === "ready" || rec.state === "connecting") this.clearTimer(rec);
      else if (!this.suspended) void this.start(rec);
    }
    this.d.log("debug", "fixture lease", { holder, links: keys });
    let released = false;
    return () => {
      if (released) return;
      released = true;
      for (const key of keys) {
        const rec = this.links.get(key);
        if (!rec || --rec.leases > 0) continue;
        this.clearTimer(rec);
        rec.timer = this.d.timers.setTimeout(() => { if (rec.leases === 0) void this.stop(rec); }, GRACE_MS);
      }
    };
  }

  /** Queued and coalesced per link; rejects when the fixture is not connected. */
  send(fixtureId: string, cmd: Command): Promise<void> {
    const f = this.fixture(fixtureId);
    const r = f && this.resolve(fixtureId);
    const rec = r ? this.links.get(r.key) : undefined;
    if (!f || !rec || rec.state !== "ready" || !rec.queue) return Promise.reject(new Error("not connected"));
    return rec.queue.push(`${fixtureId}:${cmd.op}`, async () => {
      if (!rec.session) throw new Error("not connected");
      await rec.session.send(f, cmd);
      this.states.set(fixtureId, applyCommand(this.states.get(fixtureId) ?? {}, cmd));
      this.notify();
    });
  }

  status(fixtureId: string): FixtureStatus {
    const base = { telemetry: this.telemetry.get(fixtureId) ?? null, state: this.states.get(fixtureId) ?? {} };
    const f = this.fixture(fixtureId);
    if (!f) return { ...base, link: "off", attempt: 0, error: "unknown fixture" };
    const r = this.resolve(fixtureId);
    if (!r) return { ...base, link: "failed", attempt: 0, error: "this kind cannot be controlled yet" };
    const rec = this.links.get(r.key);
    return rec ? { ...base, link: rec.state, attempt: rec.attempt, error: rec.error } : { ...base, link: "off", attempt: 0, error: null };
  }

  /** The app went to the background: close everything, keep the leases. */
  suspend() {
    this.suspended = true;
    for (const rec of this.links.values()) void this.stop(rec);
  }

  /** Back in the foreground: reopen what is still held. */
  resume() {
    this.suspended = false;
    for (const rec of this.links.values()) if (rec.leases > 0) void this.start(rec);
  }

  private fixture(id: string) { return this.d.fixtures().find((f) => f.id === id); }

  private resolve(id: string): { key: string; driver: Driver } | null {
    const f = this.fixture(id);
    const driver = f && this.d.driverFor(f.kindId);
    return f && driver ? { key: driver.linkKey(f), driver } : null;
  }

  private notify() { for (const cb of this.listeners) cb(); }

  private set(rec: LinkRec, patch: Partial<Pick<LinkRec, "state" | "attempt" | "error">>) {
    Object.assign(rec, patch);
    this.notify();
  }

  private clearTimer(rec: LinkRec) {
    if (rec.timer != null) this.d.timers.clearTimeout(rec.timer);
    rec.timer = null;
  }

  private onLinkFixtures(rec: LinkRec) {
    return this.d.fixtures().filter((f) => { const d = this.d.driverFor(f.kindId); return d === rec.driver && d.linkKey(f) === rec.key; });
  }

  private async start(rec: LinkRec) {
    const gen = ++rec.gen;
    this.clearTimer(rec);
    const fixtures = this.onLinkFixtures(rec);
    const addresses = rec.driver.addressesFor(rec.key, fixtures);
    if (!addresses.length) { this.set(rec, { state: "failed", error: "no address to connect to" }); return; }
    this.set(rec, { state: "connecting" });
    let lastError: unknown = null;
    for (const address of addresses) {
      let link: Link | null = null;
      try {
        link = await this.d.connect(address);
        if (gen !== rec.gen) { void link.close().catch(() => {}); return; }
        const session = await rec.driver.open(link, fixtures, (id, t) => this.onTelemetry(id, t));
        if (gen !== rec.gen) { void session.close().catch(() => {}); void link.close().catch(() => {}); return; }
        rec.link = link;
        rec.session = session;
        rec.queue = new CommandQueue(rec.driver.rate.minIntervalMs, this.d.clock);
        rec.offDisconnect = link.onDisconnect((e) => this.onDisconnect(rec, gen, e));
        this.d.log("info", "fixture link ready", { link: rec.key, address, mtu: link.mtu });
        this.set(rec, { state: "ready", attempt: 0, error: null });
        return;
      } catch (e) {
        lastError = e;
        if (link) void link.close().catch(() => {});
        if (gen !== rec.gen) return;
      }
    }
    this.retry(rec, lastError);
  }

  private retry(rec: LinkRec, error: unknown) {
    const attempt = rec.attempt + 1;
    this.d.log("warn", "fixture link failed", { link: rec.key, attempt, error: message(error) });
    if (rec.leases === 0 || this.suspended) { this.set(rec, { state: "off", attempt, error: message(error) }); return; }
    this.set(rec, { state: "retrying", attempt, error: message(error) });
    const gen = rec.gen;
    rec.timer = this.d.timers.setTimeout(() => { if (gen === rec.gen) void this.start(rec); }, RETRY_MS[Math.min(attempt - 1, RETRY_MS.length - 1)]);
  }

  private onDisconnect(rec: LinkRec, gen: number, error: unknown) {
    if (gen !== rec.gen) return;
    this.teardown(rec, new Error("disconnected"));
    rec.gen++;
    this.retry(rec, error ?? new Error("disconnected"));
  }

  private teardown(rec: LinkRec, reason: Error) {
    rec.queue?.close(reason);
    rec.offDisconnect?.();
    const { session, link } = rec;
    Object.assign(rec, { queue: null, offDisconnect: null, session: null, link: null });
    void (async () => {
      await session?.close().catch(() => {});
      await link?.close().catch(() => {});
    })();
  }

  private async stop(rec: LinkRec) {
    rec.gen++;
    this.clearTimer(rec);
    if (rec.link || rec.state !== "off") this.d.log("info", "fixture link closed", { link: rec.key });
    this.teardown(rec, new Error("closed"));
    this.set(rec, { state: "off", attempt: 0, error: null });
  }

  private onTelemetry(fixtureId: string, t: Telemetry) {
    this.telemetry.set(fixtureId, { ...this.telemetry.get(fixtureId), ...t });
    if (t.state) this.states.set(fixtureId, { ...this.states.get(fixtureId), ...t.state });
    this.notify();
  }
}
