import { strict as assert } from "node:assert";
import { test } from "node:test";
import { EFFECTS } from "@openclapper/ext-hardware";
import { checkFile } from "@openclapper/model";
import { emptyFlow, flowBodyOf, flowError, FLOW, removeTrack, START_KEYFRAME, type FlowBody, type FlowTrack, type Keyframe } from "./index.ts";
import { beamPath, ceilingShape, copyStage, EFFECT_FAMILY, effectOpacity, emptyStage, nextStageName, resizeStage, stageScale, stageSize, stagesError, poolRadius, setMount, STAGE_OBJECTS_MAX, STAGE_W, STAGES_MAX, stageOf, tagAt, widgetShape, widgetState, type FlowStage } from "./stage.ts";

const kf = (at: number, x: Omit<Keyframe, "id" | "at">, id = `k${at}`): Keyframe => ({ id, at, ...x });
const lamp: FlowTrack = { id: "t1", name: "Lamp 1", model: "aputure-mc", device: null, keyframes: [kf(0, { power: false, intensity: 0.8, kelvin: 3200, gm: 0 }, START_KEYFRAME), kf(3000, { power: true }), kf(6000, { hue: 0, sat: 1, intensity: 1 }), kf(8000, { effect: { id: "fire" } })] };
const cam: FlowTrack = { id: "c1", name: "A cam", model: "bmd-pocket-6k", device: null, keyframes: [kf(0, { controls: { record: false } }, START_KEYFRAME)] };
const line = { id: "o1", kind: "line", name: "Wall", x: 0.1, y: 0.3, w: 0.8, h: 0, pts: [0, 0, 1, 0], stroke: "#8C8C8E", width: 4, opacity: 1, visible: true, locked: false };
const withStage = (stage: unknown, tracks = [lamp, cam]) => ({ ...emptyFlow(), tracks, stages: stage === undefined ? undefined : [stage] }) as unknown as Record<string, unknown>;

test("a stage is part of the flow's body, checked on every save", () => {
  const ok: FlowStage = { ...emptyStage("s1", "Plan"), objects: [line as FlowStage["objects"][number]], lights: [{ track: "t1", x: 0.3, y: 0.3, rot: 90 }] };
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

test("a flow has up to 12 stages, each with its own id and a name; a track once per stage, on several stages", () => {
  const on = (id: string, x = 0.5): FlowStage => ({ ...emptyStage(id, `Stage ${id}`), lights: [{ track: "t1", x, y: 0.5, rot: 0 }] });
  const flow = (stages: unknown) => ({ ...emptyFlow(), tracks: [lamp, cam], stages }) as unknown as Record<string, unknown>;
  assert.equal(flowError(flow([on("a"), on("b", 0.2)])), null);
  assert.equal(flowError(flow([])), null);
  assert.match(flowError(flow([on("a"), on("a")]))!, /stages\[1\]: each stage has its own id/);
  assert.match(flowError(flow(Array.from({ length: STAGES_MAX + 1 }, (_, i) => on(`s${i}`))))!, /at most 12/);
  assert.match(flowError(flow([{ ...on("a"), name: " " }]))!, /stages\[0\]: stage.name/);
  assert.match(flowError(flow([{ ...on("a"), id: "no spaces" }]))!, /stage.id/);
  assert.match(flowError({ ...flow([]), stage: on("a") })!, /no "stage"/);
});

test("removing a track takes its widget off every stage; a copy's underlays follow the copied photos", () => {
  const placed = (id: string): FlowStage => ({ ...emptyStage(id, id), lights: [{ track: "t1", x: 0.5, y: 0.5, rot: 0 }] });
  const b: FlowBody = { ...emptyFlow(), tracks: [lamp], stages: [placed("a"), placed("b")] };
  assert.deepEqual(removeTrack(b, "t1").stages!.map((s) => s.lights), [[], []]);
  const old = "6f1c2c1e-1111-4111-8111-111111111111", neu = "6f1c2c1e-2222-4111-8111-111111111111";
  const withPhoto = { ...b, stages: [b.stages![0], { ...b.stages![1], underlay: { photo: old, opacity: 1 } }] };
  const copied = FLOW.remap!(withPhoto as unknown as Record<string, unknown>, new Map([[old, neu]]));
  assert.equal((copied.stages as FlowStage[])[1].underlay!.photo, neu);
  assert.equal((copied.stages as FlowStage[])[0], b.stages![0]);
});

test("a flow of version 1 (one stage) is upgraded to a list: its stage becomes Stage 1", () => {
  const old = { aspect: 1.5, objects: [line], lights: [{ track: "t1", x: 0.3, y: 0.3, rot: 90 }] };
  const v1 = { ...emptyFlow(), tracks: [lamp], stage: old };
  const got = checkFile(FLOW, v1, 1, null);
  assert.ok(got.ok);
  assert.deepEqual(got.body.stages, [{ ...old, id: "s1", name: "Stage 1" }]);
  assert.equal("stage" in got.body, false);
  assert.equal(got.version, 2);
  // Without a stage, nothing is added; a client reading the stored body upgrades it the same way.
  assert.deepEqual(checkFile(FLOW, { ...emptyFlow() }, 1, null), { ok: true, body: emptyFlow(), version: 2, refs: null });
  assert.deepEqual(flowBodyOf(v1, 1).stages, got.body.stages);
  assert.deepEqual(flowBodyOf({ ...emptyFlow(), stages: [] }, 2).stages, []);
});

test("the stage shown, a new stage's name, a copy", () => {
  const a = emptyStage("a", "Stage 1"), b = { ...emptyStage("b", "Plan"), lights: [{ track: "t1", x: 0.5, y: 0.5, rot: 0 }] };
  assert.equal(stageOf([a, b], "b"), b);
  assert.equal(stageOf([a, b], "gone"), a);
  assert.equal(stageOf([], "a"), null);
  assert.equal(nextStageName([a, b]), "Stage 3");
  assert.equal(nextStageName([a, { ...b, name: "Stage 3" }]), "Stage 4");
  const c = copyStage(b, "c");
  assert.deepEqual(c, { ...b, id: "c", name: "Plan copy" });
  assert.notEqual(c.lights, b.lights);
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

test("a light hangs aimed (the default) or from the ceiling; nothing else", () => {
  const at = (mount: unknown) => withStage({ ...emptyStage("s1", "Plan"), lights: [{ track: "t1", x: 0.5, y: 0.5, rot: 90, mount }] });
  assert.equal(flowError(at("ceiling")), null);
  assert.equal(flowError(at("aimed")), null);
  const hung = setMount({ track: "t1", x: 0.5, y: 0.5, rot: 90 }, "ceiling");
  assert.deepEqual(hung, { track: "t1", x: 0.5, y: 0.5, rot: 90, mount: "ceiling" });
  assert.deepEqual(setMount(hung, "aimed"), { track: "t1", x: 0.5, y: 0.5, rot: 90 }); // the default is no key; the turn kept
  assert.match(flowError(at("wall"))!, /mount is aimed or ceiling/);
  assert.match(flowError(withStage({ ...emptyStage("s1", "Plan"), lights: [{ track: "t1", x: 0.5, y: 0.5, rot: 0, tilt: 3 }] }))!, /is \{ track, x, y, rot, mount\? \}/);
});

test("a ceiling light: a pool growing with the level, its tag under it (above at the paper's foot), its turn ignored", () => {
  const mc = ceilingShape("aputure-mc"), fs = ceilingShape("neewer-fs230b"), fs3 = ceilingShape("neewer-fs300b");
  assert.ok(poolRadius(mc, 1) > poolRadius(mc, 0.2) && poolRadius(mc, 0) >= mc.r);
  assert.ok(fs3.pool[1] > fs.pool[1] && fs3.r > fs.r);
  assert.ok(mc.parts.some((p) => p.face) && fs.parts.some((p) => p.face));
  const H = STAGE_W / (16 / 9);
  const mid = tagAt({ track: "t1", x: 0.5, y: 0.5, rot: 0, mount: "ceiling" }, 16 / 9, 120);
  assert.deepEqual(mid, tagAt({ track: "t1", x: 0.5, y: 0.5, rot: 200, mount: "ceiling" }, 16 / 9, 120));
  assert.ok(mid[0] === 500 && mid[1] > H / 2);
  assert.ok(tagAt({ track: "t1", x: 0.5, y: 0.98, rot: 0, mount: "ceiling" }, 16 / 9, 120)[1] < 0.98 * H);
  // Aimed: behind the light, as before.
  assert.ok(tagAt({ track: "t1", x: 0.5, y: 0.5, rot: 0 }, 16 / 9, 120)[0] < 500);
});

test("a stage may be turned on screen: whole degrees 0 to 359, nothing else changes", () => {
  const at = (turn: unknown) => stagesError([{ ...emptyStage("a", "Stage 1"), turn }], []);
  assert.equal(at(90), null);
  assert.equal(at(359), null);
  assert.match(at(360)!, /stage.turn/);
  assert.match(at(12.5)!, /stage.turn/);
  assert.match(at(-15)!, /stage.turn/);
});

test("a larger paper is more room: everything keeps its size and place among the rest", () => {
  const s: FlowStage = { ...emptyStage("a", "Stage 1"), aspect: 25 / 10, objects: [], lights: [{ track: "t1", x: 0.2, y: 0.5, rot: 0 }] };
  s.objects = [{ id: "o1", kind: "rect", name: "Rectangle", x: 0.2, y: 0.1, w: 0.4, h: 0.5, stroke: "#ECECEA", width: 3, opacity: 1, visible: true, locked: false }];
  assert.deepEqual(stageSize(s), [25, 10]);
  // 40 squares wide, the old paper on the left: x and w shrink to 25/40, y and h stay.
  const wide = resizeStage(s, 40, 10, [0, 0]);
  assert.equal(wide.cols, 40); assert.equal(wide.aspect, 4); assert.equal(stageScale(wide), 1.6);
  assert.deepEqual([wide.objects[0].x, wide.objects[0].w, wide.objects[0].y, wide.objects[0].h], [0.125, 0.25, 0.1, 0.5]);
  assert.deepEqual([wide.lights[0].x, wide.lights[0].y], [0.125, 0.5]);
  // In the middle of a paper twice as large each way.
  const mid = resizeStage(s, 50, 20, [0.5, 0.5]);
  assert.deepEqual([mid.objects[0].x, mid.objects[0].y], [(0.2 * 25 + 12.5) / 50, (0.1 * 10 + 5) / 20]);
  // Back to 25 squares: no cols stored; a smaller paper moves a light to its edge.
  assert.equal(resizeStage(wide, 25, 10, [0, 0]).cols, undefined);
  assert.equal(resizeStage(s, 25, 10, [1, 0]).lights[0].x, 0.2);
  assert.equal(resizeStage(s, 10, 10, [1, 0]).lights[0].x, 0);
  assert.equal(stagesError([{ ...wide }], [{ id: "t1", model: "aputure-mc" }]), null);
  assert.match(stagesError([{ ...s, cols: 4 }], [{ id: "t1", model: "aputure-mc" }])!, /stage.cols/);
});
