/**
 * Storage monitoring for the board (epic #67, issue #215): the daily snapshots the app Worker's cron
 * writes (storage_daily, apps/worker/src/storage-stats.ts), the live per-workspace numbers, and the
 * operator's marks: plain byte thresholds with a label, kept in admin_settings. Nothing here knows
 * about plans or free tiers; a crossed mark shows as a banner on the board.
 */
import { assertNumber, assertString, HttpError } from "@openclapper/service-kit";

/** The bucket row's key in storage_daily (storage-stats.ts): not a workspace. */
const BUCKET_ROW = "";
export const MAX_MARKS = 10;
const MARKS_KEY = "storage_marks";

export interface Mark { bytes: number; label: string }
export interface StorageDay { day: string; total_bytes: number; total_objects: number; workspaces: { workspace_id: string; bytes: number; objects: number; unsized: number }[] }
export interface StorageReport {
  /** The latest bucket snapshot (null before the first cron run); `day` says how old it is. */
  total: { bytes: number; objects: number; day: string } | null;
  /** Every workspace with its photos now, from the database. */
  workspaces: { id: string; name: string; kind: string; owner_email: string | null; photos: number; bytes: number; unsized: number }[];
  days: StorageDay[];
  marks: Mark[];
  /** The marks the latest total is at or above, ascending. */
  crossed: Mark[];
}

/** Strict: this is an interactive edit. Sorted ascending, so the board and the banner read them in order. */
export function parseMarks(v: unknown): Mark[] {
  if (!Array.isArray(v)) throw new HttpError(400, "storage_marks must be an array");
  if (v.length > MAX_MARKS) throw new HttpError(400, `at most ${MAX_MARKS} marks`);
  const marks = v.map((m: unknown, i) => {
    const o = (m ?? {}) as Record<string, unknown>;
    const bytes = assertNumber(o.bytes, `marks[${i}].bytes`, { min: 1 });
    if (!Number.isInteger(bytes)) throw new HttpError(400, `marks[${i}].bytes must be an integer`);
    return { bytes, label: assertString(o.label, `marks[${i}].label`, 40) };
  });
  return marks.sort((a, b) => a.bytes - b.bytes);
}

export async function readMarks(db: D1Database): Promise<Mark[]> {
  const row = await db.prepare("SELECT value FROM admin_settings WHERE key = ?1").bind(MARKS_KEY).first<{ value: string }>();
  if (!row) return [];
  try { return parseMarks(JSON.parse(row.value)); } catch { return []; }
}

/** The statement that stores the marks; the route batches it with its audit row. */
export function marksStatement(db: D1Database, marks: Mark[], by: string): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO admin_settings (key, value, updated_at, updated_by) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
  ).bind(MARKS_KEY, JSON.stringify(marks), new Date().toISOString(), by);
}

export const crossedMarks = (marks: Mark[], total: number | null) => (total === null ? [] : marks.filter((m) => total >= m.bytes));

export async function storageReport(db: D1Database, days: number): Promise<StorageReport> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const [snap, live, marks] = await Promise.all([
    db.prepare("SELECT day, workspace_id, bytes, objects, unsized FROM storage_daily WHERE day >= ?1 ORDER BY day").bind(since)
      .all<{ day: string; workspace_id: string; bytes: number; objects: number; unsized: number }>(),
    db.prepare(
      `WITH ph AS (SELECT p.workspace_id AS ws, count(*) AS photos, coalesce(sum(x.size_bytes), 0) AS bytes, sum(x.size_bytes IS NULL) AS unsized
                   FROM photos x JOIN shots s ON s.id = x.shot_id JOIN projects p ON p.id = s.project_id GROUP BY p.workspace_id)
       SELECT w.id, w.name, w.kind, o.email AS owner_email, coalesce(ph.photos, 0) AS photos, coalesce(ph.bytes, 0) AS bytes, coalesce(ph.unsized, 0) AS unsized
       FROM workspaces w LEFT JOIN users o ON o.id = w.owner_user_id LEFT JOIN ph ON ph.ws = w.id ORDER BY bytes DESC, w.created_at`,
    ).all<StorageReport["workspaces"][number]>(),
    readMarks(db),
  ]);
  const byDay = new Map<string, StorageDay>();
  for (const r of snap.results) {
    let d = byDay.get(r.day);
    if (!d) byDay.set(r.day, (d = { day: r.day, total_bytes: 0, total_objects: 0, workspaces: [] }));
    if (r.workspace_id === BUCKET_ROW) { d.total_bytes = r.bytes; d.total_objects = r.objects; }
    else d.workspaces.push({ workspace_id: r.workspace_id, bytes: r.bytes, objects: r.objects, unsized: r.unsized });
  }
  // The latest bucket row of all time, not only of the window: a fresh instance shows its first snapshot either way.
  const latest = await db.prepare("SELECT day, bytes, objects FROM storage_daily WHERE workspace_id = ?1 ORDER BY day DESC LIMIT 1").bind(BUCKET_ROW)
    .first<{ day: string; bytes: number; objects: number }>();
  const total = latest ? { bytes: latest.bytes, objects: latest.objects, day: latest.day } : null;
  return { total, workspaces: live.results, days: [...byDay.values()], marks, crossed: crossedMarks(marks, total?.bytes ?? null) };
}
