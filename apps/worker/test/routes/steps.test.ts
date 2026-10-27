/**
 * Steps (issue #266): the stored progression of a shot, moving photos between shots (the merge
 * behind "Make a sequence") and extracting one photo as a shot of its own.
 */
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, test } from "vitest";
import { api, buildWorld, FRAME, layerBody, newUser, ok, photoMeta, snapshot, timelineBody, uploadForm, uuid, type User, type World } from "./helpers.ts";

interface Step { id: string; photo_id: string; framing_id: string | null; ordinal: number }
interface Shot { id: string; name: string | null; captured_at: string; photos: { id: string; ordinal: number; root_framing_id: string | null; framings: { id: string; name: string }[] }[]; layers: { id: string; shot_id: string; photo_id: string | null; range: string[] | null; visible: boolean }[]; bakes: { step_key: string }[]; sketches: { id: string }[]; steps: Step[] }

let u: User;
let w: World;
beforeEach(async () => {
  u ??= await newUser();
  w = await buildWorld(u);
});

const shot = (id: string) => ok<{ shot: Shot }>(api(u.token, "GET", `/api/shots/${id}`)).then((r) => r.shot);
const put = (id: string, steps: unknown, status: number | number[] = 200) => ok<{ shot: Shot }>(api(u.token, "PUT", `/api/shots/${id}/steps`, { steps }), status);
const keysOf = async (shotId: string) => (await env.DB.prepare("SELECT r2_object_key AS k FROM photos WHERE shot_id = ?1 ORDER BY ordinal").bind(shotId).all<{ k: string }>()).results.map((r) => r.k);

describe("PUT /api/shots/:id/steps", () => {
  test("stores the list in order, embeds it in the shot and the list, and [] resets", async () => {
    const a = uuid(), b = uuid();
    const r = await put(w.shot, [{ id: a, photo_id: w.photo }, { id: b, photo_id: w.photo, framing_id: w.framing }]);
    expect(r.shot.steps.map((s) => [s.id, s.ordinal, s.framing_id])).toEqual([[a, 0, null], [b, 1, w.framing]]);
    const listed = await ok<{ shots: Shot[] }>(api(u.token, "GET", `/api/shots?project_id=${w.project}`));
    expect(listed.shots.find((s) => s.id === w.shot)!.steps.map((s) => s.id)).toEqual([a, b]);
    expect((await put(w.shot, [])).shot.steps).toEqual([]);
  });

  test("is strict: another shot's photo, another photo's framing, duplicates, too many", async () => {
    const before = await snapshot();
    const cases: [unknown, RegExp][] = [
      [[{ id: uuid(), photo_id: w.photo2 }], /not one of the shot's photos/],
      [[{ id: uuid(), photo_id: w.photo, framing_id: uuid() }], /framing/],
      [[{ id: w.step, photo_id: w.photo }, { id: w.step, photo_id: w.photo }], /repeats/],
      [Array.from({ length: 501 }, () => ({ id: uuid(), photo_id: w.photo })), /at most/],
      ["nope", /array/],
    ];
    for (const [steps, re] of cases) {
      const res = await api(u.token, "PUT", `/api/shots/${w.shot}/steps`, { steps });
      expect(res.status).toBe(400);
      expect(await res.text()).toMatch(re);
    }
    expect(await snapshot()).toBe(before);
  });

  test("a deleted framing clears the reference; removed steps lose their bakes; a binned shot is 404", async () => {
    expect((await shot(w.shot)).bakes.map((b) => b.step_key)).toEqual([w.step]);
    await put(w.shot, [{ id: uuid(), photo_id: w.photo, framing_id: w.framing }]);
    expect((await shot(w.shot)).bakes).toEqual([]);
    await ok(api(u.token, "DELETE", `/api/framings/${w.framing}`));
    expect((await shot(w.shot)).steps[0].framing_id).toBeNull();
    await ok(api(u.token, "DELETE", `/api/shots/${w.shot}`));
    await put(w.shot, [], 404);
  });
});

describe("POST /api/shots/:id/photos (merge)", () => {
  test("moves the photos in order after the shot's own, deletes an emptied source with its sketch moved, recomputes captured_at", async () => {
    // A third shot with two photos, one of them in a sequence block of a second timeline.
    const shot3 = uuid(), p3a = uuid(), p3b = uuid(), tl2 = uuid(), c1 = uuid(), c2 = uuid(), g = uuid();
    await ok(api(u.token, "POST", "/api/shots", uploadForm({ id: shot3, project_id: w.project, name: "three", photos: [photoMeta(0, { id: p3a }), photoMeta(1, { id: p3b })] })), 201);
    await ok(api(u.token, "PUT", `/api/timelines/${tl2}`, {
      project_id: w.project, name: "two", groups: [{ id: g, mode: "each", total_ms: 2000, split: "even", edge_weight: 1.5 }],
      clips: [{ id: c1, photo_id: p3a, presentation: { mode: "fit", frame: FRAME }, duration_ms: 1000, group_id: g }, { id: c2, photo_id: p3b, presentation: { mode: "fit", frame: FRAME }, duration_ms: 1000, group_id: g }],
    }));
    const before = { keys: [...await keysOf(w.shot2), ...await keysOf(shot3)], photo2At: (await shot(w.shot2)).captured_at };
    const r = await ok<{ shot: Shot; removed_shot_ids: string[] }>(api(u.token, "POST", `/api/shots/${w.shot}/photos`, { photo_ids: [p3b, w.photo2], steps: [{ id: uuid(), photo_id: p3b }, { id: uuid(), photo_id: w.photo }] }));
    expect(r.shot.photos.map((p) => [p.id, p.ordinal])).toEqual([[w.photo, 0], [p3b, 1], [w.photo2, 2]]);
    expect(r.shot.steps.map((s) => s.photo_id)).toEqual([p3b, w.photo]);
    // shot2 had one photo: gone for good, its sketch now on the target; shot3 keeps p3a.
    expect(r.removed_shot_ids).toEqual([w.shot2]);
    expect(await env.DB.prepare("SELECT 1 FROM shots WHERE id = ?1").bind(w.shot2).first()).toBeNull();
    expect(r.shot.sketches.map((s) => s.id)).toContain(w.sketch);
    expect((await shot(shot3)).photos.map((p) => p.id)).toEqual([p3a]);
    // Images stay where they are; captured_at is the earliest photo.
    for (const k of before.keys) expect(await env.SHOTS_BUCKET.head(k), k).not.toBeNull();
    expect(r.shot.captured_at <= before.photo2At).toBe(true);
    // The moved photo's clip left its block; the block keeps p3a.
    const t = await ok<{ timeline: { clips: { id: string; shot_id: string; group_id: string | null }[] } }>(api(u.token, "GET", `/api/timelines/${tl2}`));
    expect(t.timeline.clips.map((c) => [c.id, c.group_id])).toEqual([[c1, g], [c2, null]]);
    expect(t.timeline.clips[1].shot_id).toBe(w.shot);
  });

  test("refuses another project's photo, a photo already in the shot, a binned source, and too many", async () => {
    const other = await buildWorld(u);
    const before = await snapshot();
    const cases: [unknown, number, RegExp][] = [
      [{ photo_ids: [other.photo] }, 400, /same project/],
      [{ photo_ids: [uuid()] }, 400, /same project/],
      [{ photo_ids: [w.photo] }, 400, /already in this shot/],
      [{ photo_ids: [] }, 400, /non-empty/],
      [{ photo_ids: Array.from({ length: 201 }, () => uuid()) }, 413, /at most/],
      [{ photo_ids: [w.photo2], steps: [{ id: uuid(), photo_id: other.photo }] }, 400, /not one of the shot's photos/],
    ];
    for (const [body, status, re] of cases) {
      const res = await api(u.token, "POST", `/api/shots/${w.shot}/photos`, body);
      expect(res.status, JSON.stringify(body).slice(0, 80)).toBe(status);
      expect(await res.text()).toMatch(re);
    }
    await ok(api(u.token, "DELETE", `/api/shots/${w.shot2}`));
    const binned = await api(u.token, "POST", `/api/shots/${w.shot}/photos`, { photo_ids: [w.photo2] });
    expect(binned.status).toBe(400);
    await ok(api(u.token, "POST", `/api/trash/shot/${w.shot2}/restore`));
    expect(await snapshot()).toBe(before);
  });
});

describe("POST /api/shots/:id/photos/:photo/extract", () => {
  test("copies the photo, its object, framings and the layers the step shows into a new shot; the source is untouched", async () => {
    const before = await snapshot();
    const id = uuid();
    const r = await ok<{ shot: Shot }>(api(u.token, "POST", `/api/shots/${w.shot}/photos/${w.photo}/extract`, { id, framing_id: w.framing, step_id: w.step }), 201);
    expect(r.shot.id).toBe(id);
    expect(r.shot.name).toMatch(/· photo 1$/);
    expect(r.shot.photos).toHaveLength(1);
    const p = r.shot.photos[0];
    expect(p.id).not.toBe(w.photo);
    expect(p.framings).toHaveLength(1);
    expect(p.framings[0].id).not.toBe(w.framing);
    expect(p.root_framing_id).toBe(p.framings[0].id);
    // The step's layer (ranged to w.step) is on every step of the copy.
    expect(r.shot.layers).toHaveLength(1);
    expect(r.shot.layers[0]).toMatchObject({ shot_id: id, range: null });
    expect(r.shot.layers[0].id).not.toBe(w.layer);
    expect(r.shot.steps).toEqual([]);
    // A new object for the copy, the source's still there; the copy serves.
    const [srcKey] = await keysOf(w.shot), [newKey] = await keysOf(id);
    expect(newKey).not.toBe(srcKey);
    expect(await env.SHOTS_BUCKET.head(srcKey)).not.toBeNull();
    expect((await api(u.token, "GET", `/api/photos/${p.id}/image`)).status).toBe(200);
    // Source unchanged apart from nothing: deleting the copy leaves it whole.
    await ok(api(u.token, "DELETE", `/api/shots/${id}`));
    await ok(api(u.token, "DELETE", `/api/trash/shot/${id}`));
    expect(await snapshot()).toBe(before);
  });

  test("refuses a photo of another shot, a foreign framing, a taken id", async () => {
    const before = await snapshot();
    expect((await api(u.token, "POST", `/api/shots/${w.shot}/photos/${w.photo2}/extract`, {})).status).toBe(404);
    expect((await api(u.token, "POST", `/api/shots/${w.shot}/photos/${w.photo}/extract`, { framing_id: uuid() })).status).toBe(400);
    expect((await api(u.token, "POST", `/api/shots/${w.shot}/photos/${w.photo}/extract`, { step_id: uuid() })).status).toBe(400);
    expect((await api(u.token, "POST", `/api/shots/${w.shot}/photos/${w.photo}/extract`, { id: w.shot2 })).status).toBe(409);
    expect(await snapshot()).toBe(before);
  });
});

// `timelineBody` is what buildWorld uses; referenced so the import list stays honest if the helper changes.
void timelineBody;
void layerBody;
