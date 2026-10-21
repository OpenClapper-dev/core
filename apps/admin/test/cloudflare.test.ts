/**
 * The Cloudflare overlay (#217): off without a token, otherwise the four datasets read through a
 * stubbed GraphQL endpoint, one failing dataset reported in place, the cache, and the cron's snapshot.
 */
import { createExecutionContext, createScheduledController, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { overlay, snapshotCloudflare, type CfOverlay } from "../src/cloudflare.ts";
import worker, { type Env } from "../src/index.ts";

const base: Env = { ...env, ACCESS_TEAM_DOMAIN: "", ACCESS_AUD: "", ADMIN_DEV_BYPASS: "true" };
const on: Env = { ...base, CLOUDFLARE_ACCOUNT_ID: "acct", CF_ANALYTICS_TOKEN: "tok", APP_WORKER_NAME: "openclapper-api", R2_BUCKET: "openclapper-media" };
const get = (e: Env, path: string) => worker.fetch(new Request(`http://localhost:8788${path}`), e);

const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const today = new Date().toISOString().slice(0, 10);
const GB = 1024 ** 3;
/** What the stub answers per dataset; a test can make one fail. */
const answers: Record<string, () => unknown> = {
  r2StorageAdaptiveGroups: () => [
    { max: { payloadSize: 6 * GB, metadataSize: 1024, objectCount: 200 }, dimensions: { bucketName: "openclapper-media", datetime: `${today}T06:00:00Z` } },
    { max: { payloadSize: 5 * GB, metadataSize: 1024, objectCount: 190 }, dimensions: { bucketName: "openclapper-media", datetime: `${yesterday}T06:00:00Z` } },
    { max: { payloadSize: 2 * GB, metadataSize: 512, objectCount: 10 }, dimensions: { bucketName: "backups", datetime: `${yesterday}T06:00:00Z` } },
    { max: { payloadSize: 2 * GB, metadataSize: 512, objectCount: 10 }, dimensions: { bucketName: "backups", datetime: `${today}T06:00:00Z` } },
  ],
  r2OperationsAdaptiveGroups: () => [
    { sum: { requests: 1000 }, dimensions: { actionType: "GetObject" } },
    { sum: { requests: 50 }, dimensions: { actionType: "PutObject" } },
    { sum: { requests: 7 }, dimensions: { actionType: "DeleteObject" } },
  ],
  workersInvocationsAdaptive: () => [
    { sum: { requests: 400, errors: 2, subrequests: 900 }, quantiles: { cpuTimeP50: 1500, cpuTimeP99: 9000 }, dimensions: { date: yesterday } },
    { sum: { requests: 100, errors: 0, subrequests: 200 }, quantiles: { cpuTimeP50: 1200, cpuTimeP99: 8000 }, dimensions: { date: today } },
  ],
  d1AnalyticsAdaptiveGroups: () => [
    { sum: { readQueries: 300, writeQueries: 40, rowsRead: 5000, rowsWritten: 120 }, dimensions: { date: yesterday } },
    { sum: { readQueries: 100, writeQueries: 10, rowsRead: 1000, rowsWritten: 30 }, dimensions: { date: today } },
  ],
};
let calls = 0;

beforeAll(() => {
  const real = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== "https://api.cloudflare.com/client/v4/graphql") return real(input, init);
    calls += 1;
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer tok");
    const { query } = JSON.parse(String(init?.body)) as { query: string };
    const name = Object.keys(answers).find((k) => query.includes(k))!;
    const rows = answers[name]();
    if (rows instanceof Error) return Response.json({ data: null, errors: [{ message: rows.message }] });
    return Response.json({ data: { viewer: { accounts: [{ [name]: rows }] } } });
  });
});
afterAll(() => { vi.restoreAllMocks(); });

describe("the overlay", () => {
  test("off without a token: configured false, nothing fetched", async () => {
    const before = calls;
    expect(await (await get(base, "/api/cloudflare")).json()).toEqual({ configured: false });
    expect(await (await get({ ...on, CF_ANALYTICS_TOKEN: undefined }, "/api/cloudflare")).json()).toEqual({ configured: false });
    expect(calls).toBe(before);
  });

  test("reads the four datasets, sums R2 across buckets, classes the operations, marks the app's bucket", async () => {
    const o = await overlay(on, 7, Date.now());
    expect(o.r2.error).toBeNull();
    expect(o.r2.data!.buckets.map((b) => [b.name, b.app])).toEqual([["openclapper-media", true], ["backups", false]]);
    expect(o.r2.data!.total_bytes).toBe(8 * GB + 1536);
    expect(o.r2.data!.series.map((s) => s.day)).toEqual([yesterday, today]);
    expect(o.r2.data!.series[0].value).toBe(7 * GB + 1536);
    expect(o.r2_ops.data).toMatchObject({ class_a: 50, class_b: 1000 });
    expect(o.worker.data).toMatchObject({ requests: 500, errors: 2, cpu_p50_us: 1200 });
    expect(o.d1.data).toMatchObject({ rows_read: 6000, rows_written: 150 });
  });

  test("one failing dataset reports its error in place and the others stay; answers are cached", async () => {
    const t0 = Date.now() + 3_600_000;
    answers.d1AnalyticsAdaptiveGroups = () => new Error("unknown field rowsRead");
    const o = await overlay(on, 3, t0);
    expect(o.d1).toEqual({ data: null, error: "unknown field rowsRead" });
    expect(o.worker.error).toBeNull();
    expect(o.cached).toBe(false);
    const before = calls;
    expect((await overlay(on, 3, t0 + 1000)).cached).toBe(true);
    expect(calls).toBe(before);
    const r = await get(on, "/api/cloudflare?days=3");
    expect(r.status).toBe(200);
    expect(((await r.json()) as CfOverlay).configured).toBe(true);
  });

  test("days outside 1..31 are refused", async () => {
    expect((await get(on, "/api/cloudflare?days=0")).status).toBe(400);
    expect((await get(on, "/api/cloudflare?days=60")).status).toBe(400);
  });
});

describe("the cron", () => {
  test("keeps yesterday's totals per metric; without a token it does nothing", async () => {
    const t0 = Date.now() + 7_200_000;
    expect(await snapshotCloudflare(on, t0)).toBeGreaterThan(0);
    const rows = (await env.DB.prepare("SELECT metric, value FROM cf_usage_daily WHERE day = ?1 ORDER BY metric").bind(yesterday).all<{ metric: string; value: number }>()).results;
    expect(Object.fromEntries(rows.map((r) => [r.metric, r.value]))).toMatchObject({ "r2.bytes.total": 7 * GB + 1536, "worker.requests": 400, "worker.errors": 2 });
    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController({ scheduledTime: t0, cron: "47 3 * * *" }), base, ctx);
    await waitOnExecutionContext(ctx);
    const o = await overlay(on, 7, t0 + 10_800_000);
    expect(o.history.some((h) => h.metric === "r2.bytes.total" && h.day === yesterday)).toBe(true);
  });
});
