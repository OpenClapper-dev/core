/**
 * The R2 objects' custom metadata (#255): derived from D1 and the keys, checked and repaired page by
 * page, unknown objects left alone, bodies and content types kept.
 */
import { env } from "cloudflare:workers";
import { describe, expect, test } from "vitest";
import worker, { type Env } from "../src/index.ts";
import { expectedMetadata, type RepairPage } from "../src/objects.ts";

const bypass: Env = { ...env, ACCESS_TEAM_DOMAIN: "", ACCESS_AUD: "", ADMIN_DEV_BYPASS: "true" };
function call(body: unknown): Promise<Response> {
  return worker.fetch(new Request("http://localhost:8788/api/storage/repair-metadata", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), bypass);
}
async function page(body: unknown, status = 200): Promise<RepairPage> {
  const r = await call(body);
  const text = await r.text();
  expect(r.status, text).toBe(status);
  return JSON.parse(text) as RepairPage;
}
/** Every page from the start, as the board does. */
async function all(check: boolean): Promise<RepairPage> {
  const sum: RepairPage = { checked: 0, repaired: 0, unknown: 0, examples: [], cursor: null };
  let cursor: string | null = null;
  do {
    const p: RepairPage = await page({ cursor, check });
    sum.checked += p.checked; sum.repaired += p.repaired; sum.unknown += p.unknown; sum.examples.push(...p.examples);
    cursor = p.cursor;
  } while (cursor);
  return sum;
}

async function photo(ws: string): Promise<{ key: string; shot: string; id: string }> {
  const project = crypto.randomUUID(), shot = crypto.randomUUID(), id = crypto.randomUUID(), key = `photos/${id}.jpg`;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO projects (id, name, workspace_id) VALUES (?1, ?1, ?2)").bind(project, ws),
    env.DB.prepare("INSERT INTO shots (id, project_id, captured_at) VALUES (?1, ?2, '2026-10-01T10:00:00Z')").bind(shot, project),
    env.DB.prepare("INSERT INTO photos (id, shot_id, ordinal, timestamp, lat, lon, lens_mm, r2_object_key) VALUES (?1, ?2, 0, '2026-10-01T10:00:00Z', 0, 0, 35, ?3)").bind(id, shot, key),
  ]);
  return { key, shot, id };
}

describe("expected metadata", () => {
  test("a photo's from its row, a render's from its key, nothing for the rest", () => {
    expect(expectedMetadata("photos/p.jpg", { k: "photos/p.jpg", photo_id: "p", shot_id: "s", workspace_id: "w" })).toEqual({ shot_id: "s", photo_id: "p", workspace_id: "w" });
    expect(expectedMetadata("photos/p.jpg", undefined)).toBeNull();
    expect(expectedMetadata("renders/overlays/o1.png", undefined)).toEqual({ kind: "overlays", id: "o1" });
    expect(expectedMetadata("renders/sketches/s1.webp", undefined)).toEqual({ kind: "sketches", id: "s1" });
    expect(expectedMetadata("renders/other/x.png", undefined)).toBeNull();
    expect(expectedMetadata("misc/readme.txt", undefined)).toBeNull();
  });
});

describe("repair", () => {
  test("a check counts, a repair rewrites bare and altered objects with the same body, and leaves the rest", async () => {
    const ws = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO workspaces (id, name, owner_user_id, kind) VALUES (?1, 'Crew', NULL, 'shared')").bind(ws).run();
    const bare = await photo(ws), cloned = await photo(ws), fine = await photo(ws);
    const b = env.SHOTS_BUCKET;
    await b.put(bare.key, "bare-bytes", { httpMetadata: { contentType: "image/jpeg" } });
    await b.put(cloned.key, "cloned-bytes", { httpMetadata: { contentType: "image/jpeg" }, customMetadata: { mtime: "1792510933.004", btime: "2026-10-20T15:42:13.004Z" } });
    await b.put(fine.key, "fine-bytes", { httpMetadata: { contentType: "image/jpeg" }, customMetadata: { shot_id: fine.shot, photo_id: fine.id, workspace_id: ws } });
    await b.put("renders/sketches/sk1.png", "render-bytes", { httpMetadata: { contentType: "image/png" } });
    await b.put("photos/orphan.jpg", "orphan-bytes");

    const checked = await all(true);
    expect(checked).toMatchObject({ checked: 5, repaired: 3, unknown: 1 });
    expect((await b.head(bare.key))!.customMetadata).toEqual({});

    const repaired = await all(false);
    expect(repaired).toMatchObject({ checked: 5, repaired: 3, unknown: 1 });
    expect(repaired.examples).toEqual(expect.arrayContaining([{ key: bare.key, reason: "missing" }, { key: cloned.key, reason: "different" }, { key: "photos/orphan.jpg", reason: "unknown" }]));
    const got = await b.get(cloned.key);
    expect(got!.customMetadata).toEqual({ shot_id: cloned.shot, photo_id: cloned.id, workspace_id: ws });
    expect(got!.httpMetadata?.contentType).toBe("image/jpeg");
    expect(await got!.text()).toBe("cloned-bytes");
    expect((await b.head("renders/sketches/sk1.png"))!.customMetadata).toEqual({ kind: "sketches", id: "sk1" });
    expect((await b.head("photos/orphan.jpg"))!.customMetadata).toEqual({});

    expect(await all(false)).toMatchObject({ repaired: 0, unknown: 1 });
    const audit = await env.DB.prepare("SELECT detail FROM admin_audit WHERE action = 'storage.repair'").all<{ detail: string }>();
    expect(audit.results.map((r) => JSON.parse(r.detail))).toEqual([{ checked: 5, repaired: 3, unknown: 1 }]);
  });

  test("the body is strict", async () => {
    await page({ cursor: 5 }, 400);
    await page({ check: "yes" }, 400);
    await page({ force: true }, 400);
  });
});
