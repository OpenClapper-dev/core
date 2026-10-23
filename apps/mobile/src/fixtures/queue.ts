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
 * The replacement moves to the back, so the last thing asked is also the last thing sent: power
 * off after a colour change stays off.
 */
export class CommandQueue {
  private entries: Entry[] = [];
  private running = false;
  private last = Number.NEGATIVE_INFINITY;
  private closed: Error | null = null;

  private readonly minIntervalMs: number;
  private readonly clock: Clock;

  constructor(minIntervalMs: number, clock: Clock) {
    this.minIntervalMs = minIntervalMs;
    this.clock = clock;
  }

  get size() { return this.entries.length; }

  /** Resolves when this command, or the newer one that replaced it, was written. */
  push(key: string, run: () => Promise<void>): Promise<void> {
    if (this.closed) return Promise.reject(this.closed);
    return new Promise<void>((resolve, reject) => {
      const i = this.entries.findIndex((e) => e.key === key);
      const waiters = i >= 0 ? this.entries.splice(i, 1)[0].waiters : [];
      this.entries.push({ key, run, waiters: [...waiters, { resolve, reject }] });
      void this.pump();
    });
  }

  /** Rejects everything still queued; later pushes reject at once. */
  close(reason: Error) {
    this.closed = reason;
    const dropped = this.entries;
    this.entries = [];
    for (const e of dropped) for (const w of e.waiters) w.reject(reason);
  }

  private async pump() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.entries.length && !this.closed) {
        const gap = this.last + this.minIntervalMs - this.clock.now();
        if (gap > 0) await this.clock.wait(gap);
        const e = this.entries.shift();
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
