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
    const b = env.SHOTS_BUCKET;
    await b.put("renders/sketches/bare.png", "bare-bytes", { httpMetadata: { contentType: "image/png" } });
    await b.put("renders/overlays/cloned.webp", "cloned-bytes", { httpMetadata: { contentType: "image/webp" }, customMetadata: { mtime: "1792510933.004", btime: "2026-10-20T15:42:13.004Z" } });
    await b.put("renders/sketches/fine.png", "fine-bytes", { httpMetadata: { contentType: "image/png" }, customMetadata: { kind: "sketches", id: "fine" } });
    // No photo is stored yet in the rewrite (#374): an object under photos/ is unknown and left alone.
    await b.put("photos/orphan.jpg", "orphan-bytes");

    const checked = await all(true);
    expect(checked).toMatchObject({ checked: 4, repaired: 2, unknown: 1 });
    expect((await b.head("renders/sketches/bare.png"))!.customMetadata).toEqual({});

    const repaired = await all(false);
    expect(repaired).toMatchObject({ checked: 4, repaired: 2, unknown: 1 });
    expect(repaired.examples).toEqual(expect.arrayContaining([{ key: "renders/sketches/bare.png", reason: "missing" }, { key: "renders/overlays/cloned.webp", reason: "different" }, { key: "photos/orphan.jpg", reason: "unknown" }]));
    const got = await b.get("renders/overlays/cloned.webp");
    expect(got!.customMetadata).toEqual({ kind: "overlays", id: "cloned" });
    expect(got!.httpMetadata?.contentType).toBe("image/webp");
    expect(await got!.text()).toBe("cloned-bytes");
    expect((await b.head("photos/orphan.jpg"))!.customMetadata).toEqual({});

    expect(await all(false)).toMatchObject({ repaired: 0, unknown: 1 });
    const audit = await env.DB.prepare("SELECT detail FROM admin_audit WHERE action = 'storage.repair'").all<{ detail: string }>();
    expect(audit.results.map((r) => JSON.parse(r.detail))).toEqual([{ checked: 4, repaired: 2, unknown: 1 }]);
  });

  test("the body is strict", async () => {
    await page({ cursor: 5 }, 400);
    await page({ check: "yes" }, 400);
    await page({ force: true }, 400);
  });
});
