/**
 * Workspace isolation on every route, generated from the registered routes (docs/testing.md).
 *
 * Every route of routes.ts must have an entry in ROUTES below, or the first test fails: a new
 * route cannot slip through without saying how another workspace is kept out of it.
 *   - `id`: user B sends the request for user A's resource. It must answer 403/404, never show A's
 *     data, and leave every row and R2 object as it was. Then A sends the same request, which must
 *     pass (so the refusal came from the workspace check, not from a bad request). Each case gets a
 *     fresh world of A's, so destructive requests do not affect each other.
 *   - `list`: B's response never contains any of A's ids or names.
 *   - `exempt`: not workspace-scoped, with the reason (and a test of its own where it matters).
 */
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, test } from "vitest";
import { publicRouter, router } from "../../src/routes.ts";
import { api, buildWorld, deviceBody, fixtureBody, FRAME, idsOf, layerBody, layoutBody, newUser, ok, bakeForm, photoMeta, sketchBody, snapshot, uploadForm, uuid, type User, type World } from "./helpers.ts";

interface IdCase {
  kind: "id";
  /** The path for A's resource. */
  path: (a: World) => string;
  /** The body; `actor` is the sender's own world, so B's attempt can point at B's own project, photo… */
  body?: (a: World, actor: World) => unknown;
  /** What B gets (default 403/404); a row named only in the body answers 400 like a missing one (tenancy.ts assertRef). */
  refused?: number[];
  /** What A's own request answers (default 200/201): past the workspace check is all that matters. */
  ownerStatus?: number[];
  /**
   * A per-user upsert keyed by a client id (devices): B's request writes B's own row under the same id
   * instead of being refused. `undo` removes that row; after it nothing of A's may have changed.
   */
  undo?: (a: World, b: User) => Promise<unknown>;
}
interface ListCase { kind: "list"; paths: (a: World) => string[] }
interface Exempt { kind: "exempt"; why: string }
type Case = IdCase | ListCase | Exempt;

const named = (a: World, what: string) => `${a.mark} ${what} renamed`;

/** Every route of the API router: "METHOD /pattern" → how its isolation is checked. */
const ROUTES: Record<string, Case> = {
  "GET /health": { kind: "list", paths: () => ["/health"] },
  "GET /api/me": { kind: "list", paths: () => ["/api/me"] },

  "GET /api/presets": { kind: "list", paths: () => ["/api/presets"] },
  "PUT /api/presets/:id": { kind: "id", path: (a) => `/api/presets/${a.preset}`, body: (a) => ({ name: named(a, "rig"), sensor_width_mm: 30, sensor_height_mm: 20 }) },
  "DELETE /api/presets/:id": { kind: "id", path: (a) => `/api/presets/${a.preset}` },

  "GET /api/mesh-networks": { kind: "list", paths: () => ["/api/mesh-networks"] },
  "PUT /api/mesh-networks/:id": { kind: "id", path: (a) => `/api/mesh-networks/${a.meshNetwork}`, body: (a) => ({ name: named(a, "mesh"), next_unicast: 3 }) },
  "DELETE /api/mesh-networks/:id": { kind: "id", path: (a) => `/api/mesh-networks/${a.meshNetwork}` },
  "GET /api/fixtures": { kind: "list", paths: () => ["/api/fixtures"] },
  // B names A's network as well: the realistic attack on the upsert.
  "PUT /api/fixtures/:id": { kind: "id", path: (a) => `/api/fixtures/${a.fixture}`, body: (a) => fixtureBody(named(a, "light"), { mesh_network_id: a.meshNetwork, mesh_unicast: 2 }) },
  "DELETE /api/fixtures/:id": { kind: "id", path: (a) => `/api/fixtures/${a.fixture}` },

  "GET /api/projects": { kind: "list", paths: () => ["/api/projects"] },
  "PUT /api/projects/:id": { kind: "id", path: (a) => `/api/projects/${a.project}`, body: (a) => ({ name: named(a, "project") }) },
  // A's project still has its shot: the delete answers 409 for A, past the workspace check.
  "DELETE /api/projects/:id": { kind: "id", path: (a) => `/api/projects/${a.project}`, ownerStatus: [409] },
  "PUT /api/projects/:id/fields": { kind: "id", path: (a) => `/api/projects/${a.project}/fields`, body: (a) => ({ field_ids: [a.field] }) },

  "GET /api/fields": { kind: "list", paths: (a) => ["/api/fields", `/api/fields?project_id=${a.project}`] },
  "PUT /api/fields/:id": { kind: "id", path: (a) => `/api/fields/${a.field}`, body: (a, actor) => ({ project_id: actor.project, definition: { key: "mood", label: named(a, "mood"), type: "text" } }) },
  "POST /api/fields/import": { kind: "id", path: () => "/api/fields/import", body: (a) => ({ project_id: a.project, fields: [{ key: "taken", label: "Taken", type: "text" }] }), refused: [400] },
  "DELETE /api/fields/:id": { kind: "id", path: (a) => `/api/fields/${a.field}` },

  "GET /api/days": { kind: "list", paths: (a) => ["/api/days", `/api/days?project_id=${a.project}`] },
  "GET /api/days/:id": { kind: "id", path: (a) => `/api/days/${a.day}` },
  "PUT /api/days/:id": { kind: "id", path: (a) => `/api/days/${a.day}`, body: (_a, actor) => ({ project_id: actor.project, date: "2026-12-24", shots: [] }) },
  "DELETE /api/days/:id": { kind: "id", path: (a) => `/api/days/${a.day}` },

  "GET /api/locations": { kind: "list", paths: (a) => ["/api/locations", `/api/locations?project_id=${a.project}`] },
  "PUT /api/locations/:id": { kind: "id", path: (a) => `/api/locations/${a.location}`, body: (a, actor) => ({ name: named(a, "location"), project_id: actor.project }) },
  "DELETE /api/locations/:id": { kind: "id", path: (a) => `/api/locations/${a.location}` },

  "GET /api/spots": { kind: "list", paths: (a) => ["/api/spots", `/api/spots?project_id=${a.project}`] },
  "PUT /api/spots/:id": { kind: "id", path: (a) => `/api/spots/${a.spot}`, body: (a, actor) => ({ name: named(a, "spot"), location_id: actor.location }) },
  "DELETE /api/spots/:id": { kind: "id", path: (a) => `/api/spots/${a.spot}` },

  "GET /api/shots": { kind: "list", paths: (a) => ["/api/shots", `/api/shots?project_id=${a.project}`, `/api/shots?location_id=${a.location}`] },
  "GET /api/shots/:id": { kind: "id", path: (a) => `/api/shots/${a.shot}` },
  // B adds a photo to A's shot id (an upload names the shot in its metadata).
  "POST /api/shots": {
    kind: "id", path: () => "/api/shots",
    body: (a, actor) => uploadForm({ id: a.shot, project_id: actor.project, photos: [photoMeta(5)] }),
  },
  "PATCH /api/shots/:id": { kind: "id", path: (a) => `/api/shots/${a.shot}`, body: (a) => ({ name: named(a, "shot"), state: "approved" }) },
  "PATCH /api/shots": { kind: "id", path: () => "/api/shots", body: (a) => ({ ids: [a.shot], set: { state: "archived" } }) },
  "DELETE /api/shots/:id": { kind: "id", path: (a) => `/api/shots/${a.shot}` },
  "GET /api/photos/:id/image": { kind: "id", path: (a) => `/api/photos/${a.photo}/image` },
  "PATCH /api/photos/:id": { kind: "id", path: (a) => `/api/photos/${a.photo}`, body: () => ({ lat: 1, lon: 2, all_in_shot: true }) },
  "PUT /api/shots/:id/steps": { kind: "id", path: (a) => `/api/shots/${a.shot}/steps`, body: (_a, actor) => ({ steps: [{ id: uuid(), photo_id: actor.photo }] }) },
  // B names B's own photo for A's shot: refused on the shot; A moves A's second photo in.
  "POST /api/shots/:id/photos": { kind: "id", path: (a) => `/api/shots/${a.shot}/photos`, body: (_a, actor) => ({ photo_ids: [actor.photo2] }) },
  "POST /api/shots/:id/photos/:photo/extract": { kind: "id", path: (a) => `/api/shots/${a.shot}/photos/${a.photo}/extract`, body: () => ({}) },

  "GET /api/views": { kind: "list", paths: () => ["/api/views"] },
  "PUT /api/views/:id": { kind: "id", path: (a) => `/api/views/${a.view}`, body: (a, actor) => ({ name: named(a, "view"), project_id: actor.project, filter: { match: "any", rules: [] } }) },
  "DELETE /api/views/:id": { kind: "id", path: (a) => `/api/views/${a.view}` },

  "GET /api/files": { kind: "id", path: (a) => `/api/files?project_id=${a.project}` },
  "PUT /api/folders/:id": { kind: "id", path: (a) => `/api/folders/${a.folder}`, body: (a) => ({ name: named(a, "folder") }) },
  "DELETE /api/folders/:id": { kind: "id", path: (a) => `/api/folders/${a.folder}` },
  "PUT /api/folder-items/:type/:id": { kind: "id", path: (a) => `/api/folder-items/shot/${a.shot}`, body: (a) => ({ folder_id: a.folder }) },
  "PUT /api/desktop/:id": { kind: "id", path: (a) => `/api/desktop/${a.desktop}`, body: () => ({ kind: "app", app_id: "gallery", x: 99, y: 99 }) },
  "DELETE /api/desktop/:id": { kind: "id", path: (a) => `/api/desktop/${a.desktop}` },

  "GET /api/trash": { kind: "id", path: (a) => `/api/trash?project_id=${a.project}` },
  "POST /api/trash/:type/:id/restore": { kind: "id", path: (a) => `/api/trash/view/${a.binnedView}/restore` },
  "DELETE /api/trash/:type/:id": { kind: "id", path: (a) => `/api/trash/view/${a.binnedView}` },
  "DELETE /api/trash": { kind: "id", path: (a) => `/api/trash?project_id=${a.project}` },

  "GET /api/shots/:id/layers": { kind: "id", path: (a) => `/api/shots/${a.shot}/layers` },
  "GET /api/layers/:id": { kind: "id", path: (a) => `/api/layers/${a.layer}` },
  // B names B's own shot for A's layer id: refused on the layer (the upsert must not take it over).
  "PUT /api/layers/:id": { kind: "id", path: (a) => `/api/layers/${a.layer}`, body: (a, actor) => layerBody(actor.shot, named(a, "layer")) },
  "DELETE /api/layers/:id": { kind: "id", path: (a) => `/api/layers/${a.layer}` },
  "POST /api/layers/:id/copy": { kind: "id", path: (a) => `/api/layers/${a.layer}/copy`, body: (_a, actor) => ({ id: uuid(), timeline_id: actor.timeline, clip_id: actor.clip }) },
  "PUT /api/shots/:id/bakes/:key": { kind: "id", path: (a) => `/api/shots/${a.shot}/bakes/${a.step}`, body: () => bakeForm("fedcba9876543210") },
  "GET /api/shots/:id/bakes/:key": { kind: "id", path: (a) => `/api/shots/${a.shot}/bakes/${a.step}` },
  "GET /api/sketches/:id": { kind: "id", path: (a) => `/api/sketches/${a.sketch}` },
  "PUT /api/sketches/:id": { kind: "id", path: (a) => `/api/sketches/${a.sketch}`, body: (a, actor) => sketchBody(actor.shot, named(a, "sketch")) },
  "PATCH /api/sketches/:id": { kind: "id", path: (a) => `/api/sketches/${a.sketch}`, body: (a) => ({ name: named(a, "sketch") }) },
  "DELETE /api/sketches/:id": { kind: "id", path: (a) => `/api/sketches/${a.sketch}` },
  "POST /api/sketches/:id/copy": { kind: "id", path: (a) => `/api/sketches/${a.sketch}/copy`, body: (_a, actor) => ({ id: uuid(), timeline_id: actor.timeline, clip_id: actor.clip }) },
  "GET /api/sketches/:id/render": { kind: "id", path: (a) => `/api/sketches/${a.sketch}/render` },

  "GET /api/timelines": { kind: "list", paths: (a) => ["/api/timelines", `/api/timelines?project_id=${a.project}`] },
  "GET /api/timelines/:id": { kind: "id", path: (a) => `/api/timelines/${a.timeline}` },
  "PUT /api/timelines/:id": { kind: "id", path: (a) => `/api/timelines/${a.timeline}`, body: (a, actor) => ({ project_id: actor.project, name: named(a, "timeline"), clips: [] }) },
  "DELETE /api/timelines/:id": { kind: "id", path: (a) => `/api/timelines/${a.timeline}` },
  "POST /api/timelines/:id/clips/:clip/promote": { kind: "id", path: (a) => `/api/timelines/${a.timeline}/clips/${a.clip}/promote`, body: () => ({ what: "framing" }) },

  "PUT /api/framings/:id": { kind: "id", path: (a) => `/api/framings/${a.framing}`, body: (a, actor) => ({ photo_id: actor.photo, name: named(a, "framing"), lens_mm: 85, frame: FRAME }) },
  "DELETE /api/framings/:id": { kind: "id", path: (a) => `/api/framings/${a.framing}` },
  "PUT /api/photos/:id/root": { kind: "id", path: (a) => `/api/photos/${a.photo}/root`, body: (a) => ({ framing_id: a.framing }) },

  "GET /api/viewfinder-layouts": { kind: "list", paths: () => ["/api/viewfinder-layouts"] },
  "PUT /api/viewfinder-layouts/:id": { kind: "id", path: (a) => `/api/viewfinder-layouts/${a.layout}`, body: (a) => layoutBody(named(a, "layout")) },
  "DELETE /api/viewfinder-layouts/:id": { kind: "id", path: (a) => `/api/viewfinder-layouts/${a.layout}` },

  "GET /api/devices": { kind: "list", paths: () => ["/api/devices"] },
  // The id is the phone's: B saving the same phone gets B's own row (#224), A's row and layouts stay as they were.
  "PUT /api/devices/:id": {
    kind: "id", path: (a) => `/api/devices/${a.device}`, body: (_a, actor) => deviceBody(`${actor.mark} device`), refused: [201],
    undo: (a, b) => env.DB.prepare("DELETE FROM devices WHERE user_id = ?1 AND id = ?2").bind(b.id, a.device).run(),
  },
  "DELETE /api/devices/:id": { kind: "id", path: (a) => `/api/devices/${a.device}` },

  "GET /api/preview/socket": { kind: "exempt", why: "no id: the room is picked by the caller's own user id (preview.ts)" },

  "GET /api/workspaces": { kind: "list", paths: () => ["/api/workspaces"] },
  "PUT /api/workspaces/:id": { kind: "id", path: (a) => `/api/workspaces/${a.workspace}`, body: (a) => ({ name: named(a, "ws") }) },
  "GET /api/workspaces/:id/members": { kind: "id", path: (a) => `/api/workspaces/${a.workspace}/members` },
  "POST /api/workspaces/:id/members": { kind: "id", path: (a) => `/api/workspaces/${a.workspace}/members`, body: (a) => ({ email: a.memberEmail, role: "viewer" }) },
  "DELETE /api/workspaces/:id/members/:user": { kind: "id", path: (a) => `/api/workspaces/${a.workspace}/members/${a.member}` },
};

/** The routes that run before sign-in (index.ts isPublic): covered by sessions.test.ts. */
const PUBLIC = ["GET /api/ping", "POST /api/auth/login", "POST /api/auth/password", "POST /api/auth/logout"];

const key = (r: { method: string; pattern: string }) => `${r.method} ${r.pattern}`;

test("every registered route has a tenancy case, and every case a route", () => {
  const registered = router.list().map(key);
  const missing = registered.filter((k) => !(k in ROUTES));
  expect(missing, "routes without a tenancy case: add them to ROUTES in test/routes/tenancy.test.ts").toEqual([]);
  expect(Object.keys(ROUTES).filter((k) => !registered.includes(k)), "cases for routes that no longer exist").toEqual([]);
  expect(publicRouter.list().map(key).sort(), "a new public route runs without a user: add it to PUBLIC deliberately").toEqual([...PUBLIC].sort());
});

describe("another workspace's resources", () => {
  let a: User, b: User, bWorld: World;
  const aIds = new Set<string>();
  const aMarks: string[] = [];
  let listWorld: World;

  /** B's response must not carry anything of A's: no id (except those B itself sent) and no name. */
  const leaks = (text: string, sent = "") => [...aIds].filter((id) => text.includes(id) && !sent.includes(id)).concat(aMarks.filter((m) => text.includes(m)));

  const fresh = async () => {
    const w = await buildWorld(a);
    idsOf(w).forEach((id) => aIds.add(id));
    aMarks.push(w.mark);
    return w;
  };

  beforeAll(async () => {
    [a, b] = await Promise.all([newUser(), newUser()]);
    bWorld = await buildWorld(b);
    listWorld = await fresh();
  });

  const idCases = Object.entries(ROUTES).filter((e): e is [string, IdCase] => e[1].kind === "id");
  test.each(idCases)("%s: refused for another workspace, allowed for its own", async (route, c) => {
    const [method] = route.split(" ");
    const w = await fresh();
    const path = c.path(w);
    const before = await snapshot();
    const res = await api(b.token, method, path, c.body?.(w, bWorld));
    const text = await res.text();
    expect(c.refused ?? [403, 404], `${res.status} ${text}`).toContain(res.status);
    expect(leaks(text, path), "the refusal shows A's data").toEqual([]);
    await c.undo?.(w, b);
    expect(await snapshot(), "a refused request changed rows or R2 objects").toBe(before);
    const own = await api(a.token, method, path, c.body?.(w, w));
    const ownText = own.headers.get("content-type")?.includes("json") ? await own.text() : `(${(await own.arrayBuffer()).byteLength} bytes)`;
    expect(c.ownerStatus ?? [200, 201], `the owner's own request: ${own.status} ${ownText}`).toContain(own.status);
  });

  const listCases = Object.entries(ROUTES).filter((e): e is [string, ListCase] => e[1].kind === "list");
  test.each(listCases)("%s: lists nothing of another workspace", async (_route, c) => {
    for (const path of c.paths(listWorld)) {
      const res = await api(b.token, "GET", path);
      const text = await res.text();
      expect(res.status, text).toBe(200);
      expect(leaks(text, path), `${path} lists A's data`).toEqual([]);
    }
  });

  test("lists do show the owner's own resources (the leak check can fail)", async () => {
    // /api/shots pages (100 by default) and every case above adds a world of A's with the same capture time: ask for all.
    for (const path of ["/api/projects", "/api/presets", "/api/fixtures", "/api/mesh-networks", "/api/locations", "/api/spots", "/api/fields", "/api/views", "/api/days", "/api/timelines", "/api/shots?limit=500", "/api/devices", "/api/viewfinder-layouts", "/api/workspaces"]) {
      const text = await (await api(a.token, "GET", path)).text();
      expect(text, path).toContain(listWorld.mark);
    }
  });

  describe("references in a body to another workspace's rows", () => {
    const cases: [string, string, string, (a: World) => unknown][] = [
      ["a new shot in A's project", "POST", "/api/shots", (w) => uploadForm({ id: uuid(), project_id: w.project, photos: [photoMeta(0)] })],
      ["moving B's shots to A's project", "PATCH", "/api/shots", (w) => ({ ids: [bWorld.shot], set: { project_id: w.project } })],
      ["B's shot at A's location", "PATCH", `/api/shots/{b.shot}`, (w) => ({ location_id: w.location })],
      ["a new location in A's project", "PUT", "/api/locations/{new}", (w) => ({ name: "x", project_id: w.project })],
      ["a new spot at A's location", "PUT", "/api/spots/{new}", (w) => ({ name: "x", location_id: w.location })],
      ["a new field in A's project", "PUT", "/api/fields/{new}", (w) => ({ project_id: w.project, definition: { key: "x", label: "x", type: "text" } })],
      ["a new view in A's project", "PUT", "/api/views/{new}", (w) => ({ name: "x", project_id: w.project, filter: { match: "all", rules: [] } })],
      ["a new day in A's project", "PUT", "/api/days/{new}", (w) => ({ project_id: w.project, date: "2026-01-01", shots: [] })],
      ["a new timeline in A's project", "PUT", "/api/timelines/{new}", (w) => ({ project_id: w.project, name: "x", clips: [] })],
      ["a new folder in A's project", "PUT", "/api/folders/{new}", (w) => ({ project_id: w.project, name: "x" })],
      ["a new shortcut in A's project", "PUT", "/api/desktop/{new}", (w) => ({ project_id: w.project, kind: "app", app_id: "gallery", x: 0, y: 0 })],
      ["a new project in A's workspace", "PUT", "/api/projects/{new}", (w) => ({ name: "x", workspace_id: w.workspace })],
      ["a new rig in A's workspace", "PUT", "/api/presets/{new}", (w) => ({ name: "x", sensor_width_mm: 36, sensor_height_mm: 24, workspace_id: w.workspace })],
      ["a new mesh network in A's workspace", "PUT", "/api/mesh-networks/{new}", (w) => ({ name: "x", workspace_id: w.workspace })],
      ["a new fixture in A's workspace", "PUT", "/api/fixtures/{new}", (w) => fixtureBody("x", { workspace_id: w.workspace })],
      ["B's new fixture in A's mesh network", "PUT", "/api/fixtures/{new}", (w) => fixtureBody("x", { mesh_network_id: w.meshNetwork, mesh_unicast: 9 })],
      ["B's fixture moved into A's mesh network", "PUT", "/api/fixtures/{b.fixture}", (w) => fixtureBody("x", { mesh_network_id: w.meshNetwork, mesh_unicast: 9 })],
      ["a new framing on A's photo", "PUT", "/api/framings/{new}", (w) => ({ photo_id: w.photo, name: "x", lens_mm: 35, frame: FRAME })],
      ["a framing on B's photo with A's rig", "PUT", "/api/framings/{new}", (w) => ({ photo_id: bWorld.photo, name: "x", rig_id: w.preset, lens_mm: 35, frame: FRAME })],
      ["a new layer on A's shot", "PUT", "/api/layers/{new}", (w) => layerBody(w.shot, "x")],
      ["B's layer on A's photo", "PUT", "/api/layers/{new}", (w) => layerBody(bWorld.shot, "x", { space: "photo", photo_id: w.photo })],
      ["B's layer on A's steps", "PUT", "/api/layers/{new}", (w) => layerBody(bWorld.shot, "x", { range: [w.step] })],
      ["B's layer owned by A's timeline clip", "PUT", "/api/layers/{new}", (w) => layerBody(bWorld.shot, "x", { timeline_id: w.timeline, clip_id: w.clip })],
      ["a new sketch on A's shot", "PUT", "/api/sketches/{new}", (w) => sketchBody(w.shot, "x")],
      ["B's sketch copied into A's timeline", "POST", "/api/sketches/{b.sketch}/copy", (w) => ({ id: uuid(), timeline_id: w.timeline, clip_id: w.clip })],
      ["B's layer copied into A's timeline", "POST", "/api/layers/{b.layer}/copy", (w) => ({ id: uuid(), timeline_id: w.timeline, clip_id: w.clip })],
      ["B's layout for A's device", "PUT", "/api/viewfinder-layouts/{new}", (w) => ({ ...layoutBody("x"), device_id: w.device })],
      ["B's shot into A's folder", "PUT", "/api/folder-items/shot/{b.shot}", (w) => ({ folder_id: w.folder })],
      ["A's fields imported into B's project order", "PUT", "/api/projects/{b.project}/fields", (w) => ({ field_ids: [w.field] })],
      ["B's photo root set to A's framing", "PUT", "/api/photos/{b.photo}/root", (w) => ({ framing_id: w.framing })],
      ["B's shot adopting A's photo", "POST", "/api/shots/{b.shot}/photos", (w) => ({ photo_ids: [w.photo] })],
      ["B's shot's steps on A's photo", "PUT", "/api/shots/{b.shot}/steps", (w) => ({ steps: [{ id: uuid(), photo_id: w.photo }] })],
    ];
    test.each(cases)("%s: refused, nothing changes", async (_name, method, pattern, body) => {
      const w = await fresh();
      const path = pattern.replace("{new}", uuid()).replace(/\{b\.(\w+)\}/, (_m, k: string) => bWorld[k as keyof World] as string);
      const before = await snapshot();
      const res = await api(b.token, method, path, body(w));
      const text = await res.text();
      expect([400, 403, 404], `${res.status} ${text}`).toContain(res.status);
      expect(leaks(text, path)).toEqual([]);
      expect(await snapshot()).toBe(before);
    });

    test("a day or timeline of B's that lists A's shots or photos keeps none of them", async () => {
      const w = await fresh();
      const day = await ok<{ day: { shots: unknown[] } }>(api(b.token, "PUT", `/api/days/${uuid()}`, { project_id: bWorld.project, date: "2026-01-01", shots: [{ shot_id: w.shot }] }));
      expect(day.day.shots).toEqual([]);
      const tl = await ok<{ timeline: { clips: unknown[] } }>(api(b.token, "PUT", `/api/timelines/${uuid()}`, { project_id: bWorld.project, name: "x", clips: [{ id: uuid(), photo_id: w.photo, presentation: { mode: "fit" }, duration_ms: 1000 }] }));
      expect(tl.timeline.clips).toEqual([]);
    });
  });

  test("one phone under two accounts: a row each, no takeover (#224)", async () => {
    const w = await fresh();
    type Device = { id: string; user_id: string; name: string };
    const mine = await ok<{ device: Device }>(api(b.token, "PUT", `/api/devices/${w.device}`, deviceBody("B's phone")), 201);
    expect(mine.device).toMatchObject({ id: w.device, user_id: b.id, name: "B's phone" });
    // The phone's own update (no name) touches only the caller's row and keeps its name.
    await ok(api(b.token, "PUT", `/api/devices/${w.device}`, { specs: deviceBody("").specs }), 200);
    const aDevices = await ok<{ devices: Device[] }>(api(a.token, "GET", "/api/devices"));
    expect(aDevices.devices.find((d) => d.id === w.device)).toMatchObject({ user_id: a.id, name: `${w.mark} device` });
    const bDevices = await ok<{ devices: Device[] }>(api(b.token, "GET", "/api/devices"));
    expect(bDevices.devices.filter((d) => d.id === w.device)).toEqual([expect.objectContaining({ user_id: b.id, name: "B's phone" })]);
    // A's layout keeps its device; B's layout can use B's row of the same phone.
    const layouts = await ok<{ layouts: { id: string; device_id: string | null }[] }>(api(a.token, "GET", "/api/viewfinder-layouts"));
    expect(layouts.layouts.find((l) => l.id === w.layout)?.device_id).toBe(w.device);
    const bLayout = await ok<{ layout: { device_id: string } }>(api(b.token, "PUT", `/api/viewfinder-layouts/${uuid()}`, { ...layoutBody("B on the phone"), device_id: w.device }));
    expect(bLayout.layout.device_id).toBe(w.device);
    // Deleting B's row leaves A's row and A's layout alone; A deleting its row clears only A's layout.
    await ok(api(b.token, "DELETE", `/api/devices/${w.device}`));
    expect((await ok<{ devices: Device[] }>(api(a.token, "GET", "/api/devices"))).devices.some((d) => d.id === w.device)).toBe(true);
    await ok(api(a.token, "DELETE", `/api/devices/${w.device}`));
    const after = await ok<{ layouts: { id: string; device_id: string | null }[] }>(api(a.token, "GET", "/api/viewfinder-layouts"));
    expect(after.layouts.find((l) => l.id === w.layout)?.device_id).toBeNull();
    await ok(api(a.token, "DELETE", `/api/devices/${w.device}`), 404);
  });
});
