/**
 * Storage monitoring (epic #67, issue #214): one snapshot a day into storage_daily, read by the
 * admin plane: the bound bucket's total from an R2 listing, and a row per workspace for what its
 * photos occupy, binned ones included. Images shared by copies of a photo are counted once;
 * `objects` is the number of stored photos (each with up to three images).
 */
import type { Env } from "./index.ts";

/** The bucket row's key: not a workspace. */
export const BUCKET_ROW = "";

export interface StorageSnapshot { day: string; workspaces: number; bytes: number; objects: number }

/** Today in UTC, the day every snapshot and the admin board use. */
export const utcDay = (at = Date.now()) => new Date(at).toISOString().slice(0, 10);

/** Every object in the bucket: one Class A operation per 1 000 objects. */
async function bucketTotal(bucket: R2Bucket): Promise<{ bytes: number; objects: number }> {
  let bytes = 0, objects = 0, cursor: string | undefined;
  do {
    const page = await bucket.list({ cursor, limit: 1000 });
    for (const o of page.objects) { bytes += o.size; objects += 1; }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return { bytes, objects };
}

/** Writes (or rewrites) the day's rows. Never throws past the cron: the caller logs. */
export async function snapshotStorage(env: Pick<Env, "DB" | "SHOTS_BUCKET">, day = utcDay()): Promise<StorageSnapshot> {
  const { results } = await env.DB.prepare(`SELECT ws, count(*) AS photos, coalesce(sum(bytes), 0) AS bytes, sum(bytes IS NULL) AS unsized FROM (
         SELECT pr.workspace_id AS ws, ph.object_id, max(coalesce(ph.original_bytes, 0) + coalesce(ph.preview_bytes, 0) + coalesce(ph.thumbnail_bytes, 0)) AS bytes
         FROM photos ph JOIN files f ON f.id = ph.file_id JOIN projects pr ON pr.id = f.project_id GROUP BY pr.workspace_id, ph.object_id
       ) GROUP BY ws`).all<{ ws: string; photos: number; bytes: number; unsized: number }>();
  const total = await bucketTotal(env.SHOTS_BUCKET);
  const row = env.DB.prepare("INSERT OR REPLACE INTO storage_daily (day, workspace_id, bytes, objects, unsized) VALUES (?1, ?2, ?3, ?4, ?5)");
  await env.DB.batch([
    row.bind(day, BUCKET_ROW, total.bytes, total.objects, 0),
    ...results.map((r) => row.bind(day, r.ws, r.bytes, r.photos, r.unsized)),
  ]);
  return { day, workspaces: results.length, ...total };
}
