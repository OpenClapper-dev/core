import { CURVES, EFFECTS, type Curve, type EffectId, type EffectSettings, type LightState } from "./lighting.ts";

/**
 * The light proxy (#307): the phone keeps the Bluetooth connections and runs the drivers; the Studio
 * controls the lights through the per-user phone room (apps/worker/src/preview.ts). These are the
 * messages both sides agree on. The phone validates every command it receives (parseLightCommand):
 * the Studio is trusted no more than any client.
 */

/** One change to a fixture, in normalised units: intensity and saturation 0..1, hue 0..360, kelvin, G/M −50..50. */
export type LightCommand =
  | { op: "power"; on: boolean }
  | { op: "intensity"; value: number }
  | { op: "cct"; kelvin: number; gm: number }
  | { op: "hsi"; h: number; s: number; i: number }
  | { op: "curve"; curve: Curve }
  /** Run a built-in effect at the current intensity, or stop it (null). */
  | { op: "effect"; effect: EffectId | null; settings?: EffectSettings }
  /** Fire the running effect once now (Lightning's strike). */
  | { op: "trigger" }
  | { op: "status" };

/** What a fixture reported last; `state` is what a light says it shows. */
export interface Telemetry {
  at: number;
  battery?: number;
  volts?: number;
  /** Current drawn; the battery reports this, watts are volts × amps. */
  amps?: number;
  watts?: number;
  minutesLeft?: number;
  /** A battery feeding a load. */
  discharging?: boolean;
  /** A light with a built-in battery runs on an external supply. */
  plugged?: boolean;
  state?: LightState;
}

export type LinkState = "off" | "connecting" | "ready" | "retrying" | "failed";

/** One fixture as the proxy sees it. */
export interface FixtureLive {
  id: string;
  link: LinkState;
  /** Failed connection attempts in a row. */
  attempt: number;
  error: string | null;
  telemetry: Telemetry | null;
  /** What the phone last set or the fixture last reported. */
  state: LightState;
}

/** Phone → Studio, on every change (at most a few times a second) and when asked. */
export interface ProxyState {
  type: "lights.state";
  /** The phone's device id and model, so the Studio can name it. */
  phone: { id: string; model: string | null };
  /** Proxy mode on: the phone holds every paired fixture and takes commands. */
  proxy: boolean;
  fixtures: FixtureLive[];
}

/**
 * Studio → phone. `lights.hello` asks the proxy for its state now (a Studio tab just opened);
 * `lights.sync` makes it re-read the fixture list (the Studio added, renamed or deleted one through
 * the API); `lights.scan` starts or stops a scan for nearby devices; `lights.provision` pairs a mesh
 * fixture with the phone's network, or runs its setup again (`fresh`: after a reset, a new address).
 */
export type ProxyRequest =
  | { type: "lights.command"; fixtureId: string; command: LightCommand }
  | { type: "lights.hello" }
  | { type: "lights.sync" }
  | { type: "lights.scan"; on: boolean }
  | { type: "lights.provision"; fixtureId: string; fresh?: boolean };

/** A device the phone's scan found; `kinds` are the models it looks like (best first). */
export interface ScannedDevice { address: string; name: string | null; rssi: number | null; kinds: string[] }

/** Phone → Studio while scanning (10 s per scan), at most every few hundred ms. */
export interface ScanState {
  type: "lights.scan.state";
  phase: "idle" | "scanning" | "done" | "error";
  message?: string;
  found: ScannedDevice[];
}

/** The steps of pairing a mesh light; a resume (provisioned earlier, not configured) runs only the last two. */
export const PROVISION_STAGES = ["find", "invite", "keys", "confirm", "data", "reconnect", "configure"] as const;
export type ProvisionStage = (typeof PROVISION_STAGES)[number];
export const PROVISION_STAGE_LABELS: Record<ProvisionStage, string> = {
  find: "Find the light",
  invite: "Invite it",
  keys: "Exchange keys",
  confirm: "Confirm both sides",
  data: "Send the network key and address",
  reconnect: "Reconnect through its proxy",
  configure: "Configure it",
};

/** Phone → Studio while pairing a mesh light. */
export interface ProvisionState {
  type: "lights.provision.state";
  fixtureId: string;
  phase: "running" | "done" | "error";
  stage: ProvisionStage | null;
  /** Only reconnect + configure: the light was provisioned before. */
  resume: boolean;
  error?: string;
}

const num = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const EFFECT_IDS = new Set<string>(EFFECTS.map((e) => e.id));

function parseSettings(v: unknown): EffectSettings | null {
  if (v == null) return {};
  if (typeof v !== "object") return null;
  const s = v as Record<string, unknown>, out: EffectSettings = {};
  for (const k of ["frequency", "speed"] as const) if (s[k] != null) { if (!num(s[k], 1, 11)) return null; out[k] = s[k]; }
  if (s.kelvin != null) { if (!num(s.kelvin, 1000, 20000)) return null; out.kelvin = s.kelvin; }
  if (s.saturation != null) { if (!num(s.saturation, 0, 1)) return null; out.saturation = s.saturation; }
  if (s.choice != null) { if (!num(s.choice, 0, 31) || !Number.isInteger(s.choice)) return null; out.choice = s.choice; }
  if (s.color != null) {
    const c = s.color as Record<string, unknown>;
    if (typeof c !== "object") return null;
    if ("kelvin" in c) { if (!num(c.kelvin, 1000, 20000)) return null; out.color = { kelvin: c.kelvin }; }
    else { if (!num(c.h, 0, 360) || !num(c.s, 0, 1)) return null; out.color = { h: c.h, s: c.s }; }
  }
  return out;
}

/** A command from the wire, or null when it is malformed or out of range. Ranges are the widest any kind takes; drivers clamp to their own. */
export function parseLightCommand(v: unknown): LightCommand | null {
  if (!v || typeof v !== "object") return null;
  const c = v as Record<string, unknown>;
  switch (c.op) {
    case "power": return typeof c.on === "boolean" ? { op: "power", on: c.on } : null;
    case "intensity": return num(c.value, 0, 1) ? { op: "intensity", value: c.value } : null;
    case "cct": return num(c.kelvin, 1000, 20000) && num(c.gm, -50, 50) ? { op: "cct", kelvin: c.kelvin, gm: c.gm } : null;
    case "hsi": return num(c.h, 0, 360) && num(c.s, 0, 1) && num(c.i, 0, 1) ? { op: "hsi", h: c.h, s: c.s, i: c.i } : null;
    case "curve": return (CURVES as readonly unknown[]).includes(c.curve) ? { op: "curve", curve: c.curve as Curve } : null;
    case "effect": {
      if (c.effect === null) return { op: "effect", effect: null };
      if (typeof c.effect !== "string" || !EFFECT_IDS.has(c.effect)) return null;
      // No settings means the effect's defaults, as from the phone's own screen.
      if (c.settings == null) return { op: "effect", effect: c.effect as EffectId };
      const settings = parseSettings(c.settings);
      return settings ? { op: "effect", effect: c.effect as EffectId, settings } : null;
    }
    case "trigger": return { op: "trigger" };
    case "status": return { op: "status" };
    default: return null;
  }
}
