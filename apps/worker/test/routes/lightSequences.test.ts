/**
 * Light sequences (#304): stored per project, checked strictly, lights of other workspaces unassigned.
 * Workspace isolation is in tenancy.test.ts.
 */
import { beforeAll, describe, expect, test } from "vitest";
import { api, buildWorld, newUser, ok, sequenceBody, uuid, type User, type World } from "./helpers.ts";

let u: User, w: World, other: World;
beforeAll(async () => { u = await newUser(); w = await buildWorld(u); other = await buildWorld(await newUser()); });

type Seq = { id: string; project_id: string; name: string; duration_ms: number; loop: boolean; tracks: { fixtureId: string | null; keyframes: unknown[] }[] };

describe("light sequences", () => {
  test("saved whole, listed per project, deleted", async () => {
    const id = uuid();
    const made = await ok<{ light_sequence: Seq }>(api(u.token, "PUT", `/api/light-sequences/${id}`, { ...sequenceBody(w.project, "Dusk", w.fixture), loop: true }));
    expect(made.light_sequence).toMatchObject({ id, project_id: w.project, name: "Dusk", duration_ms: 10_000, loop: true });
    expect(made.light_sequence.tracks[0]).toMatchObject({ fixtureId: w.fixture, keyframes: [{ id: "start" }, { id: "k1", fadeIn: "s" }] });
    const one = await ok<{ light_sequence: Seq }>(api(u.token, "GET", `/api/light-sequences/${id}`));
    expect(one.light_sequence).toMatchObject({ id, name: "Dusk", loop: true });
    const list = await ok<{ light_sequences: Seq[] }>(api(u.token, "GET", `/api/light-sequences?project_id=${w.project}`));
    expect(list.light_sequences.map((s) => s.id)).toContain(id);
    await ok(api(u.token, "DELETE", `/api/light-sequences/${id}`));
    await ok(api(u.token, "DELETE", `/api/light-sequences/${id}`), 404);
  });

  test("a light of another workspace is unassigned, not refused", async () => {
    const saved = await ok<{ light_sequence: Seq }>(api(u.token, "PUT", `/api/light-sequences/${uuid()}`, sequenceBody(w.project, "Borrowed", other.fixture)));
    expect(saved.light_sequence.tracks[0].fixtureId).toBeNull();
  });

  test("checked strictly: tracks, keyframes, length", async () => {
    const put = (body: unknown) => api(u.token, "PUT", `/api/light-sequences/${uuid()}`, body);
    const base = sequenceBody(w.project, "Bad");
    await ok(put({ ...base, duration_ms: 50 }), 400);
    await ok(put({ ...base, tracks: [{ ...base.tracks[0], kindId: "laser" }] }), 400);
    await ok(put({ ...base, tracks: [{ ...base.tracks[0], keyframes: [{ id: "k", at: 0 }] }] }), 400);
    await ok(put({ ...base, tracks: [{ ...base.tracks[0], keyframes: [...base.tracks[0].keyframes, { id: "late", at: 20_000 }] }] }), 400);
  });
});

describe("track colours and markers (#323)", () => {
  test("saved and returned; a marker on a removed track goes across the sequence; checked strictly", async () => {
    const base = sequenceBody(w.project, "Marked");
    const id = uuid();
    const body = {
      ...base,
      tracks: [{ ...base.tracks[0], color: 3 }],
      markers: [{ id: "m1", at: 1000, name: "Intro" }, { id: "m2", at: 2000, end: 4000, name: "Storm", trackId: "t1" }, { id: "m3", at: 5000, name: "Gone", trackId: "nope", extra: 1 }],
    };
    const saved = await ok<{ light_sequence: Seq & { markers: unknown[]; tracks: { color?: number }[] } }>(api(u.token, "PUT", `/api/light-sequences/${id}`, body));
    expect(saved.light_sequence.tracks[0].color).toBe(3);
    expect(saved.light_sequence.markers).toEqual([{ id: "m1", at: 1000, name: "Intro" }, { id: "m2", at: 2000, end: 4000, name: "Storm", trackId: "t1" }, { id: "m3", at: 5000, name: "Gone" }]);
    const put = (b: unknown) => api(u.token, "PUT", `/api/light-sequences/${uuid()}`, b);
    await ok(put({ ...base, tracks: [{ ...base.tracks[0], color: 8 }] }), 400);
    await ok(put({ ...base, markers: [{ id: "m", at: 3000, end: 2000, name: "Backwards" }] }), 400);
    await ok(put({ ...base, markers: [{ id: "m", at: 20_000, name: "Late" }] }), 400);
  });
});
