/**
 * The catalogue of supported hardware (docs/rewrite/08-extensions.md): brand → model → type, and what each model
 * exposes, declared as data so the Studio and the phone draw the same controls from it (step B9, owner's decision
 * 2026-11-24). A control says what it looks like (a switch, a range, a choice…) and how it binds: which value of
 * the device's live state it shows and which command a change sends. How a model is reached over the air
 * (codecs, GATT, mesh) stays with the phone's drivers; FIXTURE_KINDS (lighting.ts) carries their capabilities.
 */
import { CCU_TYPE, TARGET_DISPLAYS, TOOL_BITS, type CcuType } from "./cameraControl.ts";
import { CURVES, EFFECTS, TRIGGER_EFFECTS, fixtureKind, type FixtureKind, type LightState } from "./lighting.ts";
import type { FixtureLive, LightCommand } from "./lightProxy.ts";

/** The device types the extension brings to the core's registry (phones and tablets are the core's). */
export const HARDWARE_TYPES = ["light", "battery", "camera", "transmitter"] as const;
export type HardwareType = (typeof HARDWARE_TYPES)[number];
export const TYPE_LABELS: Record<HardwareType, { label: string; plural: string }> = {
  light: { label: "Light", plural: "Lights" },
  battery: { label: "Battery", plural: "Batteries" },
  camera: { label: "Camera", plural: "Cameras" },
  transmitter: { label: "Video transmitter", plural: "Video transmitters" },
};

/** "gatt": the phone talks to the device itself; "mesh": through the phone's Bluetooth Mesh network; "wifi": the phone joins the device's own network. */
export type Transport = "gatt" | "mesh" | "wifi";

/** Where a part works (U6): a transmitter's picture comes over its own Wi-Fi, which only the phone joins. */
export type Where = "everywhere" | "phone";

interface Base {
  id: string;
  label: string;
  /** The section it sits in, in the order of first appearance. */
  group: string;
  where?: Where;
  /** A line of help under it. */
  hint?: string;
}
export type Control =
  | Base & { kind: "switch" }
  | Base & { kind: "range"; min: number; max: number; step: number; format: Format }
  | Base & { kind: "choice"; options: readonly { value: number; label: string }[]; display: "select" | "segmented" }
  | Base & { kind: "number"; min: number; max: number; unit?: string }
  | Base & { kind: "text"; maxLength: number }
  | Base & { kind: "button"; icon?: string; tone?: "primary" | "danger" | "secondary" }
  /** A light's colour: hue 0..360 and saturation 0..1, at the light's intensity. Drawn by hand on each client. */
  | Base & { kind: "colour" }
  /** A light's built-in effects with their options (EFFECT_OPTIONS). Drawn by hand on each client. */
  | Base & { kind: "effect" }
  /** A camera's monitoring per output (LCD, HDMI): the tools and overlays as a table. Drawn by hand on each client. */
  | Base & { kind: "outputs" };
export type Format = "percent" | "kelvin" | "signed" | "plain" | "degrees" | "focus";

/** A value a device reports. */
export interface StateSpec { id: string; label: string; format: "charge" | "percent" | "volts" | "amps" | "watts" | "minutes" | "text" | "flag" }
/** A stream (U6): a transmitter's picture. */
export interface Feed { id: string; label: string; where: Where }

export interface Model {
  /** Stored with each device; never changes. Equal to its FixtureKind id where it has one. */
  id: string;
  brand: string;
  model: string;
  type: HardwareType;
  transport: Transport;
  controls: readonly Control[];
  /** Groups that start folded (the camera's many sections). */
  folded?: readonly string[];
  states: readonly StateSpec[];
  feeds: readonly Feed[];
  /** A battery can power a light of the kinds that take one. */
  powers?: boolean;
  /** A light without a battery of its own: it runs on a socket or on a battery (U6, Relations). */
  takesBattery?: boolean;
  /** How it is paired, for the person: what to do first. */
  pairing: string;
}

const pct = (id: string, label: string, group: string): Control => ({ id, label, group, kind: "range", min: 0, max: 1, step: 0.01, format: "percent" });

function lightControls(k: FixtureKind): Control[] {
  const c = k.caps;
  const out: Control[] = [{ id: "power", label: "Power", group: "Light", kind: "switch" }, pct("intensity", "Intensity", "Light")];
  if (c.cct) {
    out.push({ id: "kelvin", label: "White", group: "Light", kind: "range", min: c.cct.min, max: c.cct.max, step: 50, format: "kelvin" });
    if (c.cct.gm) out.push({ id: "gm", label: "Green / magenta", group: "Light", kind: "range", min: c.cct.gm.min, max: c.cct.gm.max, step: 1, format: "signed" });
  }
  if (c.hsi) out.push({ id: "colour", label: "Colour", group: "Light", kind: "colour" });
  if (c.effects?.length) out.push({ id: "effect", label: "Effect", group: "Effects", kind: "effect" });
  if (c.effects?.some((e) => TRIGGER_EFFECTS.includes(e))) out.push({ id: "trigger", label: "Strike now", group: "Effects", kind: "button", icon: "sun-high", hint: "Lightning strikes once." });
  if (c.curves) out.push({ id: "curve", label: "Dimming curve", group: "Settings", kind: "choice", display: "segmented", options: CURVES.map((v, i) => ({ value: i, label: CURVE_LABELS[v] })) });
  if (c.smoothing) out.push({ id: "smooth", label: "Smooth changes", group: "Settings", kind: "switch", hint: "The light eases between values by itself; off, it takes them at once." });
  return out;
}
const CURVE_LABELS: Record<(typeof CURVES)[number], string> = { linear: "Linear", exp: "Exponential", log: "Logarithmic", s: "S-curve" };

const BATTERY_STATES: StateSpec[] = [
  { id: "battery", label: "Charge", format: "charge" }, { id: "minutesLeft", label: "Time left", format: "minutes" },
  { id: "volts", label: "Voltage", format: "volts" }, { id: "amps", label: "Current", format: "amps" }, { id: "watts", label: "Output", format: "watts" },
  { id: "discharging", label: "Feeding a load", format: "flag" },
];
const statesOf = (k: FixtureKind): StateSpec[] => BATTERY_STATES.filter((s) => (k.caps.telemetry as readonly string[]).includes(s.id) || (s.id === "discharging" && k.caps.telemetry.includes("watts")))
  .concat(k.id === "aputure-mc" ? [{ id: "plugged", label: "On external power", format: "flag" }] : []);

/* ---------- The Blackmagic camera: every control of the old panel (v0.16.0 CameraPanel.tsx, #318). ---------- */

/** How a camera control reads and writes a CCU parameter: value `index` of `defaults`-shaped data, or a `bit` in it. */
export interface CcuBinding {
  c: number;
  p: number;
  type: CcuType;
  /** The data the parameter carries when the camera has not reported it. */
  defaults: readonly number[];
  index?: number;
  bit?: number;
  /** A shown value is the stored one divided by this (shutter angle in hundredths). */
  scale?: number;
  /** A switch writes these (Record: 2 records, 0 stops), else 1/0. */
  on?: readonly number[];
  off?: readonly number[];
  /** A button sends this data (void commands: []). */
  data?: readonly number[];
  /** A text parameter (scene, names). */
  text?: boolean;
}

const ISO = [100, 125, 160, 200, 250, 320, 400, 500, 640, 800, 1000, 1250, 1600, 2000, 2500, 3200, 4000, 5000, 6400, 8000, 10000, 12800, 16000, 20000, 25600];
const ANGLES = [11.25, 22.5, 45, 60, 90, 120, 144, 150, 172.8, 180, 216, 270, 324, 360];
const opts = (labels: readonly string[], from = 0) => labels.map((label, i) => ({ value: i + from, label }));
/** 10.0: basic codec and variant as the protocol numbers them, packed as codec × 16 + variant. */
export const CODECS: { label: string; v: [number, number] }[] = [
  ...([["Q0", 0], ["Q1", 7], ["Q3", 8], ["Q5", 1], ["3:1", 2], ["5:1", 3], ["8:1", 4], ["12:1", 5]] as const).map(([n, v]) => ({ label: `Blackmagic RAW ${n}`, v: [3, v] as [number, number] })),
  ...([["HQ", 0], ["422", 1], ["LT", 2], ["Proxy", 3]] as const).map(([n, v]) => ({ label: `ProRes ${n}`, v: [2, v] as [number, number] })),
];

type CamControl = Control & { ccu?: CcuBinding };
const cam = (c: CamControl) => c;
const ccu = (c: number, p: number, type: CcuType, defaults: readonly number[], more: Partial<CcuBinding> = {}): CcuBinding => ({ c, p, type, defaults, ...more });
const F = CCU_TYPE.fixed16, I8 = CCU_TYPE.int8, I16 = CCU_TYPE.int16, I32 = CCU_TYPE.int32, B = CCU_TYPE.bool, S = CCU_TYPE.string;

const CC_PARTS = ([["lift", "Lift", 0, -2, 2, 0], ["gamma", "Gamma", 1, -4, 4, 0], ["gain", "Gain", 2, 0, 15.99, 1], ["offset", "Offset", 3, -8, 8, 0]] as const)
  .flatMap(([id, name, p, lo, hi, def]) => (["Red", "Green", "Blue", "Luma"] as const).map((ch, i) => cam({
    id: `cc-${id}-${i}`, label: `${name} ${ch.toLowerCase()}`, group: "Colour correction", kind: "range", min: lo, max: hi, step: 0.01, format: "plain", ccu: ccu(8, p, F, [def, def, def, def], { index: i }),
  })));

export const CAMERA_CONTROLS: readonly CamControl[] = [
  cam({ id: "record", label: "Record", group: "Camera", kind: "switch", ccu: ccu(10, 1, I8, [0, 0, 0, 0, 0], { index: 0, on: [2, 0, 0, 0, 0], off: [0, 0, 0, 0, 0] }) }),
  cam({ id: "still", label: "Still", group: "Camera", kind: "button", icon: "camera", tone: "secondary", ccu: ccu(10, 3, B, [], { data: [] }) }),
  cam({ id: "iso", label: "ISO", group: "Exposure", kind: "choice", display: "select", options: ISO.map((v) => ({ value: v, label: String(v) })), ccu: ccu(1, 14, I32, [800]) }),
  cam({ id: "angle", label: "Shutter angle", group: "Exposure", kind: "choice", display: "select", options: ANGLES.map((v) => ({ value: v, label: `${v}°` })), ccu: ccu(1, 11, I32, [18000], { scale: 100 }) }),
  cam({ id: "speed", label: "Shutter speed", group: "Exposure", kind: "number", min: 1, max: 10000, unit: "1/x", hint: "The camera uses angle or speed as set in its menu.", ccu: ccu(1, 12, I32, [50]) }),
  cam({ id: "ae", label: "Auto exposure", group: "Exposure", kind: "choice", display: "select", options: opts(["Manual trigger", "Iris", "Shutter", "Iris + shutter", "Shutter + iris"]), ccu: ccu(1, 10, I8, [0]) }),
  cam({ id: "wb", label: "White", group: "White balance", kind: "range", min: 2500, max: 10000, step: 50, format: "kelvin", ccu: ccu(1, 2, I16, [5600, 0], { index: 0 }) }),
  cam({ id: "tint", label: "Tint", group: "White balance", kind: "range", min: -50, max: 50, step: 1, format: "signed", ccu: ccu(1, 2, I16, [5600, 0], { index: 1 }) }),
  cam({ id: "awb", label: "Auto white balance", group: "White balance", kind: "button", tone: "secondary", ccu: ccu(1, 3, B, [], { data: [] }) }),
  cam({ id: "awb-restore", label: "Restore auto WB", group: "White balance", kind: "button", tone: "secondary", ccu: ccu(1, 4, B, [], { data: [] }) }),
  cam({ id: "iris", label: "Iris", group: "Lens", kind: "range", min: 0, max: 1, step: 0.01, format: "percent", ccu: ccu(0, 3, F, [0.5]) }),
  cam({ id: "focus", label: "Focus", group: "Lens", kind: "range", min: 0, max: 1, step: 0.005, format: "focus", ccu: ccu(0, 0, F, [0.5]) }),
  cam({ id: "zoom", label: "Zoom", group: "Lens", kind: "range", min: 0, max: 1, step: 0.01, format: "percent", ccu: ccu(0, 8, F, [0]) }),
  cam({ id: "af", label: "Autofocus", group: "Lens", kind: "button", tone: "secondary", ccu: ccu(0, 1, B, [], { data: [] }) }),
  cam({ id: "auto-iris", label: "Auto iris", group: "Lens", kind: "button", tone: "secondary", ccu: ccu(0, 5, B, [], { data: [] }) }),
  cam({ id: "ois", label: "Optical image stabilisation", group: "Lens", kind: "switch", hint: "Iris, focus and zoom need an electronic lens; the values run 0 (open, near, wide) to 1.", ccu: ccu(0, 6, B, [0]) }),
  cam({ id: "dynamic-range", label: "Dynamic range", group: "Image and codec", kind: "choice", display: "segmented", options: opts(["Film", "Video", "Extended video"]), ccu: ccu(1, 7, I8, [0]) }),
  cam({ id: "sharpening", label: "Sharpening", group: "Image and codec", kind: "choice", display: "segmented", options: opts(["Off", "Low", "Medium", "High"]), ccu: ccu(1, 8, I8, [0]) }),
  cam({ id: "codec", label: "Codec", group: "Image and codec", kind: "choice", display: "select", options: CODECS.map((c) => ({ value: c.v[0] * 16 + c.v[1], label: c.label })), ccu: ccu(10, 0, I8, [3, 0]) }),
  cam({ id: "outputs", label: "Monitoring per output", group: "Monitoring", kind: "outputs" }),
  cam({ id: "zebra", label: "Zebra level", group: "Monitoring", kind: "range", min: 0, max: 1, step: 0.01, format: "percent", ccu: ccu(4, 2, F, [0.95]) }),
  cam({ id: "peaking", label: "Peaking level", group: "Monitoring", kind: "range", min: 0, max: 1, step: 0.01, format: "percent", ccu: ccu(4, 3, F, [0.5]) }),
  cam({ id: "fa-method", label: "Focus assist", group: "Monitoring", kind: "choice", display: "select", options: opts(["Peak", "Coloured lines"]), ccu: ccu(4, 5, I8, [0, 0], { index: 0 }) }),
  cam({ id: "fa-colour", label: "Line colour", group: "Monitoring", kind: "choice", display: "select", options: opts(["Red", "Green", "Blue", "White", "Black"]), ccu: ccu(4, 5, I8, [0, 0], { index: 1 }) }),
  cam({ id: "guide", label: "Frame guide", group: "Monitoring", kind: "choice", display: "select", options: opts(["Off", "2.4:1", "2.39:1", "2.35:1", "1.85:1", "16:9", "14:9", "4:3", "2:1", "4:5", "1:1"]), ccu: ccu(3, 3, I8, [0, 100, 0, 0], { index: 0 }) }),
  cam({ id: "safe", label: "Safe area", group: "Monitoring", kind: "number", min: 0, max: 100, unit: "%", ccu: ccu(3, 3, I8, [0, 100, 0, 0], { index: 2 }) }),
  cam({ id: "guide-opacity", label: "Guide opacity", group: "Monitoring", kind: "range", min: 0, max: 100, step: 1, format: "plain", ccu: ccu(3, 3, I8, [0, 100, 0, 0], { index: 1 }) }),
  ...([["thirds", "Thirds", 1], ["cross", "Cross", 2], ["dot", "Centre dot", 4], ["horizon", "Horizon", 8]] as const).map(([id, label, bit]) =>
    cam({ id: `grid-${id}`, label, group: "Monitoring", kind: "switch", ccu: ccu(3, 3, I8, [0, 100, 0, 0], { index: 3, bit }) })),
  cam({ id: "brightness", label: "Display brightness", group: "Monitoring", kind: "range", min: 0, max: 1, step: 0.01, format: "percent", ccu: ccu(4, 0, F, [0.5]) }),
  cam({ id: "bars", label: "Colour bars (30 s)", group: "Monitoring", kind: "switch", ccu: ccu(4, 4, I8, [0], { on: [30], off: [0] }) }),
  ...CC_PARTS,
  cam({ id: "contrast-pivot", label: "Contrast pivot", group: "Colour correction", kind: "range", min: 0, max: 1, step: 0.01, format: "plain", ccu: ccu(8, 4, F, [0.5, 1], { index: 0 }) }),
  cam({ id: "contrast", label: "Contrast", group: "Colour correction", kind: "range", min: 0, max: 2, step: 0.01, format: "plain", ccu: ccu(8, 4, F, [0.5, 1], { index: 1 }) }),
  cam({ id: "hue", label: "Hue", group: "Colour correction", kind: "range", min: -1, max: 1, step: 0.01, format: "plain", ccu: ccu(8, 6, F, [0, 1], { index: 0 }) }),
  cam({ id: "saturation", label: "Saturation", group: "Colour correction", kind: "range", min: 0, max: 2, step: 0.01, format: "plain", ccu: ccu(8, 6, F, [0, 1], { index: 1 }) }),
  cam({ id: "luma-mix", label: "Luma mix", group: "Colour correction", kind: "range", min: 0, max: 1, step: 0.01, format: "plain", ccu: ccu(8, 5, F, [1]) }),
  cam({ id: "cc-reset", label: "Reset colour correction", group: "Colour correction", kind: "button", tone: "secondary", ccu: ccu(8, 7, B, [], { data: [] }) }),
  cam({ id: "audio-input", label: "Input", group: "Audio", kind: "choice", display: "select", options: opts(["Internal mic", "Line", "Low mic", "High mic"]), ccu: ccu(2, 4, I8, [0]) }),
  cam({ id: "in-1", label: "Input level ch 1", group: "Audio", kind: "range", min: 0, max: 1, step: 0.01, format: "percent", ccu: ccu(2, 5, F, [0.5, 0.5], { index: 0 }) }),
  cam({ id: "in-2", label: "Input level ch 2", group: "Audio", kind: "range", min: 0, max: 1, step: 0.01, format: "percent", ccu: ccu(2, 5, F, [0.5, 0.5], { index: 1 }) }),
  cam({ id: "phones", label: "Headphone level", group: "Audio", kind: "range", min: 0, max: 1, step: 0.01, format: "percent", ccu: ccu(2, 1, F, [0.5]) }),
  cam({ id: "phones-mix", label: "Headphone mix", group: "Audio", kind: "range", min: 0, max: 1, step: 0.01, format: "percent", ccu: ccu(2, 2, F, [0.5]) }),
  cam({ id: "speaker", label: "Speaker level", group: "Audio", kind: "range", min: 0, max: 1, step: 0.01, format: "percent", ccu: ccu(2, 3, F, [0.5]) }),
  cam({ id: "phantom", label: "Phantom power", group: "Audio", kind: "switch", ccu: ccu(2, 6, B, [0]) }),
  cam({ id: "scene", label: "Scene", group: "Slate", kind: "text", maxLength: 5, ccu: ccu(12, 2, S, [], { text: true }) }),
  cam({ id: "take", label: "Take", group: "Slate", kind: "number", min: 1, max: 99, ccu: ccu(12, 3, I8, [1, -1], { index: 0 }) }),
  cam({ id: "reel", label: "Reel", group: "Slate", kind: "number", min: 0, max: 999, ccu: ccu(12, 0, I16, [1]) }),
  cam({ id: "shot-tag", label: "Shot", group: "Slate", kind: "choice", display: "select", options: opts(["None", "WS", "CU", "MS", "BCU", "MCU", "ECU"], -1), ccu: ccu(12, 1, I8, [-1, 0, 1], { index: 0 }) }),
  cam({ id: "int-ext", label: "Interior or exterior", group: "Slate", kind: "choice", display: "segmented", options: [{ value: 1, label: "INT" }, { value: 0, label: "EXT" }], ccu: ccu(12, 1, I8, [-1, 0, 1], { index: 1 }) }),
  cam({ id: "day-night", label: "Day or night", group: "Slate", kind: "choice", display: "segmented", options: [{ value: 1, label: "Day" }, { value: 0, label: "Night" }], ccu: ccu(12, 1, I8, [-1, 0, 1], { index: 2 }) }),
  cam({ id: "good-take", label: "Good take", group: "Slate", kind: "button", icon: "star", tone: "secondary", ccu: ccu(12, 4, B, [], { data: [] }) }),
  ...([["camera-id", "Camera id", 5, 28], ["operator", "Operator", 6, 28], ["director", "Director", 7, 27], ["project", "Project", 8, 28]] as const).map(([id, label, p, max]) =>
    cam({ id, label, group: "Slate", kind: "text", maxLength: max, ccu: ccu(12, p, S, [], { text: true }) })),
  cam({ id: "tally", label: "Tally brightness", group: "Tally", kind: "range", min: 0, max: 1, step: 0.01, format: "percent", ccu: ccu(5, 0, F, [1]) }),
];

/** The rows of the camera's monitoring table (control kind "outputs"): the camera keeps them per output and does not report them. */
export const OUTPUT_ROWS = [
  { label: "Zebra", key: "4.1", bit: TOOL_BITS.zebra }, { label: "Focus assist", key: "4.1", bit: TOOL_BITS.focusAssist }, { label: "False colour", key: "4.1", bit: TOOL_BITS.falseColor },
  { label: "Status overlay", key: "3.0", bit: 0x1 }, { label: "Frame guides", key: "3.0", bit: 0x2 },
] as const;
export const OUTPUTS = [{ id: "lcd", label: "LCD", bit: TARGET_DISPLAYS.lcd }, { id: "hdmi", label: "HDMI", bit: TARGET_DISPLAYS.hdmi }] as const;

const CAMERA_STATES: StateSpec[] = [{ id: "recording", label: "Recording", format: "flag" }, { id: "timecode", label: "Timecode", format: "text" }, { id: "protocol", label: "Protocol", format: "text" }];

/* ---------- The models. ---------- */

const fromKind = (id: string, type: HardwareType, extra: Partial<Model> & { pairing: string }): Model => {
  const k = fixtureKind(id)!;
  return { id, brand: k.brand, model: k.model, type, transport: k.transport, controls: k.caps.camera ? CAMERA_CONTROLS : k.caps.power ? lightControls(k) : [], states: k.caps.camera ? CAMERA_STATES : statesOf(k), feeds: [], ...extra };
};

/** Every supported model. A new one is an entry here (and a FixtureKind with a driver on the phone when it speaks Bluetooth). */
export const CATALOGUE: readonly Model[] = [
  fromKind("aputure-mc", "light", { pairing: "Remove the light from Sidus Link first (or reset it): a light belongs to one mesh. The phone pairs it into its own network." }),
  fromKind("neewer-fs230b", "light", { takesBattery: true, pairing: "Switch the light on; close the NEEWER app on other phones." }),
  fromKind("neewer-fs300b", "light", { takesBattery: true, pairing: "Switch the light on; close the NEEWER app on other phones." }),
  fromKind("neewer-ps099s", "battery", { powers: true, pairing: "Switch the battery's display on so it advertises." }),
  fromKind("bmd-pocket-6k", "camera", { folded: ["Lens", "Image and codec", "Colour correction", "Audio", "Slate", "Tally"], pairing: "Bluetooth on in the camera's Setup menu. The first connection shows a 6-digit PIN on the camera; type it into the pairing dialog on the phone." }),
  {
    id: "hollyland-mars-400s-pro", brand: "Hollyland", model: "Mars 400S Pro", type: "transmitter", transport: "wifi", controls: [], states: [{ id: "stream", label: "Picture", format: "text" }],
    feeds: [{ id: "picture", label: "Picture", where: "phone" }],
    pairing: "Join the receiver's Wi-Fi on the phone and close HollyView: the transmitter allows only a few viewers. The phone needs location permission to read the network's name; keep mobile data on.",
  },
];

export const modelOf = (id: unknown): Model | undefined => CATALOGUE.find((m) => m.id === id);
export const modelName = (m: Model) => `${m.brand} ${m.model}`;
/**
 * A model's controls by group, in order, with whether the group starts folded. `hidden`: control ids the account
 * hides for this model (#426, the same ids as a flow's light parameters); hiding the effect hides its trigger too.
 */
export function controlGroups(m: Model, where: Where, hidden: readonly string[] = []): { group: string; folded: boolean; controls: Control[] }[] {
  const out: { group: string; folded: boolean; controls: Control[] }[] = [];
  for (const c of m.controls) {
    if (c.where === "phone" && where !== "phone") continue;
    if (hidden.includes(c.id) || (c.id === "trigger" && hidden.includes("effect"))) continue;
    let g = out.find((x) => x.group === c.group);
    if (!g) out.push((g = { group: c.group, folded: !!m.folded?.includes(c.group), controls: [] }));
    g.controls.push(c);
  }
  return out;
}

/* ---------- Binding: what a control shows, what a change sends. Shared, so both clients behave the same. ---------- */

export type Value = number | boolean | string;

/** The light state to show: what the phone last set or the light reported, over the model's start state. */
const stateOf = (live: FixtureLive | undefined): LightState => ({ ...live?.telemetry?.state, ...live?.state });

/** The value a control shows now, or undefined when it has none (a button, or nothing reported yet). */
export function controlValue(m: Model, c: Control, live: FixtureLive | undefined): Value | undefined {
  const bind = (c as CamControl).ccu;
  if (bind) {
    const raw = live?.telemetry?.camera?.params[`${bind.c}.${bind.p}`];
    if (bind.text) return typeof raw === "string" ? raw : "";
    if (bind.data) return undefined;
    const arr = Array.isArray(raw) ? raw : bind.defaults;
    if (c.id === "codec") return (arr[0] ?? 3) * 16 + (arr[1] ?? 0);
    const v = arr[bind.index ?? 0] ?? bind.defaults[bind.index ?? 0] ?? 0;
    if (bind.bit) return !!(v & bind.bit);
    if (c.kind === "switch") return bind.on ? v === bind.on[bind.index ?? 0] : !!v;
    return bind.scale ? v / bind.scale : v;
  }
  const s = stateOf(live);
  switch (c.id) {
    case "power": return s.power ?? false;
    case "intensity": return s.intensity ?? 0.5;
    case "kelvin": return s.cct?.kelvin ?? Math.round(((m.controls.find((x) => x.id === "kelvin") as { min: number; max: number }).min + (m.controls.find((x) => x.id === "kelvin") as { max: number }).max) / 200) * 100;
    case "gm": return s.cct?.gm ?? 0;
    case "curve": return CURVES.indexOf(s.curve ?? "linear");
    case "smooth": return (s as { smooth?: boolean }).smooth ?? true;
    default: return undefined;
  }
}

/** The command for a new value of a control (null: nothing to send). Lights keep the other half of a pair (white with its G/M). */
export function controlCommand(m: Model, c: Control, value: Value, live: FixtureLive | undefined): LightCommand | null {
  const bind = (c as CamControl).ccu;
  if (bind) {
    const message = (data: number[] | string) => ({ op: "ccu" as const, message: { category: bind.c, parameter: bind.p, type: bind.type, operation: 0 as const, data } });
    if (bind.text) return message(String(value).slice(0, 60));
    if (bind.data) return message([...bind.data]);
    if (c.id === "codec") { const n = Number(value); return message([Math.floor(n / 16), n % 16]); }
    const raw = live?.telemetry?.camera?.params[`${bind.c}.${bind.p}`];
    const arr = [...(Array.isArray(raw) && raw.length >= bind.defaults.length ? raw : bind.defaults)];
    const i = bind.index ?? 0;
    if (bind.bit) arr[i] = value ? (arr[i] | bind.bit) : (arr[i] & ~bind.bit);
    else if (c.kind === "switch") return message([...(value ? bind.on ?? [1] : bind.off ?? [0])]);
    else arr[i] = bind.scale ? Math.round(Number(value) * bind.scale) : Number(value);
    return message(arr);
  }
  const s = stateOf(live);
  switch (c.id) {
    case "power": return { op: "power", on: !!value };
    case "intensity": return { op: "intensity", value: Number(value) };
    case "kelvin": return { op: "cct", kelvin: Number(value), gm: s.cct?.gm ?? 0 };
    case "gm": return { op: "cct", kelvin: s.cct?.kelvin ?? Number(controlValue(m, m.controls.find((x) => x.id === "kelvin")!, live)), gm: Number(value) };
    case "curve": return { op: "curve", curve: CURVES[Number(value)] ?? "linear" };
    case "smooth": return { op: "smooth", on: !!value };
    case "trigger": return { op: "trigger" };
    default: return null;
  }
}

/** A camera's per-output bits (4.1 tools, 3.0 overlays) as the phone keeps them; undefined: not set since the phone app started. */
export const outputBits = (live: FixtureLive | undefined, key: "4.1" | "3.0", outBit: number): number | undefined => live?.telemetry?.camera?.outputs?.[key]?.[outBit];
/** Flips one tool or overlay on one output. */
export function outputCommand(live: FixtureLive | undefined, key: "4.1" | "3.0", bit: number, outBit: number): Extract<LightCommand, { op: "ccu" }> {
  const bits = (outputBits(live, key, outBit) ?? 0) ^ bit;
  return { op: "ccu", message: { category: key === "4.1" ? 4 : 3, parameter: key === "4.1" ? 1 : 0, type: CCU_TYPE.int16, operation: 0, data: [bits, outBit] } };
}

/** A state's value as reported, or undefined. */
export function stateValue(s: StateSpec, live: FixtureLive | undefined): Value | undefined {
  const t = live?.telemetry;
  if (!t) return undefined;
  if (s.id === "timecode") return t.camera?.timecode;
  if (s.id === "protocol") return t.camera?.protocolVersion;
  if (s.id === "recording") { const r = t.camera?.params["10.1"]; return Array.isArray(r) ? r[0] === 2 : undefined; }
  const v = (t as unknown as Record<string, unknown>)[s.id];
  return typeof v === "number" || typeof v === "boolean" || typeof v === "string" ? v : undefined;
}

/** How a value reads: "48 %", "5600 K", "+3", "2 h 05 min". */
export function formatValue(format: Format | StateSpec["format"], v: Value | undefined): string {
  if (v === undefined) return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "string") return v;
  switch (format) {
    case "percent": return `${Math.round(v * 100)} %`;
    case "charge": return `${Math.round(v)} %`;
    case "kelvin": return `${Math.round(v)} K`;
    case "signed": return v > 0 ? `+${v}` : String(v);
    case "degrees": return `${v}°`;
    case "focus": return v <= 0.001 ? "near" : v >= 0.999 ? "far" : `${Math.round(v * 100)} %`;
    case "volts": return `${v.toFixed(1)} V`;
    case "amps": return `${v.toFixed(2)} A`;
    case "watts": return `${Math.round(v)} W`;
    case "minutes": return v >= 60 ? `${Math.floor(v / 60)} h ${String(Math.round(v % 60)).padStart(2, "0")} min` : `${Math.round(v)} min`;
    default: return Number.isInteger(v) ? String(v) : v.toFixed(2);
  }
}

/** The effects a light offers, in the catalogue's order. */
export const effectsOf = (m: Model) => { const k = fixtureKind(m.id); return EFFECTS.filter((e) => k?.caps.effects?.includes(e.id)); };
