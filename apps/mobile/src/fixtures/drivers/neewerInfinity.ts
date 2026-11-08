import { effectSettingsOf, fixtureKind, startState, type Curve, type EffectId, type EffectSettings, type LightState } from "@openclapper/vocab";
import { toHex } from "../bytes.ts";
import { effectFrame, helloFrames, modelOf, NEEWER_NOTIFY, NEEWER_SERVICE, NEEWER_WRITE, parseNotice, parseState, powerFrame, smoothFrame, stateQuery, whiteFrame } from "../codecs/neewer.ts";
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
 * Built-in effects (#206) carry their own intensity: while one runs, an intensity change re-sends
 * it, and white or a curve change ends it (the light has no "effect off"). The light's state reply
 * (asked on connect and after an effect change) moves the controls to what it really shows.
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
      const running = new Map<string, { id: EffectId; settings?: EffectSettings }>();
      let poweredOnAt = Number.NEGATIVE_INFINITY;
      const stop = await link.notify(NEEWER_SERVICE, NEEWER_NOTIFY, (b) => {
        log("debug", "neewer notify", { fixture: f?.id, bytes: toHex(b) });
        const n = parseNotice(b);
        const model = n && modelOf(n);
        if (model && f) { log("info", "neewer model", { fixture: f.id, model }); sink(f.id, { at: now() }); }
        const st = n && parseState(n);
        if (st && f) {
          log("info", "neewer state", { fixture: f.id, state: st, bytes: toHex(b) });
          const w = white.get(f.id) ?? startWhite(f);
          if (st.intensity !== undefined) w.intensity = st.intensity;
          if (st.kelvin !== undefined) w.kelvin = st.kelvin;
          if (st.gm !== undefined) w.gm = st.gm;
          if (st.curve) w.curve = st.curve;
          white.set(f.id, w);
          if (st.effect === null) running.delete(f.id);
          const state: LightState = { power: st.power, ...(st.effect !== undefined ? { effect: st.effect } : {}) };
          if (st.intensity !== undefined) state.intensity = st.intensity;
          if (st.kelvin !== undefined) state.cct = { kelvin: st.kelvin, gm: st.gm ?? 0 };
          if (st.curve) state.curve = st.curve;
          sink(f.id, { at: now(), state });
        }
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
            case "intensity": {
              w.intensity = cmd.value;
              const effect = running.get(fx.id);
              if (effect) { white.set(fx.id, w); return write(effectFrame(fx.address, effect.id, w.intensity, effectSettingsOf(effect.id, effect.settings))); }
              break;
            }
            case "cct": w.kelvin = cmd.kelvin; w.gm = cmd.gm; running.delete(fx.id); break;
            case "curve": w.curve = cmd.curve; running.delete(fx.id); break;
            case "effect":
              white.set(fx.id, w);
              if (cmd.effect) {
                running.set(fx.id, { id: cmd.effect, settings: cmd.settings });
                await write(effectFrame(fx.address, cmd.effect, w.intensity, effectSettingsOf(cmd.effect, cmd.settings)));
              } else {
                running.delete(fx.id);
                await write(whiteFrame(fx.address, w));
              }
              return write(stateQuery(fx.address));
            case "smooth": return write(smoothFrame(fx.address, cmd.on));
            case "status": return write(stateQuery(fx.address));
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
