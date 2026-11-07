import { toHex } from "../bytes.ts";
import { NEEWER_NOTIFY, NEEWER_SERVICE, NEEWER_WRITE } from "../codecs/neewer.ts";
import { batteryHelloFrames, batteryModel, FrameAssembler, parseReadout, pollFrame } from "../codecs/neewerBattery.ts";
import type { Command, Driver, Fixture, Link, Session, Telemetry } from "../types.ts";

/** How often the readout is asked for: the NEEWER app's pace. */
export const POLL_MS = 1000;

export interface BatteryOptions {
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (h: unknown) => void;
  now?: () => number;
  log?: (level: "debug" | "info" | "warn", event: string, data?: unknown) => void;
}

/**
 * The NEEWER PS099S (#210): read-only. While a screen holds the connection, the session asks for
 * the readout once a second and reports charge, volts, current and watts as telemetry.
 */
export function neewerBattery(opts: BatteryOptions = {}): Driver {
  const every = opts.setInterval ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
  const stopEvery = opts.clearInterval ?? ((h: unknown) => clearInterval(h as ReturnType<typeof setInterval>));
  const now = opts.now ?? (() => Date.now());
  const log = opts.log ?? (() => {});
  return {
    id: "neewer-battery",
    linkKey: (f) => f.address,
    rate: { minIntervalMs: 100 },
    addressesFor: (key) => [key],
    async open(link: Link, fixtures: Fixture[], sink: (id: string, t: Telemetry) => void): Promise<Session> {
      const f = fixtures.find((x) => x.address === link.address) ?? fixtures[0];
      const frames = new FrameAssembler();
      const stop = await link.notify(NEEWER_SERVICE, NEEWER_NOTIFY, (chunk) => {
        for (const fr of frames.push(chunk)) {
          const r = parseReadout(fr);
          if (r && f) { sink(f.id, { at: now(), battery: r.charge, volts: r.volts, amps: r.amps, watts: r.watts, discharging: r.discharging }); continue; }
          const model = batteryModel(fr);
          if (model) log("info", "neewer battery model", { fixture: f?.id, model });
          else log("debug", "neewer battery frame", { fixture: f?.id, bytes: toHex(fr) });
        }
      });
      const write = (b: Uint8Array) => link.write(NEEWER_SERVICE, NEEWER_WRITE, b, false);
      for (const h of batteryHelloFrames(link.address)) await write(h);
      // A poll that fails is not retried here: a dropped link is the hub's to reopen.
      const poll = () => { frames.dropStale(); void write(pollFrame()).catch((e) => log("debug", "neewer battery poll failed", { fixture: f?.id, error: e })); };
      poll();
      const timer = every(poll, POLL_MS);
      return {
        async send(_fx: Fixture, cmd: Command) {
          if (cmd.op === "status") { poll(); return; }
          throw new Error(`the battery has no ${cmd.op}`);
        },
        async close() { stopEvery(timer); stop(); },
      };
    },
  };
}
