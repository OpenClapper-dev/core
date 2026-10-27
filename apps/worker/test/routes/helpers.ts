/**
 * Route-test helpers (docs/testing.md): users created straight in D1 and signed in through the real
 * login route, an authed fetch through the Worker's own handler, uploads, a full "world" of one
 * user's resources, and a snapshot of every row and R2 object to prove a refused request changed nothing.
 */
import { createExecutionContext, createScheduledController, waitOnExecutionContext } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { hashPassword } from "@openclapper/service-kit";
import { DEFAULT_VIEWFINDER_LAYOUT, emptyDrawing } from "@openclapper/vocab";
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

/** A few bytes with a JPEG header: the Worker checks the magic bytes and the size, never decodes. */
export const jpeg = (marker = "img") => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), marker], "p.jpg", { type: "image/jpeg" });
/** The PNG signature and a marker; `type` is what the client claims (the Worker goes by the bytes). */
export const png = (marker = "png", type = "image/png") => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), marker], "r.png", { type });

export interface PhotoMeta { id: string; ordinal: number; timestamp: string; lens_mm: number; preset_id?: string | null; lat?: number; lon?: number }
export const photoMeta = (ordinal: number, extra: Partial<PhotoMeta> = {}): PhotoMeta =>
  ({ id: uuid(), ordinal, timestamp: new Date(Date.UTC(2026, 9, 1, 12, 0, ordinal)).toISOString(), lens_mm: 35, ...extra });

/** The phone's multipart upload: metadata plus one image per photo listed in `files` (default: all). */
export function uploadForm(meta: Record<string, unknown> & { photos: PhotoMeta[] }, files: string[] = meta.photos.map((p) => p.id)): FormData {
  const form = new FormData();
  form.set("metadata", JSON.stringify(meta));
  for (const id of files) form.set(`photo.${id}`, jpeg(id));
  return form;
}

/** Runs the daily cron (trash and session purge) to completion. */
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
  user: User; mark: string; workspace: string; member: string; memberEmail: string;
  project: string; preset: string; location: string; spot: string; field: string; view: string; binnedView: string;
  shot: string; photo: string; shot2: string; photo2: string; step: string; day: string; framing: string; timeline: string; clip: string;
  layer: string; sketch: string; folder: string; desktop: string; device: string; layout: string;
  meshNetwork: string; fixture: string;
}

const DEVICE_SPECS = { v: 1, model: "Test phone", viewport: { portrait: { width: 400, height: 800 }, landscape: null }, zoom: null, stops: [1], mainEquivalentMm: 24, calibration: "auto" };
export const FRAME = { width_fraction: 0.5, height_fraction: 0.5 };
export const deviceBody = (name: string) => ({ name, specs: DEVICE_SPECS });
export const layoutBody = (name: string) => ({ name, layout: DEFAULT_VIEWFINDER_LAYOUT });
/** A drawing layer of a shot (epic #275); `extra` overrides (space, photo_id, range, clip owner…). */
export const layerBody = (shot: string, name: string, extra: Record<string, unknown> = {}) =>
  ({ shot_id: shot, kind: "drawing", name, position: 0, visible: true, locked: false, opacity: 1, space: "frame", shapes: [], ...extra });
/** A step's bake: metadata with the hash, and an image. */
export function bakeForm(hash = "0123456789abcdef"): FormData {
  const form = new FormData();
  form.set("metadata", JSON.stringify({ hash }));
  form.set("image", png("bake"));
  return form;
}
export const sketchBody = (shot: string, name: string) => ({ shot_id: shot, name, drawing: emptyDrawing(false), aspect: 1.5 });
/** An Aputure MC (a mesh kind); `extra` adds its network, unicast, workspace. */
export const fixtureBody = (label: string, extra: Record<string, unknown> = {}) => ({ label, kind_id: "aputure-mc", address: "A4:C1:38:0B:2F:9E", ...extra });
export const timelineBody = (project: string, name: string, clip: string, photo: string) =>
  ({ project_id: project, name, clips: [{ id: clip, photo_id: photo, presentation: { mode: "fit", frame: FRAME }, duration_ms: 2000 }] });

/** A JSON body as multipart with a render image (sketches). */
export function withRender(meta: unknown): FormData {
  const form = new FormData();
  form.set("metadata", JSON.stringify(meta));
  form.set("render", png());
  return form;
}

let memberUser: User | null = null;

export async function buildWorld(user: User): Promise<World> {
  const t = user.token;
  const mark = `mark${uuid().slice(0, 8)}`;
  const id = () => uuid();
  const w = {
    user, mark, workspace: id(), project: id(), preset: id(), location: id(), spot: id(), field: id(), view: id(), binnedView: id(),
    shot: id(), photo: id(), shot2: id(), photo2: id(), step: id(), day: id(), framing: id(), timeline: id(), clip: id(), layer: id(), sketch: id(), folder: id(),
    desktop: id(), device: id(), layout: id(), meshNetwork: id(), fixture: id(),
  } as World;
  memberUser ??= await newUser({ signIn: false });
  w.member = memberUser.id;
  w.memberEmail = memberUser.email;
  await ok(api(t, "PUT", `/api/workspaces/${w.workspace}`, { name: `${mark} ws` }));
  await ok(api(t, "POST", `/api/workspaces/${w.workspace}/members`, { email: memberUser.email, role: "editor" }));
  await ok(api(t, "PUT", `/api/projects/${w.project}`, { name: `${mark} project`, workspace_id: w.workspace }));
  await ok(api(t, "PUT", `/api/presets/${w.preset}`, { name: `${mark} rig`, sensor_width_mm: 36, sensor_height_mm: 24, workspace_id: w.workspace }));
  await ok(api(t, "PUT", `/api/locations/${w.location}`, { name: `${mark} location`, project_id: w.project }));
  await ok(api(t, "PUT", `/api/spots/${w.spot}`, { name: `${mark} spot`, location_id: w.location }));
  await ok(api(t, "PUT", `/api/fields/${w.field}`, { project_id: w.project, definition: { key: "mood", label: `${mark} mood`, type: "text" } }));
  await ok(api(t, "PUT", `/api/views/${w.view}`, { name: `${mark} view`, project_id: w.project, filter: { match: "all", rules: [] } }));
  await ok(api(t, "PUT", `/api/views/${w.binnedView}`, { name: `${mark} binned`, project_id: w.project, filter: { match: "all", rules: [] } }));
  await ok(api(t, "DELETE", `/api/views/${w.binnedView}`));
  const photo = photoMeta(0, { id: w.photo, preset_id: w.preset });
  await ok(api(t, "POST", "/api/shots", uploadForm({ id: w.shot, project_id: w.project, name: `${mark} shot`, location_id: w.location, spot_id: w.spot, photos: [photo] })), 201);
  await ok(api(t, "PUT", `/api/days/${w.day}`, { project_id: w.project, date: "2026-11-01", title: `${mark} day`, shots: [{ shot_id: w.shot }] }));
  await ok(api(t, "PUT", `/api/framings/${w.framing}`, { photo_id: w.photo, name: `${mark} framing`, lens_mm: 50, frame: FRAME }), 201);
  // A second shot (what a merge moves in) and a stored step on the first (issue #266).
  await ok(api(t, "POST", "/api/shots", uploadForm({ id: w.shot2, project_id: w.project, name: `${mark} shot two`, photos: [photoMeta(0, { id: w.photo2 })] })), 201);
  await ok(api(t, "PUT", `/api/shots/${w.shot}/steps`, { steps: [{ id: w.step, photo_id: w.photo, framing_id: w.framing }] }));
  await ok(api(t, "PUT", `/api/layers/${w.layer}`, layerBody(w.shot, `${mark} layer`, { range: [w.step] })), 201);
  await ok(api(t, "PUT", `/api/shots/${w.shot}/bakes/${w.step}`, bakeForm()));
  await ok(api(t, "PUT", `/api/timelines/${w.timeline}`, timelineBody(w.project, `${mark} timeline`, w.clip, w.photo)));
  await ok(api(t, "PUT", `/api/sketches/${w.sketch}`, withRender(sketchBody(w.shot, `${mark} sketch`))), 201);
  await ok(api(t, "PUT", `/api/folders/${w.folder}`, { project_id: w.project, name: `${mark} folder` }));
  await ok(api(t, "PUT", `/api/desktop/${w.desktop}`, { project_id: w.project, kind: "app", app_id: "gallery", label: `${mark} app`, x: 10, y: 10 }));
  await ok(api(t, "PUT", `/api/devices/${w.device}`, deviceBody(`${mark} device`)));
  await ok(api(t, "PUT", `/api/viewfinder-layouts/${w.layout}`, { ...layoutBody(`${mark} layout`), device_id: w.device }));
  await ok(api(t, "PUT", `/api/mesh-networks/${w.meshNetwork}`, { name: `${mark} mesh`, workspace_id: w.workspace }));
  await ok(api(t, "PUT", `/api/fixtures/${w.fixture}`, fixtureBody(`${mark} light`, { mesh_network_id: w.meshNetwork, mesh_unicast: 2, workspace_id: w.workspace })));
  return w;
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
