/**
 * Canvases and optics presets (step B5, #377): a canvas on a photo with frames, the frames table and
 * the additive rule of presets, the edit lock, renders, copies and purges.
 */
import { env, exports } from "cloudflare:workers";
import { beforeAll, describe, expect, test } from "vitest";
import { addPhoto, api, newUser, ok, png, putRender, uuid, type User } from "./helpers.ts";

let u: User, other: User;
let project: string;
beforeAll(async () => { u = await newUser(); other = await newUser(); });

async function newProject() { const id = uuid(); await ok(api(u.token, "PUT", `/api/projects/${id}`, { name: `P ${id}` }), 201); return (project = id); }
const put = (id: string, body: unknown, status: number | number[] = [200, 201], headers: Record<string, string> = {}) => ok<{ file: { body: Record<string, unknown>; lock: unknown; updated_at: string }; error: string }>(api(u.token, "PUT", `/api/files/${id}`, body, headers), status);
const preset = { format: [36, 24], formatName: "Full frame (135)", multiplier: 1, squeeze: 1, delivery: null, lenses: { kind: "primes", primes: [24, 35, 50] }, archived: false };
const frame = (p: string, focal: number, id = `f${focal}`) => ({ id, name: `${focal} mm`, color: 1, kind: "preset", preset: p, focal, portrait: false, cx: 0.5, cy: 0.5, visible: true });
const canvasOn = (photo: string, frames: unknown[], picture: string | null = null) => ({
  type: "canvas", project_id: project, body: { surface: { kind: "photo" }, objects: [], frames, picture, linkCentres: true, comments: [] }, refs: [{ kind: "base", to: photo }],
});

describe("frames and presets", () => {
  test("a canvas on a photo keeps its frames; a preset's lens in use cannot go, the preset cannot be binned, only archived", async () => {
    await newProject();
    const p = uuid(), photo = await addPhoto(u.token, project), c = uuid();
    await put(p, { type: "preset", project_id: project, name: "FF primes", body: preset }, 201);
    await put(c, canvasOn(photo, [frame(p, 35), frame(p, 24)], "f35"), 201);
    const rows = (await env.DB.prepare("SELECT frame_id, preset_id, focal, is_picture FROM frames WHERE canvas_id = ?1 ORDER BY focal").bind(c).all()).results;
    expect(rows).toEqual([{ frame_id: "f24", preset_id: p, focal: 24, is_picture: 0 }, { frame_id: "f35", preset_id: p, focal: 35, is_picture: 1 }]);
    expect((await put(p, { body: { ...preset, lenses: { kind: "primes", primes: [24, 50] } } }, 400)).error).toMatch(/35 mm is used/);
    await put(p, { body: { ...preset, lenses: { kind: "primes", primes: [24, 35, 85] } } }, 200);
    expect((await put(p, { body: { ...preset, squeeze: 2 } }, 400)).error).toMatch(/cannot change/);
    expect((await ok<{ error: string }>(api(u.token, "POST", "/api/files/bin", { ids: [p] }), 409)).error).toMatch(/archive it instead/);
    await put(p, { body: { ...preset, lenses: { kind: "primes", primes: [24, 35, 85] }, archived: true } }, 200);
    // The frames go with their canvas's body: then the lens is free again.
    await put(c, canvasOn(photo, [frame(p, 24)], null), 200);
    await put(p, { body: { ...preset, lenses: { kind: "primes", primes: [24] }, archived: true } }, 200);
  });

  test("a frame from a preset needs a photo; the canvas checks its references", async () => {
    await newProject();
    const photo = await addPhoto(u.token, project);
    expect((await put(uuid(), { type: "canvas", project_id: project, body: { ...canvasOn(photo, []).body } }, 400)).error).toMatch(/base reference/);
    expect((await put(uuid(), { type: "canvas", project_id: project, body: { surface: { kind: "blank", aspect: 1.5, color: "#ffffff" }, objects: [], frames: [frame(uuid(), 35)], picture: null, linkCentres: true, comments: [] } }, 400)).error).toMatch(/base photo/);
  });
});

describe("the edit lock", () => {
  test("one window at a time: others cannot save while it holds the lock; it can be renewed and let go", async () => {
    await newProject();
    const c = uuid();
    await put(c, { type: "canvas", project_id: project }, 201);
    const lock = (holder: string, status = 200) => ok<{ lock: { by: string; until: string } }>(api(u.token, "POST", `/api/files/${c}/lock`, { holder }), status);
    expect((await lock("window-aaaa")).lock.by).toBe(u.id);
    await lock("window-aaaa");
    await lock("window-bbbb", 423);
    expect((await put(c, { name: "Mine" }, 423, { "x-lock-holder": "window-bbbb" })).error).toMatch(/someone else/);
    await put(c, { name: "Mine" }, 200, { "x-lock-holder": "window-aaaa" });
    expect((await ok<{ file: { lock: { by: string } } }>(api(u.token, "GET", `/api/files/${c}`))).file.lock.by).toBe(u.id);
    expect((await putRender(u.token, c, "render", png(), { "x-lock-holder": "window-bbbb" })).status).toBe(423);
    // Another window cannot let go of it; its holder can.
    expect((await api(u.token, "DELETE", `/api/files/${c}/lock?holder=window-bbbb`)).status).toBe(204);
    await lock("window-bbbb", 423);
    expect((await api(u.token, "DELETE", `/api/files/${c}/lock?holder=window-aaaa`)).status).toBe(204);
    await lock("window-bbbb");
  });

  test("a lock that ran out is free", async () => {
    await newProject();
    const c = uuid();
    await put(c, { type: "canvas", project_id: project }, 201);
    await env.DB.prepare("UPDATE files SET lock_by = ?2, lock_holder = 'gone-window', lock_until = ?3 WHERE id = ?1").bind(c, u.id, new Date(Date.now() - 1000).toISOString()).run();
    await put(c, { name: "Free" }, 200);
    await ok(api(u.token, "POST", `/api/files/${c}/lock`, { holder: "window-cccc" }), 200);
  });

  test("only lockable types take a lock", async () => {
    await newProject();
    const f = uuid();
    await put(f, { type: "folder", project_id: project }, 201);
    await ok(api(u.token, "POST", `/api/files/${f}/lock`, { holder: "window-aaaa" }), 400);
  });
});

describe("live updates", () => {
  test("a project's canvases are watched in realtime unless it says every 5 seconds; another value is refused", async () => {
    await newProject();
    const live = async () => (await ok<{ projects: { id: string; canvas_live: string }[] }>(api(u.token, "GET", "/api/projects"))).projects.find((p) => p.id === project)!.canvas_live;
    expect(await live()).toBe("realtime");
    await ok(api(u.token, "PUT", `/api/projects/${project}`, { name: `P ${project}`, canvas_live: "gradual" }));
    expect(await live()).toBe("gradual");
    await ok(api(u.token, "PUT", `/api/projects/${project}`, { name: `Q ${project}` }));
    expect(await live()).toBe("gradual");
    await ok(api(u.token, "PUT", `/api/projects/${project}`, { name: `Q ${project}`, canvas_live: "often" }), 400);
  });

  test("the live socket: the lock's window is the editor, others watch; what the editor sends reaches them", async () => {
    await newProject();
    const c = uuid();
    await put(c, { type: "canvas", project_id: project, body: { surface: { kind: "blank", aspect: 1.5, color: 0 }, objects: [], frames: [], picture: null, linkCentres: true, comments: [] } }, 201);
    const live = (holder: string) => api(u.token, "GET", `/api/canvases/${c}/live?holder=${holder}`, undefined, { Upgrade: "websocket" });
    expect((await api(u.token, "GET", `/api/canvases/${c}/live?holder=wviewer000001`)).status).toBe(426);
    expect((await api(other.token, "GET", `/api/canvases/${c}/live?holder=wviewer000001`, undefined, { Upgrade: "websocket" })).status).toBe(404);
    await ok(api(u.token, "POST", `/api/files/${c}/lock`, { holder: "weditor000001" }));
    const inbox: unknown[] = [];
    const viewer = (await live("wviewer000001")).webSocket!;
    viewer.accept();
    viewer.addEventListener("message", (e) => { inbox.push(JSON.parse(String(e.data))); });
    const editor = (await live("weditor000001")).webSocket!;
    editor.accept();
    const body = { surface: { kind: "blank", aspect: 1.5, color: 0 }, objects: [], frames: [], picture: null, linkCentres: true, comments: [] };
    editor.send(JSON.stringify({ type: "doc", body, base: null }));
    viewer.send(JSON.stringify({ type: "doc", body: { forged: true }, base: null }));
    editor.send(JSON.stringify({ type: "draft", draft: null }));
    await new Promise((r) => setTimeout(r, 200));
    // The lock was taken before the viewer came: it hears who holds it at once (#426).
    expect(inbox).toEqual([{ type: "editor", by: u.id }, { type: "editor", by: u.id }, { type: "doc", body, base: null }, { type: "draft", draft: null }]);
    editor.close(1000); viewer.close(1000);
    // A project that watches the content every 5 seconds still gets the lock live.
    await ok(api(u.token, "PUT", `/api/projects/${project}`, { name: `P ${project}`, canvas_live: "gradual" }));
    expect((await live("wviewer000002")).status).toBe(101);
  });

  test("the lock is live without an editor's socket: taken, saved and let go reach every watcher (#426)", async () => {
    await newProject();
    const c = uuid();
    const body = { surface: { kind: "blank", aspect: 1.5, color: 0 }, objects: [], frames: [], picture: null, linkCentres: true, comments: [] };
    await put(c, { type: "canvas", project_id: project, body }, 201);
    const inbox: unknown[] = [];
    const viewer = (await api(u.token, "GET", `/api/canvases/${c}/live?holder=wviewer000003`, undefined, { Upgrade: "websocket" })).webSocket!;
    viewer.accept();
    viewer.addEventListener("message", (e) => { inbox.push(JSON.parse(String(e.data))); });
    await ok(api(u.token, "POST", `/api/files/${c}/lock`, { holder: "wdevice000001" }));
    await ok(api(u.token, "PUT", `/api/files/${c}`, { body }, { "x-lock-holder": "wdevice000001" }));
    expect((await api(u.token, "DELETE", `/api/files/${c}/lock?holder=wdevice000001`)).status).toBe(204);
    await new Promise((r) => setTimeout(r, 200));
    expect(inbox).toEqual([{ type: "editor", by: null }, { type: "editor", by: u.id }, { type: "saved" }, { type: "editor", by: null }]);
    viewer.close(1000);
  });
});

describe("renders", () => {
  test("uploaded, read back, refused for another account, copied with the canvas and removed when purged", async () => {
    await newProject();
    const c = uuid();
    await put(c, { type: "canvas", project_id: project }, 201);
    expect((await api(u.token, "GET", `/api/canvases/${c}/image`)).status).toBe(404);
    expect((await putRender(u.token, c, "render", png("one"))).status).toBe(201);
    expect((await putRender(u.token, c, "thumbnail", png("thumb"))).status).toBe(201);
    expect((await putRender(other.token, c, "render", png("evil"))).status).toBe(404);
    expect((await putRender(u.token, c, "render", new TextEncoder().encode("not an image"))).status).toBe(415);
    const got = await api(u.token, "GET", `/api/canvases/${c}/image`);
    expect(got.status).toBe(200);
    expect(new TextDecoder().decode(new Uint8Array(await got.arrayBuffer())).endsWith("one")).toBe(true);
    const copy = uuid();
    await ok(api(u.token, "POST", `/api/files/${c}/duplicate`, { id: copy }), 201);
    expect((await api(u.token, "GET", `/api/canvases/${copy}/image?size=thumbnail`)).status).toBe(200);
    await ok(api(u.token, "POST", "/api/files/bin", { ids: [c] }));
    await ok(api(u.token, "POST", "/api/files/purge", { ids: [c] }));
    expect(await env.SHOTS_BUCKET.get(`canvases/${c}/render`)).toBeNull();
    expect(await env.SHOTS_BUCKET.get(`canvases/${copy}/render`)).not.toBeNull();
  });
});

describe("the web view", () => {
  test("hands the bearer session over as a cookie and goes to a path of this site only", async () => {
    // Not followed: the redirect is what the web view gets.
    const res = await exports.default.fetch(new Request("http://openclapper.test/api/web?to=" + encodeURIComponent("/#/embed/canvas/abc"), { headers: { Authorization: `Bearer ${u.token}` }, redirect: "manual" }));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/#/embed/canvas/abc");
    expect(res.headers.get("set-cookie")).toContain(`openclapper_session=${u.token}`);
    expect((await api(u.token, "GET", "/api/web?to=" + encodeURIComponent("//evil.example/"))).status).toBe(400);
    expect((await api(u.token, "GET", "/api/web?to=https://evil.example/")).status).toBe(400);
    expect((await api(null, "GET", "/api/web?to=/")).status).toBe(401);
  });
});
