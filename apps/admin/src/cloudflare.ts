/**
 * The optional Cloudflare overlay (epic #67, issue #217): the account-wide numbers only Cloudflare's
 * GraphQL Analytics API knows (R2 storage across every bucket of the account, Worker invocations and
 * CPU, D1 rows). Off until a read-only token (Account Analytics Read) is set as CF_ANALYTICS_TOKEN.
 * Each dataset is queried on its own, so one failing one (a renamed field, a missing permission)
 * leaves the others readable and reports its error in place. Numbers only: no plans, no limits.
 */
import type { Env } from "./index.ts";

const ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";
/** The API allows 300 queries per 5 minutes; board reloads share one answer for this long. */
const CACHE_MS = 5 * 60_000;
/** The storage dataset answers at most 31 days. */
export const MAX_DAYS = 31;

export interface Series { day: string; value: number }
export interface Dataset<T> { data: T | null; error: string | null }
export interface CfOverlay {
  configured: true;
  fetched_at: string;
  cached: boolean;
  days: number;
  r2: Dataset<{ buckets: { name: string; bytes: number; metadata_bytes: number; objects: number; app: boolean }[]; total_bytes: number; series: Series[] }>;
  r2_ops: Dataset<{ class_a: number; class_b: number; by_action: { action: string; requests: number }[] }>;
  worker: Dataset<{ requests: number; errors: number; subrequests: number; cpu_p50_us: number | null; cpu_p99_us: number | null; series: { day: string; requests: number; errors: number }[] }>;
  d1: Dataset<{ rows_read: number; rows_written: number; read_queries: number; write_queries: number; series: { day: string; rows_read: number; rows_written: number }[] }>;
  /** Stored by the daily cron, beyond the API's window. */
  history: { day: string; metric: string; value: number }[];
}

export const configured = (env: Env) => Boolean(env.CF_ANALYTICS_TOKEN && env.CLOUDFLARE_ACCOUNT_ID);

interface GqlAccount { [dataset: string]: Record<string, unknown>[] }

/** One GraphQL query, the account unwrapped; an API error becomes a thrown Error with its message. */
async function gql(env: Env, query: string, variables: Record<string, unknown>): Promise<GqlAccount> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ query, variables: { accountTag: env.CLOUDFLARE_ACCOUNT_ID, ...variables } }),
  });
  const body = (await res.json().catch(() => null)) as { data?: { viewer?: { accounts?: GqlAccount[] } }; errors?: { message: string }[] } | null;
  if (!res.ok) throw new Error(`Cloudflare answered ${res.status}${body?.errors?.[0] ? `: ${body.errors[0].message}` : ""}`);
  if (body?.errors?.length) throw new Error(body.errors.map((e) => e.message).join("; "));
  const account = body?.data?.viewer?.accounts?.[0];
  if (!account) throw new Error("Cloudflare answered without the account (is the token's account right?)");
  return account;
}

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const dayOf = (datetime: string) => datetime.slice(0, 10);
async function dataset<T>(fn: () => Promise<T>): Promise<Dataset<T>> {
  try { return { data: await fn(), error: null }; } catch (e) { return { data: null, error: (e as Error).message }; }
}

/** The R2 operation classes as Cloudflare bills them; deletes and aborts are free. */
const CLASS_A = new Set(["PutObject", "CopyObject", "ListObjects", "ListBuckets", "CreateMultipartUpload", "UploadPart", "UploadPartCopy", "CompleteMultipartUpload", "ListMultipartUploads", "ListParts", "PutBucket", "PutBucketEncryption", "PutBucketCors", "PutBucketLifecycleConfiguration", "LifecycleStorageTierTransition"]);
const CLASS_B = new Set(["GetObject", "HeadObject", "HeadBucket", "UsageSummary", "GetBucketEncryption", "GetBucketLocation", "GetBucketCors", "GetBucketLifecycleConfiguration"]);

async function r2Storage(env: Env, start: string, end: string): Promise<NonNullable<CfOverlay["r2"]["data"]>> {
  // No bucketName filter: every bucket of the account, which is what storage is billed on.
  const a = await gql(env, `query R2Storage($accountTag: string!, $start: Time!, $end: Time!) { viewer { accounts(filter: { accountTag: $accountTag }) {
    r2StorageAdaptiveGroups(limit: 10000, filter: { datetime_geq: $start, datetime_leq: $end }, orderBy: [datetime_DESC]) {
      max { payloadSize metadataSize objectCount } dimensions { bucketName datetime } } } } }`, { start, end });
  const rows = (a.r2StorageAdaptiveGroups ?? []) as { max: { payloadSize: number; metadataSize: number; objectCount: number }; dimensions: { bucketName: string; datetime: string } }[];
  // Latest sample per bucket = now; the day's peak per bucket, summed, = the series (the GB-month base).
  const latest = new Map<string, (typeof rows)[number]>();
  const perDay = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const b = r.dimensions.bucketName;
    if (!latest.has(b)) latest.set(b, r);
    const d = dayOf(r.dimensions.datetime);
    const byBucket = perDay.get(d) ?? new Map<string, number>();
    byBucket.set(b, Math.max(byBucket.get(b) ?? 0, n(r.max.payloadSize) + n(r.max.metadataSize)));
    perDay.set(d, byBucket);
  }
  const buckets = [...latest.values()].map((r) => ({
    name: r.dimensions.bucketName, bytes: n(r.max.payloadSize) + n(r.max.metadataSize), metadata_bytes: n(r.max.metadataSize), objects: n(r.max.objectCount), app: r.dimensions.bucketName === env.R2_BUCKET,
  })).sort((x, y) => y.bytes - x.bytes);
  const series = [...perDay.entries()].map(([day, m]) => ({ day, value: [...m.values()].reduce((s, v) => s + v, 0) })).sort((x, y) => x.day.localeCompare(y.day));
  return { buckets, total_bytes: buckets.reduce((s, b) => s + b.bytes, 0), series };
}

async function r2Ops(env: Env, start: string, end: string): Promise<NonNullable<CfOverlay["r2_ops"]["data"]>> {
  const a = await gql(env, `query R2Ops($accountTag: string!, $start: Time!, $end: Time!) { viewer { accounts(filter: { accountTag: $accountTag }) {
    r2OperationsAdaptiveGroups(limit: 10000, filter: { datetime_geq: $start, datetime_leq: $end }) { sum { requests } dimensions { actionType } } } } }`, { start, end });
  const rows = (a.r2OperationsAdaptiveGroups ?? []) as { sum: { requests: number }; dimensions: { actionType: string } }[];
  const by = new Map<string, number>();
  for (const r of rows) by.set(r.dimensions.actionType, (by.get(r.dimensions.actionType) ?? 0) + n(r.sum.requests));
  const by_action = [...by.entries()].map(([action, requests]) => ({ action, requests })).sort((x, y) => y.requests - x.requests);
  const sum = (set: Set<string>) => by_action.filter((x) => set.has(x.action)).reduce((s, x) => s + x.requests, 0);
  return { class_a: sum(CLASS_A), class_b: sum(CLASS_B), by_action };
}

async function worker(env: Env, start: string, end: string): Promise<NonNullable<CfOverlay["worker"]["data"]>> {
  const a = await gql(env, `query Workers($accountTag: string!, $start: Time!, $end: Time!, $scriptName: string) { viewer { accounts(filter: { accountTag: $accountTag }) {
    workersInvocationsAdaptive(limit: 10000, filter: { datetime_geq: $start, datetime_leq: $end, scriptName: $scriptName }) {
      sum { requests errors subrequests } quantiles { cpuTimeP50 cpuTimeP99 } dimensions { date } } } } }`, { start, end, scriptName: env.APP_WORKER_NAME ?? "openclapper-api" });
  const rows = (a.workersInvocationsAdaptive ?? []) as { sum: { requests: number; errors: number; subrequests: number }; quantiles: { cpuTimeP50: number; cpuTimeP99: number }; dimensions: { date: string } }[];
  const series = rows.map((r) => ({ day: r.dimensions.date, requests: n(r.sum.requests), errors: n(r.sum.errors) })).sort((x, y) => x.day.localeCompare(y.day));
  const total = (k: "requests" | "errors" | "subrequests") => rows.reduce((s, r) => s + n(r.sum[k]), 0);
  // The quantiles come per day; the latest day stands for "now".
  const last = rows.slice().sort((x, y) => y.dimensions.date.localeCompare(x.dimensions.date))[0];
  return { requests: total("requests"), errors: total("errors"), subrequests: total("subrequests"), cpu_p50_us: last ? n(last.quantiles.cpuTimeP50) : null, cpu_p99_us: last ? n(last.quantiles.cpuTimeP99) : null, series };
}

async function d1(env: Env, startDay: string, endDay: string): Promise<NonNullable<CfOverlay["d1"]["data"]>> {
  const a = await gql(env, `query D1($accountTag: string!, $start: Date!, $end: Date!) { viewer { accounts(filter: { accountTag: $accountTag }) {
    d1AnalyticsAdaptiveGroups(limit: 10000, filter: { date_geq: $start, date_leq: $end }) { sum { readQueries writeQueries rowsRead rowsWritten } dimensions { date } } } } }`, { start: startDay, end: endDay });
  const rows = (a.d1AnalyticsAdaptiveGroups ?? []) as { sum: { readQueries: number; writeQueries: number; rowsRead: number; rowsWritten: number }; dimensions: { date: string } }[];
  const byDay = new Map<string, { rows_read: number; rows_written: number }>();
  for (const r of rows) {
    const d = byDay.get(r.dimensions.date) ?? { rows_read: 0, rows_written: 0 };
    d.rows_read += n(r.sum.rowsRead); d.rows_written += n(r.sum.rowsWritten);
    byDay.set(r.dimensions.date, d);
  }
  const total = (k: "readQueries" | "writeQueries" | "rowsRead" | "rowsWritten") => rows.reduce((s, r) => s + n(r.sum[k]), 0);
  return { rows_read: total("rowsRead"), rows_written: total("rowsWritten"), read_queries: total("readQueries"), write_queries: total("writeQueries"), series: [...byDay.entries()].map(([day, v]) => ({ day, ...v })).sort((x, y) => x.day.localeCompare(y.day)) };
}

const cache = new Map<number, { at: number; overlay: CfOverlay }>();

/** The four datasets for the last `days`, plus the stored history; cached per isolate for CACHE_MS. */
export async function overlay(env: Env, days: number, now = Date.now()): Promise<CfOverlay> {
  const hit = cache.get(days);
  if (hit && now - hit.at < CACHE_MS) return { ...hit.overlay, cached: true };
  const end = new Date(now), start = new Date(now - days * 86_400_000);
  const [r2, r2_ops, w, d, history] = await Promise.all([
    dataset(() => r2Storage(env, start.toISOString(), end.toISOString())),
    dataset(() => r2Ops(env, start.toISOString(), end.toISOString())),
    dataset(() => worker(env, start.toISOString(), end.toISOString())),
    dataset(() => d1(env, start.toISOString().slice(0, 10), end.toISOString().slice(0, 10))),
    env.DB.prepare("SELECT day, metric, value FROM cf_usage_daily ORDER BY day").all<{ day: string; metric: string; value: number }>().then((r) => r.results),
  ]);
  const out: CfOverlay = { configured: true, fetched_at: end.toISOString(), cached: false, days, r2, r2_ops, worker: w, d1: d, history };
  cache.set(days, { at: now, overlay: out });
  return out;
}

/** Yesterday's numbers into cf_usage_daily (the daily cron): what the chart needs beyond 31 days. */
export async function snapshotCloudflare(env: Env, now = Date.now()): Promise<number> {
  const day = new Date(now - 86_400_000).toISOString().slice(0, 10);
  const o = await overlay(env, 2, now);
  const rows: [string, number][] = [];
  if (o.r2.data) {
    const total = o.r2.data.series.find((s) => s.day === day);
    if (total) rows.push(["r2.bytes.total", total.value]);
    for (const b of o.r2.data.buckets) rows.push([`r2.bytes.${b.name}`, b.bytes]);
    rows.push(["r2.objects.total", o.r2.data.buckets.reduce((s, b) => s + b.objects, 0)]);
  }
  const w = o.worker.data?.series.find((s) => s.day === day);
  if (w) rows.push(["worker.requests", w.requests], ["worker.errors", w.errors]);
  const d = o.d1.data?.series.find((s) => s.day === day);
  if (d) rows.push(["d1.rows_read", d.rows_read], ["d1.rows_written", d.rows_written]);
  if (!rows.length) return 0;
  const stmt = env.DB.prepare("INSERT OR REPLACE INTO cf_usage_daily (day, metric, value, taken_at) VALUES (?1, ?2, ?3, ?4)");
  const at = new Date(now).toISOString();
  await env.DB.batch(rows.map(([metric, value]) => stmt.bind(day, metric, value, at)));
  return rows.length;
}
