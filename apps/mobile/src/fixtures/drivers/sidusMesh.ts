import { bytes } from "../mesh/crypto.ts";
import { MeshSession, type NetworkKeys } from "../mesh/session.ts";
import type { SeqAllocator } from "../mesh/seq.ts";
import { batteryRequest, cct, curve, effect, effectOff, hsi, intensity, parseBattery, parseEffect, parseStatus, power, statusRequest, TELINK_OPCODE } from "../codecs/sidus.ts";
import type { Command, Driver, Fixture, Link, Session, Telemetry } from "../types.ts";
import type { EffectId, EffectSettings, LightState } from "@openclapper/vocab";

/** What the driver needs of a network, supplied by the app (fixtures/meshNetworks.ts) or a test. */
export interface MeshAccess {
  keysFor(networkId: string): { keys: NetworkKeys; seq: SeqAllocator; onIvIndex(iv: number): void } | null;
}

export interface SidusOptions {
  access: () => MeshAccess | null;
  log?: (level: "debug" | "info" | "warn", event: string, data?: unknown) => void;
  /**
   * How often each command goes out. Commands are unacknowledged and lights farther away get them
   * relayed over the air, where one can be lost; the reference client sends three.
   */
  repeats?: number;
  repeatGapMs?: number;
  wait?: (ms: number) => Promise<void>;
  setupWaitMs?: number;
  /** How often lights with a built-in battery are asked for it while connected (#293). */
  batteryPollMs?: number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (h: unknown) => void;
}

/** Intensity is part of white and colour commands: what the phone last set or the light last said. */
interface Last { intensity: number; kelvin: number; gm: number }

/**
 * Aputure lights over the phone's mesh (#213): one session per network through whichever light is
 * reached first, which relays for the others. Commands are Telink 0x26 messages to the light's
 * primary address with the network's application key; the lights' status reports come back as
 * telemetry, so the screen shows what the light really does.
 */
export function sidusMesh(o: SidusOptions): Driver {
  const wait = o.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const repeats = Math.max(1, o.repeats ?? 2);
  return {
    id: "sidus-mesh",
    linkKey: (f) => (f.mesh ? `mesh:${f.mesh.networkId}` : `unpaired:${f.id}`),
    rate: { minIntervalMs: 120 },
    // Any light of the network can be the proxy; unpaired ones cannot.
    addressesFor: (_key, fixtures) => fixtures.filter((f) => f.mesh).map((f) => f.address),
    async open(link: Link, fixtures: Fixture[], sink: (id: string, t: Telemetry) => void): Promise<Session> {
      const networkId = fixtures.find((f) => f.mesh)?.mesh?.networkId;
      const net = networkId ? o.access()?.keysFor(networkId) : null;
      if (!networkId || !net) throw new Error("this light's network keys are not on this phone");
      const session = new MeshSession(link, net.keys, net.seq, { log: o.log, onIvIndex: net.onIvIndex, setupWaitMs: o.setupWaitMs });
      await session.start();
      const byUnicast = new Map(fixtures.filter((f) => f.mesh).map((f) => [f.mesh!.unicast, f]));
      const last = new Map<string, Last>();
      /** The effect each light runs (#291): intensity changes re-send it rather than a plain intensity. */
      const running = new Map<string, { id: EffectId; settings?: EffectSettings } | null>();
      const lastOf = (f: Fixture) => last.get(f.id) ?? { intensity: 0.5, kelvin: 5600, gm: 0 };
      const app = { kind: "app" as const, key: net.keys.appKey, aid: net.keys.aid };

      const stopListening = session.onMessage((r) => {
        const f = byUnicast.get(r.src);
        if (!f || r.access.opcode !== TELINK_OPCODE) return;
        const bat = parseBattery(r.access.params);
        if (bat) { sink(f.id, { at: Date.now(), battery: bat.charge, volts: bat.volts, minutesLeft: bat.minutesLeft, plugged: bat.plugged }); return; }
        const fx = parseEffect(r.access.params);
        if (fx) {
          running.set(f.id, fx.effect ? { id: fx.effect, settings: fx.settings } : null);
          sink(f.id, { at: Date.now(), state: fx.effect ? { power: fx.on, intensity: fx.intensity, effect: fx.effect, ...(fx.settings ? { effectSettings: fx.settings } : {}) } : { effect: null } });
          return;
        }
        const st = parseStatus(r.access.params);
        if (!st) return;
        const state: LightState = { power: st.on, intensity: st.intensity };
        if (st.mode === "cct") state.cct = { kelvin: st.kelvin!, gm: st.gm! };
        else state.hsi = { h: st.hue!, s: st.saturation!, i: st.intensity };
        state.effect = null;
        running.set(f.id, null);
        last.set(f.id, { intensity: st.intensity, kelvin: st.kelvin ?? lastOf(f).kelvin, gm: st.gm ?? lastOf(f).gm });
        sink(f.id, { at: Date.now(), state });
      });

      const toLight = async (f: Fixture, payload: Uint8Array, times = repeats) => {
        if (!f.mesh) throw new Error("this light is not on the phone's mesh");
        for (let i = 0; i < times; i++) {
          if (i) await wait(o.repeatGapMs ?? 40);
          await session.send({ dst: f.mesh.unicast, access: bytes([TELINK_OPCODE], payload), key: app });
        }
      };

      // Ask every light of the network what it shows, and its battery; the battery again every minute.
      for (const f of byUnicast.values()) await toLight(f, statusRequest(), 1);
      const askBatteries = async () => { for (const f of byUnicast.values()) await toLight(f, batteryRequest(), 1).catch((e) => o.log?.("debug", "mesh: battery request failed", { fixture: f.id, error: e })); };
      await askBatteries();
      const every = o.setInterval ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
      const stopEvery = o.clearInterval ?? ((h: unknown) => clearInterval(h as ReturnType<typeof setInterval>));
      const timer = every(() => { void askBatteries(); }, o.batteryPollMs ?? 60_000);

      return {
        async send(f: Fixture, cmd: Command) {
          const l = lastOf(f);
          switch (cmd.op) {
            case "power": return toLight(f, power(cmd.on));
            case "intensity": {
              last.set(f.id, { ...l, intensity: cmd.value });
              const fx = running.get(f.id);
              return toLight(f, fx ? effect(fx.id, cmd.value, fx.settings) : intensity(cmd.value));
            }
            // White or colour leaves a running effect, as in the maker's app.
            case "cct": last.set(f.id, { ...l, kelvin: cmd.kelvin, gm: cmd.gm }); running.set(f.id, null); return toLight(f, cct(cmd.kelvin, l.intensity, cmd.gm));
            case "hsi": last.set(f.id, { ...l, intensity: cmd.i }); running.set(f.id, null); return toLight(f, hsi(cmd.h, cmd.s, cmd.i));
            case "effect":
              running.set(f.id, cmd.effect ? { id: cmd.effect, settings: cmd.settings } : null);
              if (cmd.effect) return toLight(f, effect(cmd.effect, l.intensity, cmd.settings));
              await toLight(f, effectOff());
              // The light returns to white: ask what it shows now.
              return toLight(f, statusRequest(), 1);
            case "status": return toLight(f, statusRequest(), 1);
            case "curve": return toLight(f, curve(cmd.curve));
            case "trigger": {
              const fx = running.get(f.id);
              // Once only: a repeat would strike twice.
              return fx ? toLight(f, effect(fx.id, l.intensity, fx.settings, true), 1) : undefined;
            }
            default: throw new Error("unknown command");
          }
        },
        async close() { stopEvery(timer); stopListening(); await session.close(); },
      };
    },
  };
}
