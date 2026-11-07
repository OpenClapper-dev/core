/**
 * Lights (epic #206): the fixture kinds the phone can control over Bluetooth, and what each can do.
 * Shared because the Worker validates a fixture's kind and the keyframe sequences (later) are
 * planned against these capabilities in the Studio as well as on the phone. How a kind is reached
 * (codecs, GATT services, mesh) lives with the phone's drivers (apps/mobile/src/fixtures).
 */

/** The four dimming curves both makers' apps offer; also the easing between keyframes later. */
export const CURVES = ["linear", "exp", "log", "s"] as const;
export type Curve = (typeof CURVES)[number];

/**
 * Built-in effects with their makers' default settings (#291). The first-generation set is what
 * Sidus Link offers for the Aputure MC.
 */
export const EFFECTS = [
  { id: "club_lights", name: "Club lights" }, { id: "paparazzi", name: "Paparazzi" }, { id: "lightning", name: "Lightning" },
  { id: "tv", name: "TV" }, { id: "candle", name: "Candle" }, { id: "fire", name: "Fire" }, { id: "strobe", name: "Strobe" },
  { id: "explosion", name: "Explosion" }, { id: "faulty_bulb", name: "Faulty bulb" }, { id: "pulsing", name: "Pulsing" },
  { id: "welding", name: "Welding" }, { id: "cop_car", name: "Cop car" }, { id: "color_chase", name: "Color chase" },
  { id: "party_lights", name: "Party lights" }, { id: "fireworks", name: "Fireworks" },
] as const;
export type EffectId = (typeof EFFECTS)[number]["id"];
export const effectName = (id: EffectId) => EFFECTS.find((e) => e.id === id)?.name ?? id;

/**
 * The effects the MC offers (owner's MC, 2026-11-07): the other six first-generation effects are
 * not on it. Kept in the order of EFFECTS.
 */
const MC_EFFECTS: readonly EffectId[] = ["paparazzi", "lightning", "tv", "fire", "pulsing", "faulty_bulb", "cop_car", "party_lights", "fireworks"];

/** Read-only values a fixture reports (the battery). */
export const TELEMETRY_FIELDS = ["battery", "volts", "amps", "watts", "minutesLeft"] as const;
export type TelemetryField = (typeof TELEMETRY_FIELDS)[number];

export interface Capabilities {
  power: boolean;
  /** Intensity 0..1. */
  intensity: boolean;
  /** White light in kelvin, with a green/magenta shift in the fixture's own steps (null = none). */
  cct: { min: number; max: number; gm: { min: number; max: number } | null } | null;
  /** Hue 0..360, saturation and intensity 0..1. */
  hsi: boolean;
  /** The fixture's own dimming-curve setting. */
  curves: boolean;
  telemetry: readonly TelemetryField[];
  /** Built-in effects it runs (EFFECTS ids). */
  effects?: readonly EffectId[];
  /** A battery's rated energy, for the time-left estimate. */
  capacityWh?: number;
}

/** "gatt": the phone talks to the fixture itself; "mesh": through a Bluetooth Mesh network the phone provisions. */
export type FixtureTransport = "gatt" | "mesh";

export interface FixtureKind {
  id: string;
  brand: string;
  model: string;
  transport: FixtureTransport;
  /** The phone's driver for it (apps/mobile/src/fixtures/registry.ts). */
  driver: string;
  caps: Capabilities;
}

const LIGHT = { power: true, intensity: true, hsi: false, curves: true, telemetry: [] } as const;

/**
 * Every supported fixture. Hardcoded on purpose: a new model is one entry here and one driver file
 * on the phone. Ids are stored with each fixture, so they never change.
 */
export const FIXTURE_KINDS: readonly FixtureKind[] = [
  // Bi-colour COB lights of NEEWER's "Infinity" app (#209).
  { id: "neewer-fs230b", brand: "NEEWER", model: "FS230B", transport: "gatt", driver: "neewer-infinity", caps: { ...LIGHT, cct: { min: 2700, max: 6500, gm: null } } },
  // Green/magenta in the frame's own steps (−50..+50, sent as +50); the FS230B's app has no control for it.
  { id: "neewer-fs300b", brand: "NEEWER", model: "FS300B", transport: "gatt", driver: "neewer-infinity", caps: { ...LIGHT, cct: { min: 2700, max: 6500, gm: { min: -50, max: 50 } } } },
  // V-mount battery in the same app: telemetry only (#210). It reports no time left: the phone estimates it from capacityWh.
  {
    id: "neewer-ps099s", brand: "NEEWER", model: "PS099S", transport: "gatt", driver: "neewer-battery",
    caps: { power: false, intensity: false, cct: null, hsi: false, curves: false, telemetry: ["battery", "volts", "amps", "watts", "minutesLeft"], capacityWh: 99 },
  },
  // Sidus Mesh RGBWW. No green/magenta (the light has none, though the white command carries the
  // field: sent neutral); its dimming curve is its own command (#289). Its built-in
  // battery reports charge, voltage and its own time left (#293).
  { id: "aputure-mc", brand: "Aputure", model: "MC", transport: "mesh", driver: "sidus-mesh", caps: { ...LIGHT, cct: { min: 3200, max: 6500, gm: null }, hsi: true, curves: true, telemetry: ["battery", "volts", "minutesLeft"], effects: MC_EFFECTS } },
];

export const fixtureKind = (id: string): FixtureKind | undefined => FIXTURE_KINDS.find((k) => k.id === id);
export const fixtureKindName = (k: FixtureKind) => `${k.brand} ${k.model}`;

/** What a light shows; every part optional (a command or a keyframe sets only some). */
export interface LightState {
  power?: boolean;
  intensity?: number;
  cct?: { kelvin: number; gm: number };
  hsi?: { h: number; s: number; i: number };
  /** The fixture's own dimming curve (NEEWER: part of every white-light command). */
  curve?: Curve;
  /** A running built-in effect; null when the light shows plain white or colour. */
  effect?: EffectId | null;
}

/**
 * What the phone assumes until it has set a value itself: the lights report nothing back yet.
 * Half intensity, the middle of the white range (to 100 K), linear curve.
 */
export function startState(k: FixtureKind): LightState {
  const cct = k.caps.cct;
  return {
    intensity: 0.5,
    ...(cct ? { cct: { kelvin: Math.round((cct.min + cct.max) / 200) * 100, gm: 0 } } : {}),
    ...(k.caps.curves ? { curve: "linear" as const } : {}),
  };
}

export const FIXTURE_LABEL_MAX = 60;
/** The highest unicast address of a Bluetooth Mesh network. */
export const MESH_UNICAST_MAX = 0x7fff;

/** A Bluetooth device address as Android reports it ("AA:BB:CC:DD:EE:FF"). */
export const isBleAddress = (v: unknown): v is string => typeof v === "string" && /^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/.test(v);
