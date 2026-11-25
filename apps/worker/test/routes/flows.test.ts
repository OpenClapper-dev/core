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

  test("one editor at a time: another holder's save is refused while the lock is held", async () => {
    const id = uuid();
    await ok(api(u.token, "PUT", `/api/files/${id}`, { type: "flow", project_id: project }), 201);
    await ok(api(u.token, "POST", `/api/files/${id}/lock`, { holder: "window-aaaa" }));
    await ok(api(u.token, "PUT", `/api/files/${id}`, { body: { durationMs: 5000, loop: false, tracks: [], markers: [] } }), 423);
  });
});
