/**
 * Route-test helpers (docs/testing.md): users created straight in D1 and signed in through the real
 * login route, an authed fetch through the Worker's own handler, a full "world" of one user's
 * resources, and a snapshot of every row and R2 object to prove a refused request changed nothing.
 */
import { createExecutionContext, createScheduledController, waitOnExecutionContext } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { hashPassword } from "@openclapper/service-kit";
import { expect } from "vitest";
import worker from "../../src/index.ts";

export const uuid = () => crypto.randomUUID();
const BASE = "http://openclapper.test";

export interface User { id: string; email: string; password: string; workspace: string; token: string }

/** A user with a personal workspace, as the admin plane makes one (apps/admin/src/index.ts), signed in as the phone. */
export async function newUser(opts: { status?: "active" | "blocked"; signIn?: boolean } = {}): Promise<User> {
  const id = uuid(), workspace = uuid();
  const email = `u-${id.slice(0, 8)}@test.invalid`, password = `pw-${id}`;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO users (id, email, password_hash, status) VALUES (?1, ?2, ?3, ?4)").bind(id, email, await hashPassword(password, 10_000), opts.status ?? "active"),
    env.DB.prepare("INSERT INTO workspaces (id, name, owner_user_id, kind) VALUES (?1, 'Personal', ?2, 'personal')").bind(workspace, id),
    env.DB.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?1, ?2, 'owner')").bind(workspace, id),
  ]);
  const token = opts.signIn === false ? "" : await signIn(email, password);
  return { id, email, password, workspace, token };
}

export async function signIn(email: string, password: string): Promise<string> {
  const res = await api(null, "POST", "/api/auth/login", { email, password, client: "mobile" });
  expect(res.status, await res.clone().text()).toBe(200);
  return ((await res.json()) as { token: string }).token;
}

/** One request through the Worker's fetch. `body`: JSON, or a FormData sent as multipart. */
export function api(token: string | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
  const h = new Headers(headers);
  if (token) h.set("Authorization", `Bearer ${token}`);
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { payload = JSON.stringify(body); h.set("content-type", "application/json"); }
  return exports.default.fetch(new Request(`${BASE}${path}`, { method, headers: h, body: payload }));
}

/** `api` that also asserts the status (and shows the body when it is not the expected one) and returns the JSON. */
export async function ok<T = Record<string, unknown>>(res: Response | Promise<Response>, status: number | number[] = [200, 201]): Promise<T> {
  const r = await res;
  const text = await r.text();
  expect([status].flat(), `${r.status} ${text}`).toContain(r.status);
  return (text ? JSON.parse(text) : null) as T;
}

/** Runs the daily cron (recycle bin and session purge, storage snapshot) to completion. */
export async function runCron(): Promise<void> {
  const ctx = createExecutionContext();
  await worker.scheduled(createScheduledController({ scheduledTime: Date.now(), cron: "17 3 * * *" }), env, ctx);
  await waitOnExecutionContext(ctx);
}

/**
 * Everything of one user's, in a shared workspace of its own (so worlds never mix), built through the
 * API. `mark` is in every name: another user's response must never contain it.
 */
export interface World {
  user: User; mark: string; workspace: string; member: string; memberEmail: string; project: string;
  /** A folder at the top of the project, and a shortcut to an app inside it. */
  folder: string; shortcut: string;
  /** A shortcut that points at `folder`, and a shortcut made inside it (an internal file). */
  link: string; internal: string;
  /** A folder in the recycle bin, and a folder in the user's account home. */
  binned: string; home: string;
  /** A photo with its three images stored. */
  photo: string;
  /** A blank canvas with its render stored. */
  canvas: string;
}

/** The body of a PUT for a new folder. */
export const folderBody = (root: { project_id: string } | { home: true }, name: string, extra: Record<string, unknown> = {}) => ({ type: "folder", ...root, name, ...extra });
/** A new shortcut to an app; `extra` overrides (a target instead: `{ body: { app: null }, refs: [{ kind: "target", to }] }`). */
export const shortcutBody = (project: string, name: string, extra: Record<string, unknown> = {}) => ({ type: "shortcut", project_id: project, name, body: { app: "files" }, ...extra });

let memberUser: User | null = null;

export async function buildWorld(user: User): Promise<World> {
  const t = user.token;
  const mark = `mark${uuid().slice(0, 8)}`;
  const id = () => uuid();
  const w = { user, mark, workspace: id(), project: id(), folder: id(), shortcut: id(), link: id(), internal: id(), binned: id(), home: id(), photo: id(), canvas: id() } as World;
  memberUser ??= await newUser({ signIn: false });
  w.member = memberUser.id;
  w.memberEmail = memberUser.email;
  await ok(api(t, "PUT", `/api/workspaces/${w.workspace}`, { name: `${mark} ws` }));
  await ok(api(t, "POST", `/api/workspaces/${w.workspace}/members`, { email: memberUser.email, role: "editor" }));
  await ok(api(t, "PUT", `/api/projects/${w.project}`, { name: `${mark} project`, workspace_id: w.workspace }));
  const p = { project_id: w.project };
  await ok(api(t, "PUT", `/api/files/${w.folder}`, folderBody(p, `${mark} folder`)));
  await ok(api(t, "PUT", `/api/files/${w.shortcut}`, shortcutBody(w.project, `${mark} shortcut`, { container: w.folder })));
  await ok(api(t, "PUT", `/api/files/${w.link}`, shortcutBody(w.project, `${mark} link`, { body: { app: null }, refs: [{ kind: "target", to: w.folder }] })));
  await ok(api(t, "PUT", `/api/files/${w.internal}`, shortcutBody(w.project, `${mark} internal`, { internal_of: w.link })));
  await ok(api(t, "PUT", `/api/files/${w.binned}`, folderBody(p, `${mark} binned`)));
  await ok(api(t, "POST", "/api/files/bin", { ids: [w.binned] }));
  await ok(api(t, "PUT", `/api/files/${w.home}`, folderBody({ home: true }, `${mark} home`)));
  await addPhoto(t, w.project, w.photo, { name: `${mark} photo` });
  await ok(api(t, "PUT", `/api/files/${w.canvas}`, { type: "canvas", project_id: w.project, name: `${mark} canvas` }));
  await ok(putRender(t, w.canvas, "render", png("render")));
  return w;
}

/** A few bytes with a JPEG header: the Worker checks the magic bytes and the size, never decodes. */
export const jpeg = (marker = "img") => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new TextEncoder().encode(marker)]);
/** A canvas render or thumbnail upload. */
export function putRender(token: string, id: string, part: "render" | "thumbnail", bytes: Uint8Array, headers: Record<string, string> = {}): Promise<Response> {
  return exports.default.fetch(new Request(`http://openclapper.test/api/canvases/${id}/${part}`, { method: "PUT", headers: { Authorization: `Bearer ${token}`, "content-type": "application/octet-stream", ...headers }, body: bytes }));
}
/** The PNG signature and a marker. */
export const png = (marker = "png") => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new TextEncoder().encode(marker)]);

/** One image of a photo, as the clients send it: the raw bytes. */
export function putImage(token: string, id: string, part: "thumbnail" | "preview" | "original", bytes: Uint8Array): Promise<Response> {
  return exports.default.fetch(new Request(`${BASE}/api/photos/${id}/${part}`, { method: "PUT", headers: { Authorization: `Bearer ${token}`, "content-type": "application/octet-stream" }, body: bytes }));
}

/** A photo as a client adds one: what is known about it, then its three images. */
export async function addPhoto(token: string, project: string, id = uuid(), extra: Record<string, unknown> = {}, parts: ("thumbnail" | "preview" | "original")[] = ["thumbnail", "preview", "original"]): Promise<string> {
  await ok(api(token, "PUT", `/api/photos/${id}`, { project_id: project, origin: "import", media_type: "image/jpeg", taken_at: "2026-11-01T10:00:00Z", width: 4000, height: 3000, exif: { FocalLengthIn35mmFilm: 24, Make: "Test" }, readout: { make: "Test", model: "Cam" }, ...extra }), [200, 201]);
  for (const p of parts) await ok(putImage(token, id, p, jpeg(`${id}-${p}`)), [200, 201]);
  return id;
}

/** The ids of a world (everything another user must never see). */
export const idsOf = (w: World) => Object.entries(w).filter(([k, v]) => typeof v === "string" && !["mark", "member", "memberEmail"].includes(k)).map(([, v]) => v as string);

/** Tables whose rows are not domain data: sign-in bookkeeping changes on every request. */
const SKIP_TABLES = new Set(["sessions", "users", "d1_migrations", "sqlite_sequence"]);

/** Every row of every domain table and every R2 object (key + etag), as one comparable string. */
export async function snapshot(): Promise<string> {
  const { results: tables } = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name").all<{ name: string }>();
  const out: Record<string, unknown> = {};
  for (const { name } of tables) {
    if (SKIP_TABLES.has(name)) continue;
    out[name] = (await env.DB.prepare(`SELECT * FROM "${name}" ORDER BY 1, 2`).all()).results;
  }
  const objects: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.SHOTS_BUCKET.list({ cursor, limit: 1000 });
    objects.push(...page.objects.map((o) => `${o.key} ${o.etag}`));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  out.r2 = objects.sort();
  return JSON.stringify(out);
}
