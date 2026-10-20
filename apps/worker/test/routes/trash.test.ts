/**
 * The recycle bin: bin, restore, purge (one entry, the whole bin, and the daily cron after
 * TRASH_RETENTION_DAYS). Ageing is faked through the stored deleted_at, never by waiting.
 */
import { env } from "cloudflare:workers";
import { TRASH_RETENTION_DAYS } from "@openclapper/vocab";
import { beforeEach, describe, expect, test } from "vitest";
import { api, buildWorld, newUser, ok, runCron, type User, type World } from "./helpers.ts";

let u: User;
let w: World;
beforeEach(async () => {
  u ??= await newUser();
  w = await buildWorld(u);
});

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const listed = async (path: string, id: string) => (await (await api(u.token, "GET", path)).text()).includes(id);
const trash = (project: string) => ok<{ entries: { type: string; id: string; name: string }[] }>(api(u.token, "GET", `/api/trash?project_id=${project}`));
const shotKeys = async (shot: string) => (await env.DB.prepare("SELECT r2_object_key AS k FROM photos WHERE shot_id = ?1").bind(shot).all<{ k: string }>()).results.map((r) => r.k);
const renderKeys = async () => [
  (await env.DB.prepare("SELECT render_key AS k FROM overlays WHERE id = ?1").bind(w.overlay).first<{ k: string }>())!.k,
  (await env.DB.prepare("SELECT render_key AS k FROM sketches WHERE id = ?1").bind(w.sketch).first<{ k: string }>())!.k,
];

describe("bin and restore", () => {
  test("a binned shot leaves lists, days and timelines, shows in the bin, and comes back on restore", async () => {
    await ok(api(u.token, "DELETE", `/api/shots/${w.shot}`));
    expect(await listed(`/api/shots?project_id=${w.project}`, w.shot)).toBe(false);
    await ok(api(u.token, "GET", `/api/shots/${w.shot}`), 404);
    const day = await ok<{ day: { shots: unknown[] } }>(api(u.token, "GET", `/api/days/${w.day}`));
    expect(day.day.shots).toEqual([]);
    const tl = await ok<{ timeline: { clips: unknown[] } }>(api(u.token, "GET", `/api/timelines/${w.timeline}`));
    expect(tl.timeline.clips).toEqual([]);
    expect((await trash(w.project)).entries.map((e) => e.id)).toContain(w.shot);
    // The image stays until the purge.
    for (const k of await shotKeys(w.shot)) expect(await env.SHOTS_BUCKET.head(k)).not.toBeNull();

    await ok(api(u.token, "POST", `/api/trash/shot/${w.shot}/restore`));
    expect(await listed(`/api/shots?project_id=${w.project}`, w.shot)).toBe(true);
    expect((await trash(w.project)).entries.map((e) => e.id)).not.toContain(w.shot);
  });

  test("a restored location whose name was taken meanwhile gets a free one", async () => {
    await ok(api(u.token, "DELETE", `/api/locations/${w.location}`));
    const name = (await env.DB.prepare("SELECT name FROM locations WHERE id = ?1").bind(w.location).first<{ name: string }>())!.name;
    await ok(api(u.token, "PUT", `/api/locations/${crypto.randomUUID()}`, { name, project_id: w.project }));
    await ok(api(u.token, "POST", `/api/trash/location/${w.location}/restore`));
    const back = await env.DB.prepare("SELECT name, deleted_at FROM locations WHERE id = ?1").bind(w.location).first();
    expect(back).toEqual({ name: `${name} (restored)`, deleted_at: null });
  });

  test("a folder takes what is placed in it along, and brings it back", async () => {
    await ok(api(u.token, "PUT", `/api/folder-items/view/${w.view}`, { folder_id: w.folder }));
    await ok(api(u.token, "DELETE", `/api/folders/${w.folder}`));
    expect(await listed("/api/views", w.view)).toBe(false);
    const entries = (await trash(w.project)).entries;
    // The view is inside the folder's entry, not an entry of its own.
    expect(entries.map((e) => e.id)).toContain(w.folder);
    expect(entries.map((e) => e.id)).not.toContain(w.view);
    await ok(api(u.token, "POST", `/api/trash/folder/${w.folder}/restore`));
    expect(await listed("/api/views", w.view)).toBe(true);
  });

  test("restoring something not in the bin is a 404", async () => {
    await ok(api(u.token, "POST", `/api/trash/shot/${w.shot}/restore`), 404);
  });
});

describe("purge", () => {
  test(`the cron purges what is older than ${TRASH_RETENTION_DAYS} days, with its R2 objects, and keeps the rest`, async () => {
    const photos = await shotKeys(w.shot);
    const renders = await renderKeys();
    await ok(api(u.token, "DELETE", `/api/shots/${w.shot}`));
    await ok(api(u.token, "DELETE", `/api/views/${w.view}`));
    await env.DB.prepare("UPDATE shots SET deleted_at = ?1 WHERE id = ?2").bind(ago(TRASH_RETENTION_DAYS + 1), w.shot).run();
    await env.DB.prepare("UPDATE views SET deleted_at = ?1 WHERE id = ?2").bind(ago(TRASH_RETENTION_DAYS - 1), w.view).run();

    await runCron();

    expect(await env.DB.prepare("SELECT 1 FROM shots WHERE id = ?1").bind(w.shot).first()).toBeNull();
    expect(await env.DB.prepare("SELECT 1 FROM photos WHERE id = ?1").bind(w.photo).first()).toBeNull();
    for (const t of ["overlays", "sketches", "framings"]) {
      expect(await env.DB.prepare(`SELECT 1 FROM ${t} WHERE id IN (?1, ?2, ?3)`).bind(w.overlay, w.sketch, w.framing).first(), t).toBeNull();
    }
    for (const k of [...photos, ...renders]) expect(await env.SHOTS_BUCKET.head(k), k).toBeNull();
    // Younger than the retention: still in the bin; the binned view of buildWorld was binned just now.
    const left = (await trash(w.project)).entries.map((e) => e.id);
    expect(left).toContain(w.view);
    expect(left).toContain(w.binnedView);
  });

  test("purging one entry deletes it for good, R2 objects included", async () => {
    const photos = await shotKeys(w.shot);
    await ok(api(u.token, "DELETE", `/api/shots/${w.shot}`));
    await ok(api(u.token, "DELETE", `/api/trash/shot/${w.shot}`));
    expect(await env.DB.prepare("SELECT 1 FROM shots WHERE id = ?1").bind(w.shot).first()).toBeNull();
    for (const k of photos) expect(await env.SHOTS_BUCKET.head(k)).toBeNull();
    await ok(api(u.token, "DELETE", `/api/trash/shot/${w.shot}`), 404);
  });

  test("emptying the bin purges only that project's binned entries", async () => {
    const otherWorld = await buildWorld(u);
    await ok(api(u.token, "DELETE", `/api/shots/${w.shot}`));
    const res = await ok<{ purged: number }>(api(u.token, "DELETE", `/api/trash?project_id=${w.project}`));
    expect(res.purged).toBe(2); // the shot and buildWorld's binned view
    expect((await trash(w.project)).entries).toEqual([]);
    expect((await trash(otherWorld.project)).entries.map((e) => e.id)).toEqual([otherWorld.binnedView]);
    expect(await listed(`/api/shots?project_id=${w.project}`, w.photo)).toBe(false);
  });
});
