import { CCU_TYPE, type CameraTelemetry, type CcuMessage } from "./cameraControl.ts";
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
  /** Smooth changes (the light eases between values by itself) or instant ones; kinds with `caps.smoothing`. */
  | { op: "smooth"; on: boolean }
  /**
   * The light fades by itself to the target over `ms` with `curve`, then holds it (#289; kinds with
   * `caps.fade`). White or colour optional: without them it keeps its light and fades only intensity.
   */
  | { op: "fade"; ms: number; curve: Curve; intensity: number; white?: { kelvin: number; gm: number }; colour?: { h: number; s: number } }
  /** A camera control message (#318), for kinds with `caps.camera`. */
  | { op: "ccu"; message: CcuMessage }
  | { op: "status" };

/** The longest native fade: the MC counts tenths of a second in 8 bits. */
export const FADE_MAX_MS = 25_500;

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
  /** A camera's reported parameters, timecode and status (#318). */
  camera?: CameraTelemetry;
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
  if (s.ember != null) { if (!num(s.ember, 1, 10)) return null; out.ember = s.ember; }
  for (const k of ["intensityMin", "intensityMax"] as const) if (s[k] != null) { if (!num(s[k], 0, 1)) return null; out[k] = s[k]; }
  if (s.kelvinMax != null) { if (!num(s.kelvinMax, 1000, 20000)) return null; out.kelvinMax = s.kelvinMax; }
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
    case "ccu": { const m = parseCcu(c.message); return m ? { op: "ccu", message: m } : null; }
    case "smooth": return typeof c.on === "boolean" ? { op: "smooth", on: c.on } : null;
    case "fade": {
      if (!num(c.ms, 0, FADE_MAX_MS) || !(CURVES as readonly unknown[]).includes(c.curve) || !num(c.intensity, 0, 1)) return null;
      const out: LightCommand = { op: "fade", ms: c.ms, curve: c.curve as Curve, intensity: c.intensity };
      const w = c.white as Record<string, unknown> | undefined, col = c.colour as Record<string, unknown> | undefined;
      if (w != null) { if (typeof w !== "object" || !num(w.kelvin, 1000, 20000) || !num(w.gm, -50, 50)) return null; out.white = { kelvin: w.kelvin, gm: w.gm }; }
      if (col != null) { if (typeof col !== "object" || !num(col.h, 0, 360) || !num(col.s, 0, 1)) return null; out.colour = { h: col.h, s: col.s }; }
      return out;
    }
    case "status": return { op: "status" };
    default: return null;
  }
}

const CCU_TYPES = new Set<number>(Object.values(CCU_TYPE));
const INT_RANGE: Record<number, [number, number]> = { 0: [0, 1], 1: [-128, 127], 2: [-32768, 32767], 3: [-2147483648, 2147483647], 4: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER], 128: [-16, 15.9995] };

/** A camera control message from the wire (#318): known type, values in the type's range, at most 16 values or 60 characters. */
function parseCcu(v: unknown): CcuMessage | null {
  if (!v || typeof v !== "object") return null;
  const m = v as Record<string, unknown>;
  if (!num(m.category, 0, 255) || !num(m.parameter, 0, 255) || !Number.isInteger(m.category) || !Number.isInteger(m.parameter)) return null;
  if (typeof m.type !== "number" || !CCU_TYPES.has(m.type) || (m.operation !== 0 && m.operation !== 1)) return null;
  if (typeof m.data === "string") return m.type === CCU_TYPE.string && m.data.length <= 60 ? { category: m.category, parameter: m.parameter, type: m.type as CcuMessage["type"], operation: m.operation, data: m.data } : null;
  if (!Array.isArray(m.data) || m.data.length > 16 || m.type === CCU_TYPE.string) return null;
  const [lo, hi] = INT_RANGE[m.type];
  if (!m.data.every((x) => num(x, lo, hi))) return null;
  return { category: m.category, parameter: m.parameter, type: m.type as CcuMessage["type"], operation: m.operation, data: m.data as number[] };
}
