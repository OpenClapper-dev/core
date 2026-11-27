/** Time for the queue and the hub; the real one in hub.ts, a fake one in the tests. */
export interface Clock {
  now(): number;
  wait(ms: number): Promise<void>;
}

interface Waiter { resolve: () => void; reject: (e: unknown) => void }
interface Entry { key: string; run: () => Promise<void>; waiters: Waiter[] }

/**
 * The writes of one Bluetooth link, one at a time and at most one per `minIntervalMs`. A slider
 * sends far more than a light takes, and writes without response have no flow control, so a newer
 * command with the same key (fixture + op) replaces the queued one instead of queueing behind it.
 *
 * Fair between the fixtures sharing a link (#426: two lights on one mesh link): each fixture (`group`)
 * has its own line and the link serves the lines in turn. A replacement keeps its place in its line
 * when it is the line's last entry and otherwise moves to the line's end, so per fixture the last
 * thing asked is still the last thing sent (power off after a colour change stays off). Before, a
 * replacement moved to the back of the whole queue: with two lights updated every 0.1 s on a link
 * that takes one write per 0.12 s, the second light's entry went behind the first's on every tick
 * and was never sent.
 */
export class CommandQueue {
  /** One line per group; Map order is the turn order (a served group with entries left goes to the end). */
  private lines = new Map<string, Entry[]>();
  private running = false;
  private last = Number.NEGATIVE_INFINITY;
  private closed: Error | null = null;
  private lastGroup: string | undefined;

  private readonly minIntervalMs: number;
  private readonly clock: Clock;

  constructor(minIntervalMs: number, clock: Clock) {
    this.minIntervalMs = minIntervalMs;
    this.clock = clock;
  }

  get size() { let n = 0; for (const l of this.lines.values()) n += l.length; return n; }

  /** Resolves when this command, or the newer one that replaced it, was written. `group`: the fixture it is for. */
  push(group: string, key: string, run: () => Promise<void>): Promise<void> {
    if (this.closed) return Promise.reject(this.closed);
    return new Promise<void>((resolve, reject) => {
      let line = this.lines.get(group);
      if (!line) { line = []; this.lines.set(group, line); }
      const i = line.findIndex((e) => e.key === key);
      if (i >= 0 && i === line.length - 1) {
        line[i] = { key, run, waiters: [...line[i].waiters, { resolve, reject }] };
      } else {
        const waiters = i >= 0 ? line.splice(i, 1)[0].waiters : [];
        line.push({ key, run, waiters: [...waiters, { resolve, reject }] });
      }
      void this.pump();
    });
  }

  /** Rejects everything still queued; later pushes reject at once. */
  close(reason: Error) {
    this.closed = reason;
    const dropped = [...this.lines.values()].flat();
    this.lines.clear();
    for (const e of dropped) for (const w of e.waiters) w.reject(reason);
  }

  /**
   * The next entry in turn: the head of the first line; that line then waits behind the others. The
   * group served last goes after any other, also when its line emptied and was opened again meanwhile.
   */
  private take(): Entry | undefined {
    let pick: string | undefined;
    for (const [group, line] of this.lines) {
      if (!line.length) continue;
      if (pick === undefined) pick = group;
      if (group !== this.lastGroup) { pick = group; break; }
    }
    if (pick === undefined) return undefined;
    const line = this.lines.get(pick)!;
    this.lines.delete(pick);
    const e = line.shift();
    if (line.length) this.lines.set(pick, line);
    this.lastGroup = pick;
    return e;
  }

  private async pump() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.size && !this.closed) {
        const gap = this.last + this.minIntervalMs - this.clock.now();
        if (gap > 0) await this.clock.wait(gap);
        const e = this.take();
        if (!e || this.closed) break;
        this.last = this.clock.now();
        try {
          await e.run();
          for (const w of e.waiters) w.resolve();
        } catch (err) {
          for (const w of e.waiters) w.reject(err);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
