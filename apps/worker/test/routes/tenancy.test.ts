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
import { beforeAll, describe, expect, test } from "vitest";
import { publicRouter, router } from "../../src/routes.ts";
import { api, buildWorld, folderBody, idsOf, jpeg, newUser, ok, putImage, shortcutBody, snapshot, uuid, type User, type World } from "./helpers.ts";

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
}
interface ListCase { kind: "list"; paths: (a: World) => string[] }
interface Exempt { kind: "exempt"; why: string }
type Case = IdCase | ListCase | Exempt;

const named = (a: World, what: string) => `${a.mark} ${what} renamed`;

/** Every route of the API router: "METHOD /pattern" → how its isolation is checked. */
const ROUTES: Record<string, Case> = {
  "GET /health": { kind: "list", paths: () => ["/health"] },
  "GET /api/me": { kind: "list", paths: () => ["/api/me"] },

  "GET /api/projects": { kind: "list", paths: () => ["/api/projects"] },
  "PUT /api/projects/:id": { kind: "id", path: (a) => `/api/projects/${a.project}`, body: (a) => ({ name: named(a, "project") }) },
  // A's project still has its files: the delete answers 409 for A, past the workspace check.
  "DELETE /api/projects/:id": { kind: "id", path: (a) => `/api/projects/${a.project}`, ownerStatus: [409] },

  "GET /api/files": { kind: "id", path: (a) => `/api/files?project_id=${a.project}` },
  "GET /api/files/:id": { kind: "id", path: (a) => `/api/files/${a.folder}` },
  "GET /api/files/:id/uses": { kind: "id", path: (a) => `/api/files/${a.folder}/uses` },
  // B names B's own project for A's file id: refused on the file (the upsert must not take it over).
  "PUT /api/files/:id": { kind: "id", path: (a) => `/api/files/${a.folder}`, body: (a, actor) => folderBody({ project_id: actor.project }, named(a, "folder")) },
  "POST /api/files/move": { kind: "id", path: () => "/api/files/move", body: (a) => ({ ids: [a.shortcut], container: null }) },
  "POST /api/files/bin": { kind: "id", path: () => "/api/files/bin", body: (a) => ({ ids: [a.folder] }) },
  "POST /api/files/restore": { kind: "id", path: () => "/api/files/restore", body: (a) => ({ ids: [a.binned] }) },
  "POST /api/files/purge": { kind: "id", path: () => "/api/files/purge", body: (a) => ({ ids: [a.binned] }) },
  "DELETE /api/bin": { kind: "id", path: (a) => `/api/bin?project_id=${a.project}` },
  "POST /api/files/:id/duplicate": { kind: "id", path: (a) => `/api/files/${a.folder}/duplicate`, body: () => ({ id: uuid() }) },
  "POST /api/files/:id/release": { kind: "id", path: (a) => `/api/files/${a.internal}/release`, body: () => ({}) },

  // B names B's own project for A's photo id: refused on the photo, never a takeover.
  "PUT /api/photos/:id": { kind: "id", path: (a) => `/api/photos/${a.photo}`, body: (_a, actor) => ({ project_id: actor.project, origin: "import", width: 10, height: 10 }) },
  "PUT /api/photos/:id/:part": { kind: "exempt", why: "the body is raw bytes, which the generic case cannot send; the photo tests check another workspace's upload is refused" },
  "GET /api/photos/:id/image": { kind: "id", path: (a) => `/api/photos/${a.photo}/image` },

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
    for (const path of ["/api/projects", "/api/workspaces", `/api/files?project_id=${listWorld.project}`, "/api/files?home=1", `/api/files?project_id=${listWorld.project}&bin=1`]) {
      const text = await (await api(a.token, "GET", path)).text();
      expect(text, path).toContain(listWorld.mark);
    }
  });

  test("another workspace's photo takes no image of B's", async () => {
    const w = await fresh();
    const other = uuid();
    await ok(api(a.token, "PUT", `/api/photos/${other}`, { project_id: w.project, origin: "import", width: 10, height: 10 }), 201);
    const before = await snapshot();
    await ok(putImage(b.token, other, "preview", jpeg("b's")), 404);
    expect(await snapshot()).toBe(before);
  });

  test("an account home is its owner's alone", async () => {
    const w = await fresh();
    const before = await snapshot();
    const refused: [string, string, unknown?][] = [
      ["GET", `/api/files/${w.home}`], ["GET", `/api/files/${w.home}/uses`], ["PUT", `/api/files/${w.home}`, folderBody({ home: true }, "taken")],
      ["POST", "/api/files/bin", { ids: [w.home] }], ["POST", "/api/files/move", { ids: [w.home], container: null }], ["POST", `/api/files/${w.home}/duplicate`, { id: uuid() }],
    ];
    for (const [method, path, body] of refused) {
      const res = await api(b.token, method, path, body);
      const text = await res.text();
      expect(res.status, `${method} ${path}: ${text}`).toBe(404);
      expect(leaks(text, path)).toEqual([]);
    }
    expect(leaks(await (await api(b.token, "GET", "/api/files?home=1")).text())).toEqual([]);
    // A file of B's home cannot go into A's home folder, nor a project's file into a home.
    await ok(api(b.token, "PUT", `/api/files/${uuid()}`, folderBody({ home: true }, "x", { container: w.home })), 400);
    await ok(api(a.token, "POST", "/api/files/move", { ids: [w.folder], container: w.home }), 400);
    expect(await snapshot()).toBe(before);
  });

  describe("references in a body to another workspace's rows", () => {
    const cases: [string, string, string, (a: World) => unknown][] = [
      ["a new project in A's workspace", "PUT", "/api/projects/{new}", (w) => ({ name: "x", workspace_id: w.workspace })],
      ["a new file in A's project", "PUT", "/api/files/{new}", (w) => folderBody({ project_id: w.project }, "x")],
      ["a new photo in A's project", "PUT", "/api/photos/{new}", (w) => ({ project_id: w.project, origin: "import", width: 10, height: 10 })],
      ["B's new file in A's folder", "PUT", "/api/files/{new}", (w) => folderBody({ project_id: bWorld.project }, "x", { container: w.folder })],
      ["B's file put into A's folder", "PUT", "/api/files/{b.shortcut}", (w) => ({ container: w.folder })],
      ["B's new internal file of A's file", "PUT", "/api/files/{new}", (w) => shortcutBody(bWorld.project, "x", { internal_of: w.link })],
      ["B's file moved into A's folder", "POST", "/api/files/move", (w) => ({ ids: [bWorld.shortcut], container: w.folder })],
      ["A's file moved along with B's", "POST", "/api/files/move", (w) => ({ ids: [bWorld.shortcut, w.shortcut], container: null })],
      ["A's file binned along with B's", "POST", "/api/files/bin", (w) => ({ ids: [bWorld.shortcut, w.shortcut] })],
      ["A's binned file restored along with B's", "POST", "/api/files/restore", (w) => ({ ids: [bWorld.binned, w.binned] })],
      ["A's binned file purged along with B's", "POST", "/api/files/purge", (w) => ({ ids: [bWorld.binned, w.binned] })],
      ["B's file copied into A's folder", "POST", "/api/files/{b.folder}/duplicate", (w) => ({ id: uuid(), container: w.folder })],
      ["B's copy under the id of A's file", "POST", "/api/files/{b.folder}/duplicate", (w) => ({ id: w.folder })],
      ["B's internal file released into A's folder", "POST", "/api/files/{b.internal}/release", (w) => ({ container: w.folder })],
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

    test("a reference of B's to A's file is kept as it was sent, shows as missing, and is no use of A's file", async () => {
      const w = await fresh();
      const link = uuid();
      const made = await ok<{ file: { refs: { to: string; missing: boolean }[] } }>(
        api(b.token, "PUT", `/api/files/${link}`, shortcutBody(bWorld.project, "x", { body: { app: null }, refs: [{ kind: "target", to: w.folder }] })), 201);
      expect(made.file.refs).toEqual([{ kind: "target", to: w.folder, data: null, missing: true }]);
      const uses = await ok<{ uses: { id: string }[] }>(api(a.token, "GET", `/api/files/${w.folder}/uses`));
      expect(uses.uses.map((x) => x.id)).toEqual([w.link]);
    });
  });
});
