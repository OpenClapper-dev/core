import { EFFECTS, fixtureKind, parseSequenceTracks, SEQUENCE_MAX_MS, SEQUENCE_NAME_MAX } from "@openclapper/vocab";
import { assertNumber, assertString, assertUuid, HttpError, json, readJson, type Router } from "@openclapper/service-kit";
import type { Ctx } from "./index.ts";
import { accessIfExists, assertAccess, assertProjectRef, inWorkspaces } from "./tenancy.ts";

/**
 * Light sequences (#304): keyframed light tracks, per project, edited and played in the Studio
 * through the phone proxy (#307). Client-owned ids; PUT replaces the whole sequence. A track's light
 * that is not a fixture of the project's workspace (deleted, another workspace) is unassigned.
 */
interface Row { id: string; project_id: string; name: string; duration_ms: number; loop: number; tracks: string; created_at: string; updated_at: string | null }

const toApi = (r: Row) => ({ id: r.id, project_id: r.project_id, name: r.name, duration_ms: r.duration_ms, loop: r.loop === 1, tracks: JSON.parse(r.tracks) as unknown, created_at: r.created_at, updated_at: r.updated_at });
const EFFECT_IDS = new Set<string>(EFFECTS.map((e) => e.id));
/** A sequence's JSON stays small (a few hundred bytes per keyframe); this bounds a stray save. */
const TRACKS_MAX_BYTES = 512 * 1024;

export function registerLightSequenceRoutes(r: Router<Ctx>) {
  // The sequences of every project in the caller's workspaces, or one project's with ?project_id=.
  r.on("GET", "/api/light-sequences", async ({ env, url, tenant }) => {
    const project = url.searchParams.get("project_id");
    const mine = `project_id IN (SELECT id FROM projects WHERE ${inWorkspaces("workspace_id", 1)})`;
    const stmt = project
      ? env.DB.prepare(`SELECT * FROM light_sequences WHERE ${mine} AND project_id = ?2 ORDER BY created_at`).bind(tenant.wsList, assertUuid(project, "project_id"))
      : env.DB.prepare(`SELECT * FROM light_sequences WHERE ${mine} ORDER BY created_at`).bind(tenant.wsList);
    return json({ light_sequences: (await stmt.all<Row>()).results.map(toApi) });
  });

  // One sequence: the phone fetches what it is asked to run (#321).
  r.on("GET", "/api/light-sequences/:id", async (ctx, { id }) => {
    const sid = assertUuid(id, "id");
    await assertAccess(ctx, "light_sequence", sid, "viewer");
    return json({ light_sequence: toApi((await ctx.env.DB.prepare("SELECT * FROM light_sequences WHERE id = ?1").bind(sid).first<Row>())!) });
  });

  /** JSON { project_id, name, duration_ms, loop, tracks } — the whole sequence. */
  r.on("PUT", "/api/light-sequences/:id", async (ctx, { id }) => {
    const { env, request } = ctx;
    const sid = assertUuid(id, "id");
    const b = await readJson<Record<string, unknown>>(request);
    const projectId = assertUuid(b.project_id, "project_id");
    const name = assertString(b.name, "name", SEQUENCE_NAME_MAX);
    const duration = Math.round(assertNumber(b.duration_ms, "duration_ms", { min: 100, max: SEQUENCE_MAX_MS }));
    if (b.loop !== undefined && typeof b.loop !== "boolean") throw new HttpError(400, "loop must be true or false");
    const parsed = parseSequenceTracks(b.tracks, duration, (k) => !!fixtureKind(k), (e) => EFFECT_IDS.has(e));
    if ("error" in parsed) throw new HttpError(400, parsed.error);
    const ws = await assertProjectRef(ctx, projectId);
    const stored = await accessIfExists(ctx, "light_sequence", sid, "editor");
    if (stored && stored !== ws) throw new HttpError(400, "a sequence cannot move to a project of another workspace");
    // Lights of another workspace, or deleted ones, are unassigned rather than refused.
    const ids = parsed.tracks.flatMap((t) => (t.fixtureId ? [t.fixtureId] : []));
    const known = new Set(ids.length
      ? (await env.DB.prepare("SELECT id FROM fixtures WHERE workspace_id = ?1 AND id IN (SELECT value FROM json_each(?2))").bind(ws, JSON.stringify(ids)).all<{ id: string }>()).results.map((x) => x.id)
      : []);
    const tracks = JSON.stringify(parsed.tracks.map((t) => (t.fixtureId && !known.has(t.fixtureId) ? { ...t, fixtureId: null } : t)));
    if (tracks.length > TRACKS_MAX_BYTES) throw new HttpError(413, "the sequence is too large");
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO light_sequences (id, project_id, name, duration_ms, loop, tracks, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(id) DO UPDATE SET project_id = ?2, name = ?3, duration_ms = ?4, loop = ?5, tracks = ?6, updated_at = ?7`,
    ).bind(sid, projectId, name, duration, b.loop === true ? 1 : 0, tracks, now).run();
    return json({ light_sequence: toApi((await env.DB.prepare("SELECT * FROM light_sequences WHERE id = ?1").bind(sid).first<Row>())!) });
  });

  r.on("DELETE", "/api/light-sequences/:id", async (ctx, { id }) => {
    const sid = assertUuid(id, "id");
    await assertAccess(ctx, "light_sequence", sid, "editor");
    await ctx.env.DB.prepare("DELETE FROM light_sequences WHERE id = ?1").bind(sid).run();
    return json({ deleted: sid });
  });
}
