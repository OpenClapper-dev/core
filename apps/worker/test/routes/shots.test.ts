/**
 * Shots, sets and locations (step B6, #378; progressions as files, #426 feedback 4): content lists,
 * progressions inside a shot and what they may show, internal files, the default frame's lens in use,
 * the migration from a shot's body, the places in the template.
 */
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, test } from "vitest";
import { STARTERS } from "@openclapper/model";
import { addPhoto, api, newUser, ok, uuid, type User } from "./helpers.ts";

let u: User;
let project: string;
beforeAll(async () => { u = await newUser(); });

async function newProject() { const id = uuid(); await ok(api(u.token, "PUT", `/api/projects/${id}`, { name: `P ${id}` }), 201); return (project = id); }
type F = { id: string; name: string; type: string; body: Record<string, unknown>; body_version: number; refs: { kind: string; to: string; data: unknown; missing: boolean }[]; internal_of: string | null; updated_at: string; error: string };
const put = (id: string, body: unknown, status: number | number[] = [200, 201], headers: Record<string, string> = {}) => ok<{ file: F; error: string }>(api(u.token, "PUT", `/api/files/${id}`, body, headers), status);
const get = async (id: string) => (await ok<{ file: F }>(api(u.token, "GET", `/api/files/${id}`))).file;
const post = (path: string, body: unknown, status: number | number[] = [200, 201, 204]) => ok<Record<string, unknown>>(api(u.token, "POST", path, body), status);
const prog = { timing: { mode: "each" }, frame: null, overlayShown: true };
const canvas = (extra: Record<string, unknown> = {}) => ({ type: "canvas", project_id: project, body: { surface: { kind: "blank", aspect: 1.5, color: 0 }, objects: [], frames: [], picture: null, linkCentres: true, comments: [] }, ...extra });
/** A shot with one progression inside it, listed in its content. */
async function shotWithProgression(body: Record<string, unknown> = prog) {
  const s = uuid(), p = uuid();
  await put(s, { type: "shot", project_id: project }, 201);
  await put(p, { type: "progression", project_id: project, name: "Progression 1", internal_of: s, body }, 201);
  await put(s, { refs: [{ kind: "content", to: p }] });
  return { s, p };
}

describe("shots", () => {
  test("a new shot has an empty body; content points at any file, a missing one stays in its place", async () => {
    await newProject();
    const s = uuid(), photo = await addPhoto(u.token, project), folder = uuid(), gone = uuid();
    await put(folder, { type: "folder", project_id: project, name: "Refs" }, 201);
    const made = (await put(s, { type: "shot", project_id: project }, 201)).file;
    expect(made.body).toEqual({});
    expect(made.body_version).toBe(3);
    const f = (await put(s, { refs: [{ kind: "content", to: photo }, { kind: "content", to: folder }, { kind: "content", to: gone }] })).file;
    expect(f.refs.map((r) => [r.to, r.missing])).toEqual([[photo, false], [folder, false], [gone, true]]);
    // Items belong to a progression, not to the shot.
    expect((await put(s, { refs: [{ kind: "item", to: photo, data: { ms: 1000 } }] }, 400)).error).toMatch(/keeps no "item" references/);
  });

  test("a progression is made inside a shot only, and stays there", async () => {
    await newProject();
    const set = uuid(), lone = uuid(), inSet = uuid();
    await put(set, { type: "set", project_id: project }, 201);
    expect((await put(lone, { type: "progression", project_id: project, body: prog }, 400)).error).toMatch(/made inside a shot/);
    expect((await put(inSet, { type: "progression", project_id: project, internal_of: set, body: prog }, 400)).error).toMatch(/made inside a shot/);
    const { p } = await shotWithProgression();
    expect((await post(`/api/files/${p}/release`, {}, 400)).error).toMatch(/lives inside its shot/);
    const listed = await ok<{ files: { id: string }[] }>(api(u.token, "GET", `/api/files?project_id=${project}&type=progression`));
    expect(listed.files).toHaveLength(0);
  });

  test("a progression shows pictures only; the overlay is a canvas; a zoom block covers a canvas's frames", async () => {
    await newProject();
    const photo = await addPhoto(u.token, project), c = uuid(), folder = uuid();
    await put(c, canvas(), 201);
    await put(folder, { type: "folder", project_id: project, name: "F" }, 201);
    const { p } = await shotWithProgression();
    await put(p, { refs: [{ kind: "item", to: photo, data: { ms: 1500 } }, { kind: "item", to: c, data: { ms: 800, zoom: { mode: "steps", ease: false } } }, { kind: "overlay", to: c }] });
    expect((await put(p, { refs: [{ kind: "item", to: folder, data: { ms: 1000 } }] }, 400)).error).toMatch(/item of a progression is a photo or canvas, not a folder/);
    expect((await put(p, { refs: [{ kind: "overlay", to: photo }] }, 400)).error).toMatch(/overlay of a progression is a canvas/);
    expect((await put(p, { body: { ...prog, timing: { mode: "even" } } }, 400)).error).toMatch(/one length/);
  });

  test("a progression is edited under its shot's lock, and a save marks the shot changed", async () => {
    await newProject();
    const { s, p } = await shotWithProgression();
    const before = (await get(s)).updated_at;
    await ok(api(u.token, "POST", `/api/files/${s}/lock`, { holder: "wholder00001" }));
    await put(p, { body: { ...prog, overlayShown: false } }, 423);
    await put(p, { body: { ...prog, overlayShown: false } }, 200, { "x-lock-holder": "wholder00001" });
    expect((await get(s)).updated_at > before).toBe(true);
    // A new progression inside a shot someone else edits is refused too.
    await put(uuid(), { type: "progression", project_id: project, internal_of: s, body: prog }, 423);
  });

  test("files made inside a shot are internal: hidden, binned and copied with it, nested ones too", async () => {
    await newProject();
    const { s, p } = await shotWithProgression();
    const c = uuid(), o = uuid();
    await put(c, canvas({ internal_of: p }), 201);
    await put(o, canvas({ internal_of: p }), 201);
    await put(p, { refs: [{ kind: "item", to: c, data: { ms: 1000, zoom: { mode: "smooth", ease: true } } }, { kind: "overlay", to: o }] });
    const listed = await ok<{ files: { id: string }[] }>(api(u.token, "GET", `/api/files?project_id=${project}&type=canvas`));
    expect(listed.files.map((f) => f.id)).not.toContain(c);
    const all = await ok<{ files: { id: string }[] }>(api(u.token, "GET", `/api/files?project_id=${project}&type=canvas,progression&internal=1`));
    expect(all.files.map((f) => f.id).sort()).toEqual([c, o, p].sort());
    // A copy of the shot takes a copy of its progression and of the progression's canvases, each pointing at the copies.
    const copy = uuid();
    await post(`/api/files/${s}/duplicate`, { id: copy });
    const cs = await get(copy);
    const [cp] = (await ok<{ files: F[] }>(api(u.token, "GET", `/api/files?project_id=${project}&internal_of=${copy}`))).files;
    expect(cp.type).toBe("progression");
    expect(cs.refs.map((r) => r.to)).toEqual([cp.id]);
    const inner = (await ok<{ files: F[] }>(api(u.token, "GET", `/api/files?project_id=${project}&internal_of=${cp.id}`))).files;
    expect(inner).toHaveLength(2);
    expect((await get(cp.id)).refs.map((r) => r.to).sort()).toEqual(inner.map((f) => f.id).sort());
    // A copy of the progression alone stays inside the same shot.
    const dup = uuid();
    await post(`/api/files/${p}/duplicate`, { id: dup });
    expect((await get(dup)).internal_of).toBe(s);
    // Binning the shot takes its progression and its canvases along.
    await post("/api/files/bin", { ids: [s] });
    for (const id of [p, c, o, dup]) expect((await get(id) as unknown as { deleted_at: string | null }).deleted_at).toBeTruthy();
  });

  test("a progression's default frame from a preset keeps that lens in use", async () => {
    await newProject();
    const preset = uuid();
    const presetBody = { format: [36, 24], formatName: null, multiplier: 1, squeeze: 1, delivery: null, lenses: { kind: "primes", primes: [24, 35] }, archived: false };
    await put(preset, { type: "preset", project_id: project, body: presetBody }, 201);
    const { p } = await shotWithProgression({ ...prog, frame: { kind: "preset", preset, focal: 35, portrait: false } });
    expect((await env.DB.prepare("SELECT frame_id, focal FROM frames WHERE canvas_id = ?1").bind(p).all()).results).toEqual([{ frame_id: "default", focal: 35 }]);
    expect((await put(preset, { body: { ...presetBody, lenses: { kind: "primes", primes: [24] } } }, 400)).error).toMatch(/35 mm is used/);
    await put(p, { body: prog });
    await put(preset, { body: { ...presetBody, lenses: { kind: "primes", primes: [24] } } });
  });

  test("migration 0013 turns a shot's progression into a progression file inside it", async () => {
    await newProject();
    const preset = uuid(), photo = await addPhoto(u.token, project);
    await put(preset, { type: "preset", project_id: project, body: { format: [36, 24], formatName: null, multiplier: 1, squeeze: 1, delivery: null, lenses: { kind: "primes", primes: [35] }, archived: false } }, 201);
    // Shots as the old model stored them, written straight into the tables.
    const s = uuid(), plain = uuid(), empty = uuid(), gen = uuid(), listed = uuid(), user = u.id;
    const old = { timing: { mode: "each" }, frame: { kind: "preset", preset, focal: 35, portrait: false }, overlayShown: false };
    const row = (id: string, type: string, body: unknown, version: number, internalOf: string | null = null) =>
      env.DB.prepare("INSERT INTO files (id, project_id, type, name, internal_of, created_by, body, body_version) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)").bind(id, project, type, `${type} ${id.slice(0, 4)}`, internalOf, user, JSON.stringify(body), version);
    const ref = (from: string, kind: string, pos: number, to: string, data: unknown = null) =>
      env.DB.prepare("INSERT INTO refs (from_file, kind, position, to_file, data) VALUES (?1, ?2, ?3, ?4, ?5)").bind(from, kind, pos, to, data ? JSON.stringify(data) : null);
    await env.DB.batch([
      row(s, "shot", { progression: old }, 2), row(plain, "shot", { progression: null }, 2), row(empty, "shot", { progression: prog }, 2),
      row(gen, "canvas", {}, 1, s), row(listed, "canvas", {}, 1, s),
      ref(s, "content", 0, photo), ref(s, "content", 1, listed),
      ref(s, "item", 2, gen, { ms: 1000, frame: "z0" }), ref(s, "item", 3, listed, { ms: 500 }), ref(s, "overlay", 4, gen),
      ref(empty, "content", 0, photo),
      env.DB.prepare("INSERT INTO frames (canvas_id, frame_id, preset_id, focal, is_picture) VALUES (?1, 'default', ?2, 35, 0)").bind(s, preset),
    ]);
    const m = env.TEST_MIGRATIONS.find((x) => x.name.startsWith("0013"))!;
    await env.DB.batch(m.queries.map((q) => env.DB.prepare(q)));

    const shot = await get(s);
    expect(shot.body).toEqual({});
    expect(shot.body_version).toBe(3);
    const pid = shot.refs[0].to;
    expect(shot.refs.map((r) => [r.kind, r.to])).toEqual([["content", pid], ["content", photo], ["content", listed]]);
    const p = await get(pid);
    expect(p).toMatchObject({ type: "progression", internal_of: s, body: old, body_version: 1 });
    expect(pid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(p.refs.map((r) => [r.kind, r.to, r.data])).toEqual([["item", gen, { ms: 1000, frame: "z0" }], ["item", listed, { ms: 500 }], ["overlay", gen, null]]);
    // The generator's canvas moved inside the progression; the one the content lists stays the shot's.
    expect((await get(gen)).internal_of).toBe(pid);
    expect((await get(listed)).internal_of).toBe(s);
    expect((await env.DB.prepare("SELECT canvas_id FROM frames WHERE preset_id = ?1").bind(preset).all()).results).toEqual([{ canvas_id: pid }]);
    // Without a progression nothing is made; an empty one goes last in the content.
    expect((await get(plain)).refs).toEqual([]);
    const e = await get(empty);
    expect(e.refs.map((r) => r.to)[0]).toBe(photo);
    expect((await get(e.refs[1].to)).type).toBe("progression");
    // What the server saves from now on passes the model's rules.
    await put(pid, { body: old });
    await put(s, { name: "Shot 1" });
  });
});

describe("sets and locations", () => {
  test("they hold a content list; the properties their views offer link shots to sets and sets to locations", async () => {
    await newProject();
    const set = uuid(), loc = uuid(), photo = await addPhoto(u.token, project);
    expect((await put(set, { type: "set", project_id: project }, 201)).file.name).toMatch(/^Set/);
    await put(loc, { type: "location", project_id: project, refs: [{ kind: "content", to: photo }] }, 201);
    await put(loc, { refs: [{ kind: "item", to: photo, data: { ms: 1000 } }] }, 400);
    // A new project has none of them; the Studio adds them from STARTERS, in Settings.
    const settings = (await ok<{ files: F[] }>(api(u.token, "GET", `/api/files?project_id=${project}&type=folder`))).files.find((f) => f.name === "Settings")!.id;
    const ids: Record<string, string> = {};
    for (const [k, t] of Object.entries(STARTERS)) { ids[k] = uuid(); await put(ids[k], { type: "property", project_id: project, name: t.name, container: settings, body: { ...t.def, order: 0 } }, 201); }
    const shot = uuid();
    await put(shot, { type: "shot", project_id: project }, 201);
    const values = (v: Record<string, unknown>, id: string) => ok<{ values: Record<string, unknown> }>(api(u.token, "PUT", `/api/files/${id}/properties`, { values: v }));
    expect((await values({ [ids.set]: [set] }, shot)).values).toEqual({ [ids.set]: [set] });
    expect((await values({ [ids.locations]: [loc] }, set)).values).toEqual({ [ids.locations]: [loc] });
    expect((await values({ [ids.position]: { lat: 52.5, lng: 13.4 } }, loc)).values).toEqual({ [ids.position]: { lat: 52.5, lng: 13.4 } });
  });
});

describe("timelines", () => {
  test("clips show photos, canvases and shots, or are placeholders; the project keeps the master order", async () => {
    await newProject();
    const t = uuid(), photo = await addPhoto(u.token, project), shot = uuid(), folder = uuid();
    await put(shot, { type: "shot", project_id: project }, 201);
    await put(folder, { type: "folder", project_id: project, name: "F" }, 201);
    const clips = [{ id: "c1", file: photo, ms: 2000, chapter: { title: "Arrival", color: 3 } }, { id: "c2", file: null, ms: 1500, title: "Insert" }, { id: "c3", file: shot, ms: 3000 }];
    const refs = [{ kind: "clip", to: photo, data: { clip: "c1" } }, { kind: "clip", to: shot, data: { clip: "c3" } }];
    const made = (await put(t, { type: "timeline", project_id: project, body: { clips, holdMs: null }, refs }, 201)).file;
    expect(made.refs.map((r) => r.to)).toEqual([photo, shot]);
    expect((await put(t, { body: { clips: [{ id: "c1", file: folder, ms: 1000 }], holdMs: null }, refs: [{ kind: "clip", to: folder, data: { clip: "c1" } }] }, 400)).error).toMatch(/clip of a timeline is a photo or canvas or shot/);
    // The lock: a timeline is edited by one window at a time.
    await ok(api(u.token, "POST", `/api/files/${t}/lock`, { holder: "wholder00001" }));
    await put(t, { name: "Scene 12" }, 423);
    // The master timeline.
    const p = await ok<{ project: { master: string[] } }>(api(u.token, "PUT", `/api/projects/${project}`, { name: `P ${project}`, master: [t] }));
    expect(p.project.master).toEqual([t]);
    await ok(api(u.token, "PUT", `/api/projects/${project}`, { name: `P ${project}`, master: [t, t] }), 400);
  });
});
