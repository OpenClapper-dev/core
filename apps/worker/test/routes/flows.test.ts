/** The Flows extension (step B10, #382): a flow is a lockable file of a project, checked by the extension's rules. */
import { beforeAll, describe, expect, test } from "vitest";
import { api, newUser, ok, uuid, type User } from "./helpers.ts";

let u: User, project: string;
beforeAll(async () => {
  u = await newUser();
  project = uuid();
  await ok(api(u.token, "PUT", `/api/projects/${project}`, { name: `F ${project}`, extensions: ["hardware", "flows"] }), 201);
});
const light = { id: "t1", name: "Key", model: "neewer-fs230b", device: null, keyframes: [{ id: "start", at: 0, power: true, intensity: 0.5, kelvin: 4600, gm: 0 }, { id: "k", at: 2000, intensity: 1, fadeIn: "s" }] };

describe("flows", () => {
  test("made, saved and read back; a wrong body is refused", async () => {
    const id = uuid();
    const made = await ok<{ file: { body: { durationMs: number; tracks: unknown[] } } }>(api(u.token, "PUT", `/api/files/${id}`, { type: "flow", project_id: project, name: "Cue 1" }), 201);
    expect(made.file.body).toEqual({ durationMs: 30000, loop: false, tracks: [], markers: [] });
    await ok(api(u.token, "PUT", `/api/files/${id}`, { body: { durationMs: 10000, loop: true, tracks: [light], markers: [{ id: "m", at: 1000, name: "Go" }] } }));
    const got = await ok<{ file: { body: { tracks: { keyframes: unknown[] }[] } } }>(api(u.token, "GET", `/api/files/${id}`));
    expect(got.file.body.tracks[0].keyframes).toHaveLength(2);
    await ok(api(u.token, "PUT", `/api/files/${id}`, { body: { durationMs: 10000, loop: true, tracks: [{ ...light, model: "neewer-ps099s" }], markers: [] } }), 400);
    await ok(api(u.token, "PUT", `/api/files/${id}`, { body: { durationMs: 10, loop: true, tracks: [], markers: [] } }), 400);
  });

  test("stages are part of the body: kept, and checked (#426)", async () => {
    const id = uuid();
    await ok(api(u.token, "PUT", `/api/files/${id}`, { type: "flow", project_id: project }), 201);
    const stage = { id: "s1", name: "Plan", aspect: 1.78, objects: [{ id: "o1", kind: "rect", name: "Niche", x: 0.6, y: 0.7, w: 0.07, h: 0.05, stroke: "#8C8C8E", width: 3, opacity: 1, visible: true, locked: false }], lights: [{ track: "t1", x: 0.3, y: 0.3, rot: 90 }] };
    const other = { ...stage, id: "s2", name: "Photo", objects: [] };
    await ok(api(u.token, "PUT", `/api/files/${id}`, { body: { durationMs: 10000, loop: false, tracks: [light], markers: [], stages: [stage, other] } }));
    const got = await ok<{ file: { body_version: number; body: { stages: (typeof stage)[] } } }>(api(u.token, "GET", `/api/files/${id}`));
    expect(got.file.body.stages).toEqual([stage, other]);
    expect(got.file.body_version).toBe(2);
    await ok(api(u.token, "PUT", `/api/files/${id}`, { body: { durationMs: 10000, loop: false, tracks: [light], markers: [], stages: [{ ...stage, lights: [{ track: "nope", x: 0.3, y: 0.3, rot: 0 }] }] } }), 400);
    await ok(api(u.token, "PUT", `/api/files/${id}`, { body: { durationMs: 10000, loop: false, tracks: [light], markers: [], stages: [stage, stage] } }), 400);
    // A body of version 1 (one `stage`) is upgraded: its stage becomes "Stage 1".
    const { id: _i, name: _n, ...v1 } = stage;
    await ok(api(u.token, "PUT", `/api/files/${id}`, { body: { durationMs: 10000, loop: false, tracks: [light], markers: [], stage: v1 }, body_version: 1 }));
    const up = await ok<{ file: { body: { stages: (typeof stage)[] } } }>(api(u.token, "GET", `/api/files/${id}`));
    expect(up.file.body.stages).toEqual([{ ...v1, id: "s1", name: "Stage 1" }]);
  });

  test("one editor at a time: another holder's save is refused while the lock is held", async () => {
    const id = uuid();
    await ok(api(u.token, "PUT", `/api/files/${id}`, { type: "flow", project_id: project }), 201);
    await ok(api(u.token, "POST", `/api/files/${id}/lock`, { holder: "window-aaaa" }));
    await ok(api(u.token, "PUT", `/api/files/${id}`, { body: { durationMs: 5000, loop: false, tracks: [], markers: [] } }), 423);
  });
});
