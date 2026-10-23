import { fixtureKind, startState, type Curve } from "@openclapper/vocab";
import { toHex } from "../bytes.ts";
import { helloFrames, modelOf, NEEWER_NOTIFY, NEEWER_SERVICE, NEEWER_WRITE, parseNotice, powerFrame, whiteFrame } from "../codecs/neewer.ts";
import type { Command, Driver, Fixture, Link, Session, Telemetry } from "../types.ts";

/** A light needs a moment after power-on before it takes a white-light frame. */
export const AFTER_POWER_ON_MS = 150;
/** The pace the NEEWER app keeps while a slider moves. */
export const MIN_INTERVAL_MS = 100;

interface White { intensity: number; kelvin: number; curve: Curve; gm: number }

export interface NeewerOptions {
  wait?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (level: "debug" | "info" | "warn", event: string, data?: unknown) => void;
}

/** Until the screen sets them: the shared start values (vocab startState). */
function startWhite(f: Fixture): White {
  const kind = fixtureKind(f.kindId);
  const s = kind ? startState(kind) : {};
  return { intensity: s.intensity ?? 0.5, kelvin: s.cct?.kelvin ?? 5600, curve: s.curve ?? "linear", gm: 0 };
}

/**
 * NEEWER "Infinity" bi-colour lights over their own connection (#209). Intensity, white and the
 * curve share one frame, so the session keeps each light's last values and always sends all three.
 */
export function neewerInfinity(opts: NeewerOptions = {}): Driver {
  const wait = opts.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? (() => Date.now());
  const log = opts.log ?? (() => {});
  return {
    id: "neewer-infinity",
    linkKey: (f) => f.address,
    rate: { minIntervalMs: MIN_INTERVAL_MS },
    addressesFor: (key) => [key],
    async open(link: Link, fixtures: Fixture[], sink: (id: string, t: Telemetry) => void): Promise<Session> {
      const f = fixtures.find((x) => x.address === link.address) ?? fixtures[0];
      const white = new Map<string, White>();
      let poweredOnAt = Number.NEGATIVE_INFINITY;
      const stop = await link.notify(NEEWER_SERVICE, NEEWER_NOTIFY, (b) => {
        log("debug", "neewer notify", { fixture: f?.id, bytes: toHex(b) });
        const n = parseNotice(b);
        const model = n && modelOf(n);
        if (model && f) { log("info", "neewer model", { fixture: f.id, model }); sink(f.id, { at: now() }); }
      });
      const write = async (bytes: Uint8Array) => {
        log("debug", "neewer write", { bytes: toHex(bytes) });
        await link.write(NEEWER_SERVICE, NEEWER_WRITE, bytes, false);
      };
      if (f) for (const h of helloFrames(f.address)) await write(h);
      return {
        async send(fx: Fixture, cmd: Command) {
          const w = white.get(fx.id) ?? startWhite(fx);
          switch (cmd.op) {
            case "power":
              await write(powerFrame(fx.address, cmd.on));
              if (cmd.on) poweredOnAt = now();
              return;
            case "intensity": w.intensity = cmd.value; break;
            case "cct": w.kelvin = cmd.kelvin; w.gm = cmd.gm; break;
            case "curve": w.curve = cmd.curve; break;
            case "status": return; // the light reports nothing useful yet
            default: throw new Error(`${fx.kindId} has no ${cmd.op}`);
          }
          white.set(fx.id, w);
          const left = poweredOnAt + AFTER_POWER_ON_MS - now();
          if (left > 0) await wait(left);
          await write(whiteFrame(fx.address, w));
        },
        async close() { stop(); },
      };
    },
  };
}
