/**
 * Storage monitoring (#214): the daily cron snapshots photo storage per workspace and the bucket's
 * total into storage_daily, and rewrites the day's rows when run again.
 */
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, test } from "vitest";
import { BUCKET_ROW, snapshotStorage, utcDay } from "../../src/storage-stats.ts";
import { buildWorld, newUser, runCron, type User, type World } from "./helpers.ts";

let u: User;
let w: World;
beforeEach(async () => {
  u ??= await newUser();
  w = await buildWorld(u);
});

interface Row { day: string; workspace_id: string; bytes: number; objects: number; unsized: number }
const rows = async (day: string) => (await env.DB.prepare("SELECT * FROM storage_daily WHERE day = ?1").bind(day).all<Row>()).results;

describe("storage snapshot", () => {
  test("the cron writes the bucket total and one row per workspace with photos", async () => {
    await runCron();
    const today = await rows(utcDay());
    const bucket = today.find((r) => r.workspace_id === BUCKET_ROW)!;
    let bytes = 0, objects = 0, cursor: string | undefined;
    do {
      const page = await env.SHOTS_BUCKET.list({ cursor, limit: 1000 });
      for (const o of page.objects) { bytes += o.size; objects += 1; }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    expect(objects).toBeGreaterThan(0);
    expect(bucket).toMatchObject({ bytes, objects, unsized: 0 });

    const ws = today.find((r) => r.workspace_id === w.workspace)!;
    const photos = await env.DB.prepare(
      "SELECT count(*) AS n, coalesce(sum(x.size_bytes), 0) AS bytes FROM photos x JOIN shots s ON s.id = x.shot_id JOIN projects p ON p.id = s.project_id WHERE p.workspace_id = ?1",
    ).bind(w.workspace).first<{ n: number; bytes: number }>();
    expect(ws.objects).toBe(photos!.n);
    expect(ws.bytes).toBe(photos!.bytes);
    expect(ws.bytes).toBeGreaterThan(0);
  });

  test("a second run of the same day replaces the rows; unsized photos are counted apart", async () => {
    const day = "2026-01-02";
    await snapshotStorage(env, day);
    await env.DB.prepare("UPDATE photos SET size_bytes = NULL WHERE shot_id = ?1").bind(w.shot).run();
    await snapshotStorage(env, day);
    const ws = (await rows(day)).filter((r) => r.workspace_id === w.workspace);
    expect(ws).toHaveLength(1);
    expect(ws[0].unsized).toBeGreaterThan(0);
  });
});
