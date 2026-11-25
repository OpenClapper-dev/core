import { test } from "node:test";
import assert from "node:assert/strict";
import { checkFile, extensionsError, fileType } from "@openclapper/model";
import type { LightCommand } from "@openclapper/ext-hardware";
import { FlowEmitter, emptyFlow, flowError, parseFlowRequest, sampleControls, START_KEYFRAME, startKeyframe, type Flow, type FlowTrack } from "./index.ts";

const cam: FlowTrack = { id: "c", name: "A cam", model: "bmd-pocket-6k", device: "6f1c2c1e-1111-4111-8111-111111111111", keyframes: [{ id: START_KEYFRAME, at: 0, controls: { record: false } }, { id: "k1", at: 2000, controls: { record: true, iso: 1600 } }, { id: "k2", at: 5000, controls: { record: false } }] };

test("a flow is a lockable project file; Flows needs Hardware", () => {
  const t = fileType("flow")!;
  assert.equal(t.lockable, true);
  assert.equal(checkFile(t, emptyFlow() as unknown as Record<string, unknown>, 1, null).ok, true);
  assert.match(extensionsError(["flows"])!, /needs Hardware/);
  assert.equal(extensionsError(["hardware", "flows"]), null);
});

test("camera tracks hold catalogue controls, as jumps", () => {
  const ok = { ...emptyFlow(), tracks: [cam] };
  assert.equal(flowError(ok as unknown as Record<string, unknown>), null);
  assert.match(flowError({ ...ok, tracks: [{ ...cam, keyframes: [...cam.keyframes, { id: "k3", at: 6000, controls: { iso: 7 } }] }] } as unknown as Record<string, unknown>)!, /out of range/);
  assert.match(flowError({ ...ok, tracks: [{ ...cam, keyframes: [...cam.keyframes, { id: "k3", at: 6000, intensity: 0.5 }] }] } as unknown as Record<string, unknown>)!, /camera controls only/);
  assert.match(flowError({ ...ok, tracks: [{ ...cam, keyframes: [...cam.keyframes, { id: "k3", at: 6000, controls: { still: true } }] }] } as unknown as Record<string, unknown>)!, /not a camera control/);
  assert.deepEqual(sampleControls(cam.keyframes, 3000), { record: true, iso: 1600 });
  assert.deepEqual(startKeyframe({ caps: { cct: null, hsi: false, camera: true } }), { id: START_KEYFRAME, at: 0, controls: { record: false } });
});

test("the player sends a camera's controls when they change", () => {
  const sent: LightCommand[] = [];
  const e = new FlowEmitter();
  const flow = { id: "f", name: "F", updatedAt: "", ...emptyFlow(), tracks: [cam] } as Flow;
  e.emit(flow, 0, true, (_d, c) => sent.push(c));
  e.emit(flow, 1000, true, (_d, c) => sent.push(c));
  e.emit(flow, 2500, true, (_d, c) => sent.push(c));
  const data = sent.map((c) => (c.op === "ccu" ? `${c.message.category}.${c.message.parameter}=${JSON.stringify(c.message.data)}` : c.op));
  assert.deepEqual(data, ["10.1=[0,0,0,0,0]", "10.1=[2,0,0,0,0]", "1.14=[1600]"]);
});

test("Live (not playing) never starts or stops a recording", () => {
  const sent: LightCommand[] = [];
  const e = new FlowEmitter();
  const flow = { id: "f", name: "F", updatedAt: "", ...emptyFlow(), tracks: [cam] } as Flow;
  e.emit(flow, 2500, false, (_d, c) => sent.push(c));
  assert.deepEqual(sent.map((c) => (c.op === "ccu" ? `${c.message.category}.${c.message.parameter}` : c.op)), ["1.14"]);
});

test("run requests are checked", () => {
  assert.deepEqual(parseFlowRequest({ type: "run", flow: "6f1c2c1e-1111-4111-8111-111111111111", revision: "2026-11-25T10:00:00.000Z", fromMs: 0 }), { type: "run", flow: "6f1c2c1e-1111-4111-8111-111111111111", revision: "2026-11-25T10:00:00.000Z", fromMs: 0 });
  assert.equal(parseFlowRequest({ type: "run", flow: "x", revision: "r", fromMs: 0 }), null);
  assert.deepEqual(parseFlowRequest({ type: "stop" }), { type: "stop" });
});
