import {
  BMD_DEVICE_NAME, BMD_INCOMING, BMD_OUTGOING, BMD_PROTOCOL_VERSION, BMD_SERVICE, BMD_STATUS, BMD_TIMECODE, ccuKey, decodeCcu, encodeCcu, timecodeOf,
  type CameraTelemetry,
} from "@openclapper/vocab";
import { toHex } from "../bytes.ts";
import type { Command, Driver, Fixture, Link, Session, Telemetry } from "../types.ts";

/** How often the camera's state goes to the hub at most: the timecode alone changes every frame. */
export const REPORT_EVERY_MS = 250;
/** Incoming messages kept for the Studio's probe log. */
const LOG_SIZE = 40;
/** Per-output values set through the phone, per fixture; kept across reconnects (CameraTelemetry.outputs). */
const OUTPUTS = new Map<string, Record<string, Record<number, number>>>();
const PER_OUTPUT = new Set(["4.1", "3.0"]);

/** The name the camera lists in its Bluetooth menu. */
export const DEVICE_NAME = "OpenClapper";

export interface BmdOptions {
  log?: (level: "debug" | "info" | "warn", event: string, data?: unknown) => void;
  now?: () => number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (h: unknown) => void;
}

/**
 * Blackmagic cameras over Bluetooth (#318), the Pocket 4K/6K family: Blackmagic's camera control
 * protocol. On connect: read the protocol version, name ourselves, write "power on" to Camera Status
 * (the first write to an encrypted characteristic starts bonding: the camera shows a 6-digit PIN,
 * Android asks for it on the phone, once), then follow Incoming (every parameter the camera reports),
 * Timecode and Status. Commands are `ccu` messages, written as they come.
 */
export function bmdCamera(o: BmdOptions = {}): Driver {
  const log = o.log ?? (() => {});
  const now = o.now ?? (() => Date.now());
  const every = o.setInterval ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
  const stopEvery = o.clearInterval ?? ((h: unknown) => clearInterval(h as ReturnType<typeof setInterval>));
  return {
    id: "bmd-camera",
    linkKey: (f) => f.address,
    rate: { minIntervalMs: 40 },
    addressesFor: (key) => [key],
    async open(link: Link, fixtures: Fixture[], sink: (id: string, t: Telemetry) => void): Promise<Session> {
      const f = fixtures.find((x) => x.address === link.address) ?? fixtures[0];
      const outputs = f ? OUTPUTS.get(f.id) ?? {} : {};
      if (f) OUTPUTS.set(f.id, outputs);
      const cam: CameraTelemetry = { params: {}, log: [], outputs };
      /** [bits, targets]: every target display bit in targets takes bits. */
      const setOutputs = (key: string, data: number[]) => {
        const [bits, targets] = data;
        if (bits == null || targets == null) return;
        const byTarget = (outputs[key] ??= {});
        for (let bit = 1; bit <= 0x10; bit <<= 1) if (targets & bit) byTarget[bit] = bits;
        dirty = true;
      };
      let dirty = true;
      const report = () => {
        if (!dirty || !f) return;
        dirty = false;
        sink(f.id, { at: now(), camera: { ...cam, params: { ...cam.params }, log: [...cam.log], outputs: structuredClone(outputs) } });
      };
      try {
        const v = await link.read?.(BMD_SERVICE, BMD_PROTOCOL_VERSION);
        if (v?.length) cam.protocolVersion = new TextDecoder().decode(v).replace(/\0+$/, "");
        log("info", "bmd: protocol version", { fixture: f?.id, version: cam.protocolVersion, bytes: v ? toHex(v) : null });
      } catch (e) { log("info", "bmd: protocol version not read", { error: e }); }
      try { await link.write(BMD_SERVICE, BMD_DEVICE_NAME, new TextEncoder().encode(DEVICE_NAME), true); } catch (e) { log("info", "bmd: device name not written", { error: e }); }
      // Wakes the camera; as the first encrypted write it also starts bonding (Android's PIN dialog).
      await link.write(BMD_SERVICE, BMD_STATUS, Uint8Array.of(0x01), true);
      const offs = [
        await link.notify(BMD_SERVICE, BMD_INCOMING, (b) => {
          const msgs = decodeCcu(b);
          for (const m of msgs) {
            const key = ccuKey(m.category, m.parameter);
            cam.params[key] = m.data;
            // Should a firmware report them with a target after all, that is the truth.
            if (PER_OUTPUT.has(key) && Array.isArray(m.data)) setOutputs(key, m.data);
            cam.log.unshift(`${m.category}.${m.parameter} t${m.type} op${m.operation}: ${typeof m.data === "string" ? JSON.stringify(m.data) : `[${m.data.join(", ")}]`}`);
          }
          if (!msgs.length) cam.log.unshift(`? ${toHex(b)}`);
          cam.log.length = Math.min(cam.log.length, LOG_SIZE);
          log("debug", "bmd: incoming", { fixture: f?.id, bytes: toHex(b) });
          dirty = true;
        }),
        await link.notify(BMD_SERVICE, BMD_TIMECODE, (b) => { const tc = timecodeOf(b); if (tc && tc !== cam.timecode) { cam.timecode = tc; dirty = true; } }),
        await link.notify(BMD_SERVICE, BMD_STATUS, (b) => { if (b.length) { cam.status = b[0]; dirty = true; log("info", "bmd: status", { fixture: f?.id, status: b[0] }); } }),
      ];
      const timer = every(report, REPORT_EVERY_MS);
      report();
      return {
        async send(_fx: Fixture, cmd: Command) {
          if (cmd.op === "status") { dirty = true; return; }
          if (cmd.op !== "ccu") throw new Error(`a camera has no ${cmd.op}`);
          const bytes = encodeCcu(cmd.message);
          log("debug", "bmd: write", { bytes: toHex(bytes) });
          await link.write(BMD_SERVICE, BMD_OUTGOING, bytes, true);
          const key = ccuKey(cmd.message.category, cmd.message.parameter);
          if (PER_OUTPUT.has(key) && cmd.message.operation === 0 && Array.isArray(cmd.message.data)) setOutputs(key, cmd.message.data);
        },
        async close() { stopEvery(timer); for (const off of offs) off(); },
      };
    },
  };
}
