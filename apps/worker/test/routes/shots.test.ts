/**
 * Shots, sets and locations (step B6, #378): content lists, the progression and what it may show,
 * internal canvases made inside a shot, the default frame's lens in use, the places in the template.
 */
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, test } from "vitest";
import { addPhoto, api, newUser, ok, uuid, type User } from "./helpers.ts";

let u: User;
let project: string;
beforeAll(async () => { u = await newUser(); });

async function newProject() { const id = uuid(); await ok(api(u.token, "PUT", `/api/projects/${id}`, { name: `P ${id}` }), 201); return (project = id); }
type F = { id: string; name: string; body: Record<string, unknown>; refs: { kind: string; to: string; data: unknown; missing: boolean }[]; internal_of: string | null; error: string };
const put = (id: string, body: unknown, status: number | number[] = [200, 201]) => ok<{ file: F; error: string }>(api(u.token, "PUT", `/api/files/${id}`, body), status);
const post = (path: string, body: unknown, status: number | number[] = [200, 201, 204]) => ok<Record<string, unknown>>(api(u.token, "POST", path, body), status);
const prog = { timing: { mode: "each" }, frame: null, overlayShown: true };
const canvas = (extra: Record<string, unknown> = {}) => ({ type: "canvas", project_id: project, body: { surface: { kind: "blank", aspect: 1.5, color: 0 }, objects: [], frames: [], picture: null, linkCentres: true, comments: [] }, ...extra });

describe("shots", () => {
  test("a new shot has no progression; content points at any file, a missing one stays in its place", async () => {
    await newProject();
    const s = uuid(), photo = await addPhoto(u.token, project), folder = uuid(), gone = uuid();
    await put(folder, { type: "folder", project_id: project, name: "Refs" }, 201);
    expect((await put(s, { type: "shot", project_id: project }, 201)).file.body).toEqual({ progression: null });
    const f = (await put(s, { refs: [{ kind: "content", to: photo }, { kind: "content", to: folder }, { kind: "content", to: gone }] })).file;
    expect(f.refs.map((r) => [r.to, r.missing])).toEqual([[photo, false], [folder, false], [gone, true]]);
    // Items need a progression.
    expect((await put(s, { refs: [{ kind: "item", to: photo, data: { ms: 1000 } }] }, 400)).error).toMatch(/belong to a progression/);
  });

  test("a progression shows pictures only; the overlay is a canvas", async () => {
    await newProject();
    const s = uuid(), photo = await addPhoto(u.token, project), c = uuid(), folder = uuid();
    await put(c, canvas(), 201);
    await put(folder, { type: "folder", project_id: project, name: "F" }, 201);
    await put(s, { type: "shot", project_id: project, body: { progression: prog }, refs: [{ kind: "item", to: photo, data: { ms: 1500 } }, { kind: "item", to: c, data: { ms: 800 } }, { kind: "overlay", to: c }] }, 201);
    expect((await put(s, { refs: [{ kind: "item", to: folder, data: { ms: 1000 } }] }, 400)).error).toMatch(/item of a shot is a photo or canvas, not a folder/);
    expect((await put(s, { refs: [{ kind: "overlay", to: photo }] }, 400)).error).toMatch(/overlay of a shot is a canvas/);
  });

  test("a canvas made inside a shot is internal: hidden, binned and copied with it, released one way", async () => {
    await newProject();
    const s = uuid(), c = uuid();
    await put(s, { type: "shot", project_id: project, body: { progression: prog } }, 201);
    await put(c, canvas({ internal_of: s }), 201);
    await put(s, { refs: [{ kind: "item", to: c, data: { ms: 1000 } }, { kind: "overlay", to: c }] });
    const listed = await ok<{ files: { id: string }[] }>(api(u.token, "GET", `/api/files?project_id=${project}&type=canvas`));
    expect(listed.files.map((f) => f.id)).not.toContain(c);
    const all = await ok<{ files: { id: string }[] }>(api(u.token, "GET", `/api/files?project_id=${project}&type=canvas&internal=1`));
    expect(all.files.map((f) => f.id)).toContain(c);
    // A copy of the shot takes a copy of its canvas and points at it.
    const copy = uuid();
    await post(`/api/files/${s}/duplicate`, { id: copy });
    const cf = (await ok<{ file: F }>(api(u.token, "GET", `/api/files/${copy}`))).file;
    const inner = await ok<{ files: { id: string }[] }>(api(u.token, "GET", `/api/files?project_id=${project}&internal_of=${copy}`));
    expect(inner.files).toHaveLength(1);
    expect(cf.refs.map((r) => r.to)).toEqual([inner.files[0].id, inner.files[0].id]);
    // Binning the shot takes its canvas along.
    await post("/api/files/bin", { ids: [s] });
    expect((await ok<{ file: { deleted_at: string | null } }>(api(u.token, "GET", `/api/files/${c}`))).file.deleted_at).toBeTruthy();
  });

  test("a default frame from a preset keeps that lens in use", async () => {
    await newProject();
    const p = uuid(), s = uuid();
    const preset = { format: [36, 24], formatName: null, multiplier: 1, squeeze: 1, delivery: null, lenses: { kind: "primes", primes: [24, 35] }, archived: false };
    await put(p, { type: "preset", project_id: project, body: preset }, 201);
    await put(s, { type: "shot", project_id: project, body: { progression: { ...prog, frame: { kind: "preset", preset: p, focal: 35, portrait: false } } } }, 201);
    expect((await env.DB.prepare("SELECT frame_id, focal FROM frames WHERE canvas_id = ?1").bind(s).all()).results).toEqual([{ frame_id: "default", focal: 35 }]);
    expect((await put(p, { body: { ...preset, lenses: { kind: "primes", primes: [24] } } }, 400)).error).toMatch(/35 mm is used/);
    await put(s, { body: { progression: null } });
    await put(p, { body: { ...preset, lenses: { kind: "primes", primes: [24] } } });
  });
});

describe("sets and locations", () => {
  test("they hold a content list; a new project's template links shots to sets and sets to locations", async () => {
    await newProject();
    const set = uuid(), loc = uuid(), photo = await addPhoto(u.token, project);
    expect((await put(set, { type: "set", project_id: project }, 201)).file.name).toMatch(/^Set/);
    await put(loc, { type: "location", project_id: project, refs: [{ kind: "content", to: photo }] }, 201);
    await put(loc, { refs: [{ kind: "item", to: photo, data: { ms: 1000 } }] }, 400);
    const defs = await ok<{ files: { name: string; body: { field: string; targets?: string[]; attached: { type: string }[] } }[] }>(api(u.token, "GET", `/api/files?project_id=${project}&type=property&body=1`));
    const by = new Map(defs.files.map((f) => [f.name, f.body]));
    expect(by.get("Set")).toMatchObject({ field: "reference", targets: ["set"], attached: [{ type: "shot" }] });
    expect(by.get("Locations")).toMatchObject({ field: "reference", targets: ["location"], attached: [{ type: "set" }] });
    expect(by.get("Position")).toMatchObject({ field: "position", attached: [{ type: "location" }] });
    expect(by.get("Address")).toMatchObject({ attached: [{ type: "location" }] });
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
