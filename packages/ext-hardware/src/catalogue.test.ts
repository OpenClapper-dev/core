import { test } from "node:test";
import assert from "node:assert/strict";
import "./index.ts";
import { checkFile, fileType, keepGuarded } from "@openclapper/model";
import { CATALOGUE, CAMERA_CONTROLS, controlCommand, controlGroups, controlValue, formatValue, modelOf, outputCommand } from "./catalogue.ts";
import { hardwareError, newHardware } from "./device.ts";
import { FIXTURE_KINDS } from "./lighting.ts";
import type { FixtureLive } from "./lightProxy.ts";
import { parseHardwareRequest } from "./protocol.ts";

const live = (camera?: Record<string, number[] | string>, state = {}): FixtureLive => ({ id: "x", link: "ready", attempt: 0, error: null, state, telemetry: { at: 0, ...(camera ? { camera: { params: camera, log: [] } } : {}) } });

test("every driver's kind is in the catalogue, plus the transmitter", () => {
  for (const k of FIXTURE_KINDS) assert.ok(modelOf(k.id), k.id);
  assert.equal(modelOf("hollyland-mars-400s-pro")?.feeds[0].where, "phone");
  assert.equal(new Set(CATALOGUE.map((m) => m.id)).size, CATALOGUE.length);
});

test("lights expose what their capabilities say", () => {
  const ids = (id: string) => modelOf(id)!.controls.map((c) => c.id);
  assert.deepEqual(ids("aputure-mc"), ["power", "intensity", "kelvin", "colour", "effect", "trigger", "curve"]);
  assert.deepEqual(ids("neewer-fs230b"), ["power", "intensity", "kelvin", "effect", "curve", "smooth"]);
  assert.ok(ids("neewer-fs300b").includes("gm"));
  assert.deepEqual(ids("neewer-ps099s"), []);
  assert.deepEqual(modelOf("neewer-ps099s")!.states.map((s) => s.id), ["battery", "minutesLeft", "volts", "amps", "watts", "discharging"]);
  // Hidden by the account (#426): left out of the groups; the effect takes its trigger along.
  const shown = controlGroups(modelOf("aputure-mc")!, "everywhere", ["power", "effect"]).flatMap((g) => g.controls.map((c) => c.id));
  assert.deepEqual(shown, ["intensity", "kelvin", "colour", "curve"]);
});

test("a light's white keeps its G/M, and G/M keeps its white", () => {
  const m = modelOf("neewer-fs300b")!, c = (id: string) => m.controls.find((x) => x.id === id)!;
  const l = live(undefined, { cct: { kelvin: 4300, gm: 7 } });
  assert.deepEqual(controlCommand(m, c("kelvin"), 5600, l), { op: "cct", kelvin: 5600, gm: 7 });
  assert.deepEqual(controlCommand(m, c("gm"), -3, l), { op: "cct", kelvin: 4300, gm: -3 });
  assert.equal(controlValue(m, c("kelvin"), live()), 4600);
});

test("every camera control binds to the protocol, as the old panel sent it", () => {
  const m = modelOf("bmd-pocket-6k")!, c = (id: string) => CAMERA_CONTROLS.find((x) => x.id === id)!;
  for (const x of CAMERA_CONTROLS) if (x.kind !== "outputs") assert.ok(x.ccu, x.id);
  const ccu = (id: string, v: number | boolean | string, params = {}) => (controlCommand(m, c(id), v, live(params)) as { message: { category: number; parameter: number; data: unknown } }).message;
  assert.deepEqual(ccu("record", true).data, [2, 0, 0, 0, 0]);
  assert.deepEqual(ccu("record", false).data, [0, 0, 0, 0, 0]);
  assert.equal(controlValue(m, c("record"), live({ "10.1": [2, 0, 0, 0, 0] })), true);
  assert.deepEqual(ccu("tint", 5, { "1.2": [4300, 0] }).data, [4300, 5]);
  assert.deepEqual(ccu("angle", 172.8).data, [17280]);
  assert.equal(controlValue(m, c("angle"), live({ "1.11": [18000] })), 180);
  assert.deepEqual(ccu("codec", 2 * 16 + 1).data, [2, 1]);
  assert.equal(controlValue(m, c("codec"), live({ "10.0": [3, 7] })), 55);
  assert.deepEqual(ccu("grid-cross", true, { "3.3": [5, 80, 90, 1] }).data, [5, 80, 90, 3]);
  assert.deepEqual(ccu("scene", "12A").data, "12A");
  assert.deepEqual(ccu("good-take", true), { category: 12, parameter: 4, type: 0, operation: 0, data: [] });
  assert.deepEqual(outputCommand(undefined, "4.1", 1, 2).message.data, [1, 2]);
  assert.deepEqual(controlGroups(m, "everywhere").map((g) => g.group), ["Camera", "Exposure", "White balance", "Lens", "Image and codec", "Monitoring", "Colour correction", "Audio", "Slate", "Tally"]);
});

test("values read as the person expects", () => {
  assert.equal(formatValue("percent", 0.48), "48 %");
  assert.equal(formatValue("charge", 77), "77 %");
  assert.equal(formatValue("minutes", 125), "2 h 05 min");
  assert.equal(formatValue("focus", 0), "near");
  assert.equal(formatValue("kelvin", undefined), "—");
});

test("a hardware device's body", () => {
  const ok = { ...newHardware("neewer-fs230b", "AA:BB:CC:DD:EE:FF") };
  assert.equal(hardwareError(ok), null);
  assert.equal(checkFile(fileType("device")!, ok, 1, null).ok, true);
  assert.match(hardwareError({ ...ok, kind: "battery" })!, /is a light/);
  assert.match(hardwareError({ ...ok, address: "nope" })!, /Bluetooth address/);
  assert.match(hardwareError({ ...ok, mesh: { network: "x", unicast: 2, elements: 1 } })!, /not paired through a mesh/);
  assert.equal(hardwareError(newHardware("hollyland-mars-400s-pro", null)), null);
  assert.match(hardwareError({ ...newHardware("neewer-ps099s", "AA:BB:CC:DD:EE:FF"), poweredBy: "6f1c2c1e-1111-4111-8111-111111111111" })!, /does not take a battery/);
  assert.match(hardwareError({ ...ok, extra: 1 })!, /has no "extra"/);
});

test("a general save keeps the kind and the guarded parts", () => {
  const before = { ...newHardware("aputure-mc", "AA:BB:CC:DD:EE:FF"), mesh: { network: "6f1c2c1e-1111-4111-8111-111111111111", unicast: 2, elements: 1 } };
  const after = keepGuarded(before, { kind: "battery", model: "neewer-ps099s", address: "AA:AA:AA:AA:AA:AA", mesh: null, poweredBy: null, asleep: true });
  assert.deepEqual(after, { ...before, asleep: true });
});

test("requests on the channel are checked", () => {
  const id = "6f1c2c1e-1111-4111-8111-111111111111";
  assert.deepEqual(parseHardwareRequest({ type: "command", device: id, command: { op: "intensity", value: 0.3 } }), { type: "command", device: id, command: { op: "intensity", value: 0.3 } });
  assert.equal(parseHardwareRequest({ type: "command", device: id, command: { op: "intensity", value: 3 } }), null);
  assert.equal(parseHardwareRequest({ type: "provision", device: "x" }), null);
  assert.deepEqual(parseHardwareRequest({ type: "scan", on: true }), { type: "scan", on: true });
  assert.equal(parseHardwareRequest({ type: "nope" }), null);
});

test("effect options become controls and map onto the settings", async () => {
  const { effectOptions, effectCommand, optionShown } = await import("./effects.ts");
  const mc = modelOf("aputure-mc")!;
  const opts = effectOptions(mc, "pulsing");
  assert.deepEqual(opts.map((o) => o.control.id), ["colorMode", "colorKelvin", "colorHue", "colorSat", "frequency", "speed"]);
  let s: import("./lighting.ts").EffectSettings = { color: { h: 0, s: 1 } };
  s = opts[2].write(s, 120);
  assert.deepEqual(s.color, { h: 120, s: 1 });
  assert.equal(optionShown(opts[1], s), false);
  s = opts[0].write(s, 0);
  assert.equal(optionShown(opts[1], s), true);
  const nw = effectOptions(modelOf("neewer-fs230b")!, "nw_candle").map((o) => o.control.id);
  assert.deepEqual(nw, ["intensityMin", "intensityMax", "kelvin", "frequency", "ember"]);
  assert.deepEqual(effectCommand("tv"), { op: "effect", effect: "tv", settings: { choice: 0, frequency: 5 } });
  assert.deepEqual(effectCommand(null), { op: "effect", effect: null });
});

test("the Hardware camera control: placeable while the extension is on, valid in a layout either way", async () => {
  const { BUILTIN_LAYOUTS, CONTROLS, controlOn, layoutError, unplaced } = await import("@openclapper/model");
  assert.equal(CONTROLS.hardware?.extension, "hardware");
  const vf = BUILTIN_LAYOUTS.viewfinder.body;
  assert.ok(unplaced(vf.portrait, ["hardware"]).includes("hardware"));
  assert.ok(!unplaced(vf.portrait, []).includes("hardware"));
  assert.equal(controlOn("hardware", []), false);
  assert.equal(controlOn("shutter", []), true);
  const withIt = { ...vf, portrait: { bars: vf.portrait.bars.map((b, i) => (i === 0 ? { ...b, items: [...b.items, { control: "hardware", label: true }] } : b)) } };
  assert.equal(layoutError(withIt as unknown as Record<string, unknown>), null);
});
