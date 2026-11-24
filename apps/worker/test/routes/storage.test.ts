/**
 * Storage monitoring (#214): the daily cron snapshots the bucket's total into storage_daily and
 * rewrites the day's row when run again. The rows per workspace come back with stored photos (#374).
 */
import { env } from "cloudflare:workers";
import { describe, expect, test } from "vitest";
import { BUCKET_ROW, snapshotStorage, utcDay } from "../../src/storage-stats.ts";
import { runCron } from "./helpers.ts";

interface Row { day: string; workspace_id: string; bytes: number; objects: number; unsized: number }
const rows = async (day: string) => (await env.DB.prepare("SELECT * FROM storage_daily WHERE day = ?1").bind(day).all<Row>()).results;

describe("storage snapshot", () => {
  test("the cron writes the bucket total", async () => {
    await env.SHOTS_BUCKET.put("photos/a.jpg", "12345");
    await env.SHOTS_BUCKET.put("renders/b.webp", "123");
    await runCron();
    expect(await rows(utcDay())).toEqual([{ day: utcDay(), workspace_id: BUCKET_ROW, bytes: 8, objects: 2, unsized: 0 }]);
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
});
