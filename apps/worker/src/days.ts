import { assertString, assertUuid, HttpError, json, readJson, type Router } from "@fielder/service-kit";
import type { Ctx } from "./index.ts";
import { accessIfExists, assertAccess, assertProjectRef, inWorkspaces } from "./tenancy.ts";
import { binResource } from "./trash.ts";

interface DayRow { id: string; project_id: string; date: string; title: string | null; notes: string | null; created_at: string; updated_at: string | null }
interface DayShotRow { day_id: string; shot_id: string; position: number; planned_time: string | null; notes: string | null }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_SHOTS_PER_DAY = 300;

async function withShots(env: Ctx["env"], days: DayRow[]) {
  if (days.length === 0) return [];
  const { results } = await env.DB.prepare(
    "SELECT * FROM day_shots WHERE day_id IN (SELECT value FROM json_each(?1)) ORDER BY day_id, position",
  ).bind(JSON.stringify(days.map((d) => d.id))).all<DayShotRow>();
  return days.map((d) => ({
    ...d,
    shots: results.filter((s) => s.day_id === d.id).map((s) => ({ shot_id: s.shot_id, planned_time: s.planned_time, notes: s.notes })),
  }));
}

/** Shooting days of a project, each with its planned shots in order. Client-owned ids; PUT replaces a day. */
export function registerDayRoutes(r: Router<Ctx>) {
  // The days of every project in the caller's workspaces, or one project's with ?project_id=.
  r.on("GET", "/api/days", async ({ env, url, tenant }) => {
    const project = url.searchParams.get("project_id");
    const mine = `project_id IN (SELECT id FROM projects WHERE ${inWorkspaces("workspace_id", 1)})`;
    const stmt = project
      ? env.DB.prepare(`SELECT * FROM shooting_days WHERE ${mine} AND project_id = ?2 AND deleted_at IS NULL ORDER BY date, created_at`).bind(tenant.wsList, assertUuid(project, "project_id"))
      : env.DB.prepare(`SELECT * FROM shooting_days WHERE ${mine} AND deleted_at IS NULL ORDER BY date, created_at`).bind(tenant.wsList);
    const { results } = await stmt.all<DayRow>();
    return json({ days: await withShots(env, results) });
  });

  r.on("GET", "/api/days/:id", async (ctx, { id }) => {
    const did = assertUuid(id, "id");
    await assertAccess(ctx, "day", did, "viewer");
    const row = await ctx.env.DB.prepare("SELECT * FROM shooting_days WHERE id = ?1 AND deleted_at IS NULL").bind(did).first<DayRow>();
    if (!row) throw new HttpError(404, "day not found");
    return json({ day: (await withShots(ctx.env, [row]))[0] });
  });

  /** JSON { project_id, date, title?, notes?, shots: [{ shot_id, planned_time?, notes? }] } — the whole day. */
  r.on("PUT", "/api/days/:id", async (ctx, { id }) => {
    const { env, request } = ctx;
    const did = assertUuid(id, "id");
    const b = await readJson<Record<string, unknown>>(request);
    const projectId = assertUuid(b.project_id, "project_id");
    if (typeof b.date !== "string" || !DATE_RE.test(b.date)) throw new HttpError(400, "date must be YYYY-MM-DD");
    const opt = (v: unknown, f: string, max: number) => (v === undefined || v === null || v === "" ? null : assertString(v, f, max));
    const title = opt(b.title, "title", 120);
    const notes = opt(b.notes, "notes", 4000);
    if (!Array.isArray(b.shots)) throw new HttpError(400, "shots must be an array");
    if (b.shots.length > MAX_SHOTS_PER_DAY) throw new HttpError(413, `at most ${MAX_SHOTS_PER_DAY} shots per day`);
    let shots = b.shots.map((s, i) => {
      const o = (s ?? {}) as Record<string, unknown>;
      const time = o.planned_time === undefined || o.planned_time === null || o.planned_time === "" ? null : o.planned_time;
      if (time !== null && (typeof time !== "string" || !TIME_RE.test(time))) throw new HttpError(400, `shots[${i}].planned_time must be HH:MM`);
      return { shot_id: assertUuid(o.shot_id, `shots[${i}].shot_id`), planned_time: time as string | null, notes: opt(o.notes, `shots[${i}].notes`, 1000) };
    });
    if (new Set(shots.map((s) => s.shot_id)).size !== shots.length) throw new HttpError(400, "a shot is listed twice");
    const ws = await assertProjectRef(ctx, projectId);
    const stored = await accessIfExists(ctx, "day", did, "editor");
    if (stored && stored !== ws) throw new HttpError(400, "a day cannot move to a project of another workspace");
    // Shots deleted or moved to another project meanwhile are dropped from the day instead of failing the save.
    if (shots.length) {
      const ok = new Set((await env.DB.prepare("SELECT id FROM shots WHERE project_id = ?1 AND deleted_at IS NULL AND id IN (SELECT value FROM json_each(?2))")
        .bind(projectId, JSON.stringify(shots.map((s) => s.shot_id))).all<{ id: string }>()).results.map((x) => x.id));
      shots = shots.filter((s) => ok.has(s.shot_id));
    }
    const now = new Date().toISOString();
    const stmts = [
      env.DB.prepare(
        `INSERT INTO shooting_days (id, project_id, date, title, notes, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(id) DO UPDATE SET project_id = ?2, date = ?3, title = ?4, notes = ?5, updated_at = ?6`,
      ).bind(did, projectId, b.date, title, notes, now),
      env.DB.prepare("DELETE FROM day_shots WHERE day_id = ?1").bind(did),
      ...shots.map((s, i) => env.DB.prepare("INSERT INTO day_shots (day_id, shot_id, position, planned_time, notes) VALUES (?1, ?2, ?3, ?4, ?5)").bind(did, s.shot_id, i, s.planned_time, s.notes)),
    ];
    await env.DB.batch(stmts);
    const row = await env.DB.prepare("SELECT * FROM shooting_days WHERE id = ?1").bind(did).first<DayRow>();
    return json({ day: (await withShots(env, [row!]))[0] });
  });

  /** Moves the day to the recycle bin. */
  r.on("DELETE", "/api/days/:id", async (ctx, { id }) => {
    const rid = assertUuid(id, "id");
    await assertAccess(ctx, "day", rid, "editor");
    return json(await binResource(ctx.env, "day", rid));
  });
}
