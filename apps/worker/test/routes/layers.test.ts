/**
 * Layers and bakes (epic #275): strict layer upserts, what shots and timelines embed, bakes per
 * step, layers following merged photos, a clip's step and promoting a clip's own layer.
 */
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, test } from "vitest";
import { api, bakeForm, buildWorld, FRAME, layerBody, newUser, ok, photoMeta, snapshot, uploadForm, uuid, type User, type World } from "./helpers.ts";

interface Layer { id: string; shot_id: string; kind: string; photo_id: string | null; range: string[] | null; visible: boolean; shapes?: unknown[]; timeline_id: string | null; clip_id: string | null; position: number }
interface Shot { id: string; layers: Layer[]; bakes: { step_key: string; hash: string; url: string }[]; steps: { id: string }[] }
interface Timeline { clips: { id: string; step_id: string | null }[]; layers: Layer[] }

let u: User;
let w: World;
beforeEach(async () => {
  u ??= await newUser();
  w = await buildWorld(u);
});

const shot = (id: string) => ok<{ shot: Shot }>(api(u.token, "GET", `/api/shots/${id}`)).then((r) => r.shot);
const line = { id: "s1", type: "line", from: [0.1, 0.1], to: [0.5, 0.5], color: "#FFD60A", width: 0.006, opacity: 1 };
const look = { exposure: -0.5, contrast: 0, saturation: 0, bw: false, tint: null, tint_opacity: 0.3, vignette: 0, blur: 0 };

describe("layers", () => {
  test("a shot embeds its layers in stack order without shapes; the layer route and the shot's list carry them", async () => {
    const adj = uuid();
    await ok(api(u.token, "PUT", `/api/layers/${adj}`, layerBody(w.shot, "Grade", { kind: "adjustment", shapes: null, look, position: -1 })), 201);
    await ok(api(u.token, "PUT", `/api/layers/${w.layer}`, layerBody(w.shot, "Marks", { shapes: [line], range: [w.step] })));
    const s = await shot(w.shot);
    expect(s.layers.map((l) => l.id)).toEqual([adj, w.layer]);
    expect(s.layers.every((l) => !("shapes" in l))).toBe(true);
    expect((await ok<{ layer: Layer }>(api(u.token, "GET", `/api/layers/${w.layer}`))).layer.shapes).toEqual([line]);
    const full = await ok<{ layers: Layer[] }>(api(u.token, "GET", `/api/shots/${w.shot}/layers`));
    expect(full.layers.find((l) => l.id === w.layer)!.shapes).toEqual([line]);
  });

  test("is strict: a photo of another shot, a step that is not stored, a changed kind, another project's timeline, too many", async () => {
    const other = await buildWorld(u);
    const before = await snapshot();
    const cases: [string, unknown, number, RegExp][] = [
      [uuid(), layerBody(w.shot, "x", { space: "photo", photo_id: w.photo2 }), 400, /photo of the shot/],
      [uuid(), layerBody(w.shot, "x", { range: [uuid()] }), 400, /stored step/],
      [w.layer, layerBody(w.shot, "x", { kind: "adjustment", shapes: null, look }), 409, /kind/],
      [w.layer, layerBody(w.shot2, "x"), 409, /shot/],
      [uuid(), layerBody(w.shot, "x", { timeline_id: other.timeline, clip_id: other.clip }), 400, /timeline's project/],
      [uuid(), layerBody(w.shot, "x", { look }), 400, /no look/],
    ];
    for (const [id, body, status, re] of cases) {
      const res = await api(u.token, "PUT", `/api/layers/${id}`, body);
      expect(res.status, JSON.stringify(body).slice(0, 90)).toBe(status);
      expect(await res.text()).toMatch(re);
    }
    expect(await snapshot()).toBe(before);
  });

  test("a shot holds at most 50 layers", async () => {
    // 49 straight into D1 (the route is what is tested here, not 49 round trips).
    await env.DB.batch(Array.from({ length: 49 }, (_, i) => env.DB.prepare("INSERT INTO layers (id, shot_id, kind, name, space, shapes) VALUES (?1, ?2, 'drawing', ?3, 'frame', '[]')").bind(uuid(), w.shot2, `L${i}`)));
    await ok(api(u.token, "PUT", `/api/layers/${uuid()}`, layerBody(w.shot2, "one more")), 201);
    await ok(api(u.token, "PUT", `/api/layers/${uuid()}`, layerBody(w.shot2, "too many")), 413);
  });

  test("deleting a layer answers with the shot", async () => {
    const r = await ok<{ shot: Shot }>(api(u.token, "DELETE", `/api/layers/${w.layer}`));
    expect(r.shot.layers).toEqual([]);
    await ok(api(u.token, "GET", `/api/layers/${w.layer}`), 404);
  });
});

describe("bakes", () => {
  test("a bake is stored per step with its hash, replaces the previous image, and only for steps of the shot", async () => {
    const objects = () => env.SHOTS_BUCKET.list({ prefix: `bakes/${w.shot}/` }).then((r) => r.objects.map((o) => o.key));
    expect(await objects()).toEqual([`bakes/${w.shot}/${w.step}-0123456789abcdef.png`]);
    const r = await ok<{ shot: Shot }>(api(u.token, "PUT", `/api/shots/${w.shot}/bakes/${w.step}`, bakeForm("aaaaaaaaaaaaaaaa")));
    expect(r.shot.bakes).toEqual([{ step_key: w.step, hash: "aaaaaaaaaaaaaaaa", url: `/api/shots/${w.shot}/bakes/${w.step}?v=aaaaaaaaaaaaaaaa` }]);
    expect(await objects()).toEqual([`bakes/${w.shot}/${w.step}-aaaaaaaaaaaaaaaa.png`]);
    // The photo is not a step key while the shot has stored steps; another shot's step never is.
    await ok(api(u.token, "PUT", `/api/shots/${w.shot}/bakes/${w.photo}`, bakeForm()), 400);
    await ok(api(u.token, "PUT", `/api/shots/${w.shot2}/bakes/${w.step}`, bakeForm()), 400);
    await ok(api(u.token, "PUT", `/api/shots/${w.shot}/bakes/${w.step}`, bakeForm("not-a-hash")), 400);
    // A shot without stored steps bakes per photo.
    await ok(api(u.token, "PUT", `/api/shots/${w.shot2}/bakes/${w.photo2}`, bakeForm()));
    expect((await shot(w.shot2)).bakes.map((b) => b.step_key)).toEqual([w.photo2]);
  });
});

describe("merge and timelines", () => {
  test("merged photos bring their photo-space layers along (on every step), and an emptied source's frame layers arrive hidden", async () => {
    const photoLayer = uuid(), frameLayer = uuid();
    await ok(api(u.token, "PUT", `/api/layers/${photoLayer}`, layerBody(w.shot2, "On the photo", { space: "photo", photo_id: w.photo2 })), 201);
    await ok(api(u.token, "PUT", `/api/layers/${frameLayer}`, layerBody(w.shot2, "On the frame")), 201);
    const r = await ok<{ shot: Shot; removed_shot_ids: string[] }>(api(u.token, "POST", `/api/shots/${w.shot}/photos`, { photo_ids: [w.photo2] }));
    expect(r.removed_shot_ids).toEqual([w.shot2]);
    const by = new Map(r.shot.layers.map((l) => [l.id, l]));
    expect(by.get(photoLayer)).toMatchObject({ shot_id: w.shot, photo_id: w.photo2, range: null, visible: true });
    expect(by.get(frameLayer)).toMatchObject({ shot_id: w.shot, range: null, visible: false });
  });

  test("a clip shows a stored step of its own photo; another photo's step is nulled; timelines embed their clips' layers", async () => {
    const clip2 = uuid(), own = uuid();
    const t = await ok<{ timeline: Timeline }>(api(u.token, "PUT", `/api/timelines/${w.timeline}`, {
      project_id: w.project, name: "Cut",
      clips: [
        { id: w.clip, photo_id: w.photo, step_id: w.step, presentation: { mode: "fit", frame: FRAME }, duration_ms: 1000 },
        { id: clip2, photo_id: w.photo2, step_id: w.step, presentation: { mode: "fit", frame: FRAME }, duration_ms: 1000 },
      ],
    }));
    expect(t.timeline.clips.map((c) => c.step_id)).toEqual([w.step, null]);
    await ok(api(u.token, "PUT", `/api/layers/${own}`, layerBody(w.shot, "Clip marks", { timeline_id: w.timeline, clip_id: w.clip })), 201);
    const again = await ok<{ timeline: Timeline }>(api(u.token, "GET", `/api/timelines/${w.timeline}`));
    expect(again.timeline.layers.map((l) => l.id)).toEqual([own]);
    // Shots never embed a clip's own layers.
    expect((await shot(w.shot)).layers.map((l) => l.id)).toEqual([w.layer]);
    // A clip that leaves the timeline takes its layers along.
    await ok(api(u.token, "PUT", `/api/timelines/${w.timeline}`, { project_id: w.project, name: "Cut", clips: [] }));
    expect(await env.DB.prepare("SELECT 1 FROM layers WHERE id = ?1").bind(own).first()).toBeNull();
  });

  test("promoting a clip's own layer makes it the shot's, on the clip's step", async () => {
    await ok(api(u.token, "PUT", `/api/timelines/${w.timeline}`, { project_id: w.project, name: "Cut", clips: [{ id: w.clip, photo_id: w.photo, step_id: w.step, presentation: { mode: "fit", frame: FRAME }, duration_ms: 1000 }] }));
    const own = uuid();
    await ok(api(u.token, "PUT", `/api/layers/${own}`, layerBody(w.shot, "Clip marks", { timeline_id: w.timeline, clip_id: w.clip })), 201);
    const r = await ok<{ shot: Shot; timeline: Timeline }>(api(u.token, "POST", `/api/timelines/${w.timeline}/clips/${w.clip}/promote`, { what: "layer", layer_id: own }));
    expect(r.shot.layers.find((l) => l.id === own)).toMatchObject({ range: [w.step], timeline_id: null, clip_id: null });
    expect(r.timeline.layers).toEqual([]);
    await ok(api(u.token, "POST", `/api/timelines/${w.timeline}/clips/${w.clip}/promote`, { what: "layer", layer_id: own }), 409);
  });

  test("a clip's own layers can be copied for a duplicated clip", async () => {
    const own = uuid(), copy = uuid();
    await ok(api(u.token, "PUT", `/api/layers/${own}`, layerBody(w.shot, "Clip marks", { timeline_id: w.timeline, clip_id: w.clip, shapes: [line] })), 201);
    const r = await ok<{ layer: Layer }>(api(u.token, "POST", `/api/layers/${own}/copy`, { id: copy, timeline_id: w.timeline, clip_id: uuid() }), 201);
    expect(r.layer).toMatchObject({ id: copy, timeline_id: w.timeline, shapes: [line] });
    void photoMeta; void uploadForm;
  });
});
