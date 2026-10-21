/**
 * Storage monitoring (#215): the storage report from the cron's snapshots and the live photo numbers,
 * and the operator's marks (strictly validated, sorted, a crossed one reported).
 */
import { env } from "cloudflare:workers";
import { describe, expect, test } from "vitest";
import worker, { type Env } from "../src/index.ts";
import type { Mark, StorageReport } from "../src/storage.ts";

const bypass: Env = { ...env, ACCESS_TEAM_DOMAIN: "", ACCESS_AUD: "", ADMIN_DEV_BYPASS: "true" };
function call(method: string, path: string, body?: unknown): Promise<Response> {
  const headers = new Headers();
  if (body !== undefined) headers.set("content-type", "application/json");
  return worker.fetch(new Request(`http://localhost:8788${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), bypass);
}
async function json<T = Record<string, unknown>>(res: Promise<Response>, status: number): Promise<T> {
  const r = await res;
  const text = await r.text();
  expect(r.status, text).toBe(status);
  return JSON.parse(text) as T;
}
const GB = 1024 ** 3;
const day = (ago: number) => new Date(Date.now() - ago * 86_400_000).toISOString().slice(0, 10);
const snap = (d: string, ws: string, bytes: number, objects: number, unsized = 0) =>
  env.DB.prepare("INSERT OR REPLACE INTO storage_daily (day, workspace_id, bytes, objects, unsized) VALUES (?1, ?2, ?3, ?4, ?5)").bind(d, ws, bytes, objects, unsized).run();

describe("storage report", () => {
  test("empty before the first snapshot, then grouped by day with the bucket total apart", async () => {
    const empty = await json<StorageReport>(call("GET", "/api/storage"), 200);
    expect(empty.total).toBeNull();
    expect(empty.days).toEqual([]);
    expect(empty.marks).toEqual([]);

    const ws = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO workspaces (id, name, owner_user_id, kind) VALUES (?1, 'Crew', NULL, 'shared')").bind(ws).run();
    await snap(day(2), "", 5 * GB, 120);
    await snap(day(2), ws, 4 * GB, 100, 3);
    await snap(day(1), "", 6 * GB, 130);
    await snap(day(1), ws, 5 * GB, 110);
    const r = await json<StorageReport>(call("GET", "/api/storage?days=30"), 200);
    expect(r.total).toEqual({ bytes: 6 * GB, objects: 130, day: day(1) });
    expect(r.days.map((d) => d.day)).toEqual([day(2), day(1)]);
    expect(r.days[0]).toMatchObject({ total_bytes: 5 * GB, total_objects: 120, workspaces: [{ workspace_id: ws, bytes: 4 * GB, objects: 100, unsized: 3 }] });
    expect(r.workspaces.find((w) => w.id === ws)).toMatchObject({ name: "Crew", kind: "shared", photos: 0, bytes: 0, unsized: 0 });
    // The window leaves old days out, the total still comes from the latest row of all time.
    const narrow = await json<StorageReport>(call("GET", "/api/storage?days=1"), 200);
    expect(narrow.days.map((d) => d.day)).toEqual([day(1)]);
    expect(narrow.total?.bytes).toBe(6 * GB);
  });

  test("days outside 1..365 are refused", async () => {
    await json(call("GET", "/api/storage?days=0"), 400);
    await json(call("GET", "/api/storage?days=400"), 400);
    await json(call("GET", "/api/storage?days=soon"), 400);
  });
});

describe("marks", () => {
  test("saved sorted, read back, and the crossed ones reported against the latest total", async () => {
    const saved = await json<{ storage_marks: Mark[] }>(call("PUT", "/api/settings", { storage_marks: [{ bytes: 9 * GB, label: "9 GB" }, { bytes: 5 * GB, label: "5 GB" }] }), 200);
    expect(saved.storage_marks.map((m) => m.label)).toEqual(["5 GB", "9 GB"]);
    expect((await json<{ storage_marks: Mark[] }>(call("GET", "/api/settings"), 200)).storage_marks).toEqual(saved.storage_marks);
    const r = await json<StorageReport>(call("GET", "/api/storage"), 200);
    expect(r.marks).toEqual(saved.storage_marks);
    expect(r.crossed.map((m) => m.label)).toEqual(r.total && r.total.bytes >= 5 * GB ? ["5 GB"] : []);
    await snap(day(0), "", 9.5 * GB, 200);
    expect((await json<StorageReport>(call("GET", "/api/storage"), 200)).crossed.map((m) => m.label)).toEqual(["5 GB", "9 GB"]);
    const none = await json<{ storage_marks: Mark[] }>(call("PUT", "/api/settings", { storage_marks: [] }), 200);
    expect(none.storage_marks).toEqual([]);
  });

  test("bad marks are refused", async () => {
    await json(call("PUT", "/api/settings", {}), 400);
    await json(call("PUT", "/api/settings", { storage_marks: "5 GB" }), 400);
    await json(call("PUT", "/api/settings", { storage_marks: [{ bytes: -1, label: "x" }] }), 400);
    await json(call("PUT", "/api/settings", { storage_marks: [{ bytes: 1.5, label: "x" }] }), 400);
    await json(call("PUT", "/api/settings", { storage_marks: [{ bytes: 10, label: "" }] }), 400);
    await json(call("PUT", "/api/settings", { storage_marks: [{ bytes: 10, label: "x".repeat(41) }] }), 400);
    await json(call("PUT", "/api/settings", { storage_marks: Array.from({ length: 11 }, (_, i) => ({ bytes: i + 1, label: "m" })) }), 400);
  });
});
