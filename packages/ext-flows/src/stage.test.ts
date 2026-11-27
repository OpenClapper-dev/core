import { strict as assert } from "node:assert";
import { test } from "node:test";
import { EFFECTS } from "@openclapper/ext-hardware";
import { emptyFlow, flowError, FLOW, removeTrack, START_KEYFRAME, type FlowBody, type FlowTrack, type Keyframe } from "./index.ts";
import { beamPath, EFFECT_FAMILY, effectOpacity, emptyStage, STAGE_OBJECTS_MAX, widgetShape, widgetState, type FlowStage } from "./stage.ts";

const kf = (at: number, x: Omit<Keyframe, "id" | "at">, id = `k${at}`): Keyframe => ({ id, at, ...x });
const lamp: FlowTrack = { id: "t1", name: "Lamp 1", model: "aputure-mc", device: null, keyframes: [kf(0, { power: false, intensity: 0.8, kelvin: 3200, gm: 0 }, START_KEYFRAME), kf(3000, { power: true }), kf(6000, { hue: 0, sat: 1, intensity: 1 }), kf(8000, { effect: { id: "fire" } })] };
const cam: FlowTrack = { id: "c1", name: "A cam", model: "bmd-pocket-6k", device: null, keyframes: [kf(0, { controls: { record: false } }, START_KEYFRAME)] };
const line = { id: "o1", kind: "line", name: "Wall", x: 0.1, y: 0.3, w: 0.8, h: 0, pts: [0, 0, 1, 0], stroke: "#8C8C8E", width: 4, opacity: 1, visible: true, locked: false };
const withStage = (stage: unknown, tracks = [lamp, cam]) => ({ ...emptyFlow(), tracks, stage }) as unknown as Record<string, unknown>;

test("a stage is part of the flow's body, checked on every save", () => {
  const ok: FlowStage = { ...emptyStage(), objects: [line as FlowStage["objects"][number]], lights: [{ track: "t1", x: 0.3, y: 0.3, rot: 90 }] };
  assert.equal(flowError(withStage(ok)), null);
  assert.equal(flowError(withStage(undefined)), null); // a flow without a stage
  assert.match(flowError(withStage({ ...ok, lights: [{ track: "c1", x: 0.5, y: 0.5, rot: 0 }] }))!, /only light tracks/);
  assert.match(flowError(withStage({ ...ok, lights: [{ track: "gone", x: 0.5, y: 0.5, rot: 0 }] }))!, /not in the flow/);
  assert.match(flowError(withStage({ ...ok, lights: [...ok.lights, { track: "t1", x: 0.6, y: 0.5, rot: 0 }] }))!, /one widget/);
  assert.match(flowError(withStage({ ...ok, lights: [{ track: "t1", x: 1.4, y: 0.5, rot: 0 }] }))!, /on the paper/);
  assert.match(flowError(withStage({ ...ok, objects: [{ ...line, kind: "picture", photo: "6f1c2c1e-1111-4111-8111-111111111111" }] }))!, /a stage draws/);
  assert.match(flowError(withStage({ ...ok, objects: [{ ...line, stroke: "red" }] }))!, /colour/);
  assert.match(flowError(withStage({ ...ok, objects: Array.from({ length: STAGE_OBJECTS_MAX + 1 }, (_, i) => ({ ...line, id: `o${i}` })) }))!, /at most/);
  assert.match(flowError(withStage({ ...ok, frames: [] }))!, /no "frames"/);
  assert.equal(flowError(withStage({ ...ok, underlay: { photo: "6f1c2c1e-1111-4111-8111-111111111111", opacity: 0.6 } })), null);
  assert.match(flowError(withStage({ ...ok, underlay: { photo: "x", opacity: 0.6 } }))!, /underlay/);
});

test("removing a track takes its widget off the stage; a copy's underlay follows the copied photo", () => {
  const b: FlowBody = { ...emptyFlow(), tracks: [lamp], stage: { ...emptyStage(), lights: [{ track: "t1", x: 0.5, y: 0.5, rot: 0 }] } };
  assert.deepEqual(removeTrack(b, "t1").stage!.lights, []);
  const old = "6f1c2c1e-1111-4111-8111-111111111111", neu = "6f1c2c1e-2222-4111-8111-111111111111";
  const copied = FLOW.remap!({ ...b, stage: { ...b.stage!, underlay: { photo: old, opacity: 1 } } } as unknown as Record<string, unknown>, new Map([[old, neu]]));
  assert.equal((copied.stage as FlowStage).underlay!.photo, neu);
});

test("a widget shows what the track plays: off, on, colour, the effect as a motion", () => {
  assert.equal(widgetState(lamp, 1000).on, false);
  assert.equal(widgetState(lamp, 1000).line, "off");
  const on = widgetState(lamp, 4000);
  assert.equal(on.on, true);
  assert.equal(on.level, 0.8);
  assert.equal(on.colour, "rgb(255, 184, 123)");
  assert.equal(on.line, "80 % · 3200 K");
  assert.equal(widgetState(lamp, 7000).line, "100 % · colour 0°");
  const fx = widgetState(lamp, 9000);
  assert.deepEqual(fx.effect, { id: "fire", name: "Fire", family: "flicker" });
  assert.equal(widgetState({ ...lamp, muted: true }, 4000).on, false);
  assert.equal(widgetState({ ...lamp, muted: true }, 4000).line, "muted");
});

test("a widget follows locks as the player does (#469)", () => {
  // Intensity locked on the start: the later 100 % plays the start's 80 %.
  assert.equal(widgetState({ ...lamp, locked: ["intensity"] }, 7000).level, 0.8);
  // Power locked off: the light never comes on.
  assert.equal(widgetState({ ...lamp, locked: ["power"] }, 7000).on, false);
});

test("every effect has a family; each motion stays between 0 and 1", () => {
  for (const e of EFFECTS) assert.ok(EFFECT_FAMILY[e.id], e.id);
  for (const f of ["pulse", "strobe", "flicker", "flash"] as const) for (let ms = 0; ms < 3000; ms += 37) { const v = effectOpacity(f, ms); assert.ok(v >= 0 && v <= 1, `${f} ${ms}`); }
  assert.equal(effectOpacity("strobe", 10), 1);
  assert.equal(effectOpacity("strobe", 130), 0);
  assert.ok(Math.abs(effectOpacity("pulse", 700) - 0.18) < 1e-9);
});

test("the beam's shape follows the fixture: the MC soft and wide, the FS narrower and longer", () => {
  const mc = widgetShape("aputure-mc"), fs = widgetShape("neewer-fs230b"), fs3 = widgetShape("neewer-fs300b");
  assert.ok(mc.spread[1] > fs.spread[1] && mc.len[1] < fs.len[1]);
  assert.ok(fs3.len[1] > fs.len[1]);
  assert.match(beamPath(mc, 1), /^M10.5 -13.5 L160.5 -60.0 L160.5 60.0 L10.5 13.5 Z$/);
  assert.ok(fs.parts.some((p) => p.face));
});
