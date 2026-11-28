/**
 * The Hardware extension's channel on the phone link (docs/rewrite/08-extensions.md, "One live link, with
 * channels"). The core relays it unread; the phone checks every request it acts on (parseHardwareRequest),
 * the Studio is trusted no more than any client. It replaces the first app's `lights.*` messages, which rode
 * on the layout preview's room.
 */
import { parseClaim, type HardwareClaim } from "./passive.ts";
import { parseLightCommand, type FixtureLive, type LightCommand, type ScannedDevice, type ProvisionStage } from "./lightProxy.ts";

export const HARDWARE_CHANNEL = "hardware";

/**
 * Studio (or another phone) → the proxy phone. `hello` asks for its state now; `sync` makes it read the device
 * list again (a device was added, renamed, put to sleep or removed); `reconnect` drops every connection and
 * connects again one by one; `scan` starts or stops a scan for nearby devices; `provision` pairs a mesh light
 * into the phone's network or runs its setup again (`fresh`: after a reset, a new address).
 */
export type HardwareRequest =
  | { type: "command"; device: string; command: LightCommand }
  | { type: "hello" }
  | { type: "sync" }
  | { type: "reconnect" }
  | { type: "scan"; on: boolean }
  | { type: "provision"; device: string; fresh?: boolean }
  /** What a client holds (passive.ts), by its own random id: its hand control, its flows' lights. */
  | ({ type: "claim"; client: string } & HardwareClaim);

/** The proxy phone → every Studio and phone, on every change (a few times a second at most) and on `hello`. */
export interface HardwareState {
  type: "state";
  /** The phone's device id and name. */
  phone: { id: string; name: string };
  /** The proxy switch is on: the phone holds every awake device and takes commands. */
  proxy: boolean;
  devices: FixtureLive[];
}
export interface HardwareScan { type: "scan.state"; phase: "idle" | "scanning" | "done" | "error"; message?: string; found: ScannedDevice[] }
export interface HardwareProvision { type: "provision.state"; device: string; phase: "running" | "done" | "error"; stage: ProvisionStage | null; resume: boolean; error?: string }
export type HardwareReport = HardwareState | HardwareScan | HardwareProvision;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** A request from the wire, or null when it is malformed. */
export function parseHardwareRequest(v: unknown): HardwareRequest | null {
  if (!v || typeof v !== "object") return null;
  const m = v as Record<string, unknown>;
  switch (m.type) {
    case "hello": case "sync": case "reconnect": return { type: m.type };
    case "scan": return typeof m.on === "boolean" ? { type: "scan", on: m.on } : null;
    case "claim": { if (typeof m.client !== "string" || !/^[A-Za-z0-9_-]{6,64}$/.test(m.client)) return null; const c = parseClaim(m); return c ? { type: "claim", client: m.client, ...c } : null; }
    case "provision": return typeof m.device === "string" && UUID.test(m.device) ? { type: "provision", device: m.device, ...(m.fresh === true ? { fresh: true } : {}) } : null;
    case "command": {
      if (typeof m.device !== "string" || !UUID.test(m.device)) return null;
      const command = parseLightCommand(m.command);
      return command ? { type: "command", device: m.device, command } : null;
    }
    default: return null;
  }
}

/** Reports of a change made here are ignored this long, so a slider does not jump back while the light catches up. */
export const REPORT_HOLD_MS = 1500;
