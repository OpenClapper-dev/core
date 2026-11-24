/**
 * Storage monitoring (#214): the daily cron snapshots the bucket's total and a row per workspace
 * with photos into storage_daily, and rewrites the day's rows when run again.
 */
import { env } from "cloudflare:workers";
import { describe, expect, test } from "vitest";
import { BUCKET_ROW, snapshotStorage, utcDay } from "../../src/storage-stats.ts";
import { addPhoto, api, newUser, ok, runCron, uuid } from "./helpers.ts";

interface Row { day: string; workspace_id: string; bytes: number; objects: number; unsized: number }
const rows = async (day: string) => (await env.DB.prepare("SELECT * FROM storage_daily WHERE day = ?1").bind(day).all<Row>()).results;

describe("storage snapshot", () => {
  test("the cron writes the bucket total", async () => {
    await env.SHOTS_BUCKET.put("photos/a.jpg", "12345");
    await env.SHOTS_BUCKET.put("renders/b.webp", "123");
    await runCron();
    expect((await rows(utcDay())).find((r) => r.workspace_id === BUCKET_ROW)).toMatchObject({ bytes: 8, objects: 2, unsized: 0 });
  });

  test("a second run of the same day replaces the row", async () => {
    const day = "2026-01-02";
    await snapshotStorage(env, day);
    await env.SHOTS_BUCKET.put("photos/c.jpg", "1");
    await snapshotStorage(env, day);
    const got = await rows(day);
    expect(got).toHaveLength(1);
    expect(got[0].objects).toBeGreaterThan(0);
  });

  test("a row per workspace with photos; a copy shares its images and counts once", async () => {
    const u = await newUser(), p = uuid();
    await ok(api(u.token, "PUT", `/api/projects/${p}`, { name: "Stored" }), 201);
    const id = await addPhoto(u.token, p);
    await ok(api(u.token, "POST", `/api/files/${id}/duplicate`, { id: uuid() }), 201);
    await addPhoto(u.token, p);
    const day = "2026-01-03";
    await snapshotStorage(env, day);
    const mine = (await rows(day)).find((r) => r.workspace_id === u.workspace)!;
    const each = (await env.DB.prepare("SELECT original_bytes + preview_bytes + thumbnail_bytes AS b FROM photos WHERE file_id = ?1").bind(id).first<{ b: number }>())!.b;
    expect(mine.objects).toBe(2);
    expect(mine.bytes).toBeGreaterThanOrEqual(2 * each - 6);
    expect(mine.bytes).toBeLessThanOrEqual(2 * each + 6);
  });
});
