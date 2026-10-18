import { groupLayoutProblem, PRESENTATION_MODES, splitDuration, validateGroup, validatePresentation, type ClipGroup, type Presentation } from "@fielder/vocab";
import { assertNumber, assertString, assertUuid, HttpError, json, readJson, type Router } from "./http.ts";
import type { Ctx } from "./index.ts";
import { accessIfExists, assertAccess, assertProjectRef, inWorkspaces } from "./tenancy.ts";
import { binResource } from "./trash.ts";
import { clipComposeFor, deleteClipCompose } from "./compose.ts";
import { registerPromote } from "./promote.ts";

/**
 * Timelines (issue #12, part 2): a project's rough cuts out of scouted photos. Dashboard only.
 * Client-owned ids; PUT replaces the whole timeline like a shooting day. Clips whose photo left the
 * project (or was deleted) are dropped silently; an overlay that does not belong to the clip's photo
 * is nulled. A clip without a photo is a placeholder (issue #31): a title holds the spot until a
 * shot is dropped onto it. A sequence's clips form a block (issue #37): `groups` on the timeline
 * holds each block's length settings, `group_id` on the clips the membership; a block's clips sit
 * together and show one shot, and a "total" block's durations are recomputed here on every save.
 * The phone never reads these.
 */

export interface TimelineRow { id: string; project_id: string; name: string; notes: string | null; lock_mode: string | null; groups: string; created_at: string; updated_at: string | null }
interface ClipRow { id: string; timeline_id: string; position: number; photo_id: string | null; shot_id: string | null; overlay_id: string | null; presentation: string | null; duration_ms: number; notes: string | null; title: string | null; sketch_id: string | null; group_id: string | null }

const MAX_CLIPS = 500;
const MIN_MS = 100, MAX_MS = 3_600_000;

const clipToApi = (c: ClipRow) => ({ id: c.id, photo_id: c.photo_id, shot_id: c.shot_id, overlay_id: c.overlay_id, presentation: c.presentation === null ? null : JSON.parse(c.presentation) as unknown, duration_ms: c.duration_ms, notes: c.notes, title: c.title, sketch_id: c.sketch_id, group_id: c.group_id });

export async function withClips(env: Ctx["env"], rows: TimelineRow[]) {
  if (rows.length === 0) return [];
  const { results } = await env.DB.prepare(
    `SELECT c.*, ph.shot_id FROM timeline_clips c LEFT JOIN photos ph ON ph.id = c.photo_id
     WHERE c.timeline_id IN (SELECT value FROM json_each(?1)) ORDER BY c.timeline_id, c.position`,
  ).bind(JSON.stringify(rows.map((t) => t.id))).all<ClipRow>();
  const own = await clipComposeFor(env, rows.map((t) => t.id));
  // The clips' own overlays and sketches (issue #31) come along, without drawings.
  return rows.map((t) => ({ ...t, groups: JSON.parse(t.groups) as ClipGroup[], clips: results.filter((c) => c.timeline_id === t.id).map(clipToApi), overlays: own.overlays.get(t.id) ?? [], sketches: own.sketches.get(t.id) ?? [] }));
}

/** Reads + deletes for the clip-owned overlays and sketches matching `where` (on both tables). */
export function ownedBy(env: Ctx["env"], where: string, args: unknown[]) {
  return {
    overlays: env.DB.prepare(`SELECT render_key AS k FROM overlays WHERE ${where}`).bind(...args),
    sketches: env.DB.prepare(`SELECT render_key AS k FROM sketches WHERE ${where}`).bind(...args),
    deletes: [env.DB.prepare(`DELETE FROM overlays WHERE ${where}`).bind(...args), env.DB.prepare(`DELETE FROM sketches WHERE ${where}`).bind(...args)],
  };
}

/** How many timelines (of any project) hold a photo of this shot; for the delete confirmation. */
export async function timelineCountOfShot(env: Ctx["env"], shotId: string): Promise<number> {
  const row = await env.DB.prepare("SELECT count(DISTINCT c.timeline_id) AS n FROM timeline_clips c JOIN photos ph ON ph.id = c.photo_id WHERE ph.shot_id = ?1").bind(shotId).first<{ n: number }>();
  return row?.n ?? 0;
}

export function registerTimelineRoutes(r: Router<Ctx>) {
  // The timelines of every project in the caller's workspaces, or one project's with ?project_id=.
  r.on("GET", "/api/timelines", async ({ env, url, tenant }) => {
    const project = url.searchParams.get("project_id");
    const mine = `project_id IN (SELECT id FROM projects WHERE ${inWorkspaces("workspace_id", 1)})`;
    const stmt = project
      ? env.DB.prepare(`SELECT * FROM timelines WHERE ${mine} AND project_id = ?2 AND deleted_at IS NULL ORDER BY created_at`).bind(tenant.wsList, assertUuid(project, "project_id"))
      : env.DB.prepare(`SELECT * FROM timelines WHERE ${mine} AND deleted_at IS NULL ORDER BY created_at`).bind(tenant.wsList);
    const { results } = await stmt.all<TimelineRow>();
    return json({ timelines: await withClips(env, results) });
  });

  r.on("GET", "/api/timelines/:id", async (ctx, { id }) => {
    const tid = assertUuid(id, "id");
    await assertAccess(ctx, "timeline", tid, "viewer");
    const row = await ctx.env.DB.prepare("SELECT * FROM timelines WHERE id = ?1 AND deleted_at IS NULL").bind(tid).first<TimelineRow>();
    if (!row) throw new HttpError(404, "timeline not found");
    return json({ timeline: (await withClips(ctx.env, [row]))[0] });
  });

  /** JSON { project_id, name, notes?, lock_mode?, groups?, clips: [...] } — the whole timeline. `groups` are the sequence blocks' settings; a photo clip may carry `group_id`. `lock_mode` forces one presentation mode on every clip (null = per clip). A clip is { id, photo_id, overlay_id?, presentation, duration_ms, notes? } or a placeholder { id, title, duration_ms, notes? }. */
  r.on("PUT", "/api/timelines/:id", async (ctx, { id }) => {
    const { env, request } = ctx;
    const tid = assertUuid(id, "id");
    const b = await readJson<Record<string, unknown>>(request);
    const projectId = assertUuid(b.project_id, "project_id");
    const name = assertString(b.name, "name", 120);
    const opt = (v: unknown, f: string, max: number) => (v === undefined || v === null || v === "" ? null : assertString(v, f, max));
    const notes = opt(b.notes, "notes", 4000);
    const lockMode = b.lock_mode === undefined || b.lock_mode === null ? null : (b.lock_mode as Presentation["mode"]);
    if (lockMode !== null && !PRESENTATION_MODES.includes(lockMode)) throw new HttpError(400, `lock_mode must be one of ${PRESENTATION_MODES.join(", ")} or null`);
    if (!Array.isArray(b.clips)) throw new HttpError(400, "clips must be an array");
    if (b.clips.length > MAX_CLIPS) throw new HttpError(413, `at most ${MAX_CLIPS} clips per timeline`);
    const groupList = b.groups === undefined || b.groups === null ? [] : b.groups;
    if (!Array.isArray(groupList)) throw new HttpError(400, "groups must be an array");
    const groups = new Map<string, ClipGroup>();
    groupList.forEach((g, i) => {
      const err = validateGroup(g);
      if (err) throw new HttpError(400, `groups[${i}]: ${err}`);
      const v = g as ClipGroup;
      if (groups.has(v.id)) throw new HttpError(400, "a group id is listed twice");
      groups.set(v.id, { id: v.id, mode: v.mode, total_ms: Math.round(v.total_ms), split: v.split, edge_weight: v.edge_weight });
    });
    let clips = b.clips.map((c, i) => {
      const o = (c ?? {}) as Record<string, unknown>;
      const base = {
        id: assertUuid(o.id, `clips[${i}].id`),
        duration_ms: Math.round(assertNumber(o.duration_ms, `clips[${i}].duration_ms`, { min: MIN_MS, max: MAX_MS })),
        notes: opt(o.notes, `clips[${i}].notes`, 1000),
        group_id: o.group_id === undefined || o.group_id === null ? null : assertUuid(o.group_id, `clips[${i}].group_id`),
      };
      if (base.group_id && !groups.has(base.group_id)) throw new HttpError(400, `clips[${i}].group_id is not in groups`);
      if (o.photo_id === undefined || o.photo_id === null) {
        // A placeholder holds the spot: no photo, overlay or presentation, but a title. With a sketch it is a sketch clip.
        const sketchId = o.sketch_id === undefined || o.sketch_id === null ? null : assertUuid(o.sketch_id, `clips[${i}].sketch_id`);
        return { ...base, photo_id: null, overlay_id: null, presentation: null, title: assertString(o.title, `clips[${i}].title`, 120), sketch_id: sketchId as string | null };
      }
      const perr = validatePresentation(o.presentation);
      if (perr) throw new HttpError(400, `clips[${i}].presentation: ${perr}`);
      return {
        ...base,
        photo_id: assertUuid(o.photo_id, `clips[${i}].photo_id`) as string | null,
        overlay_id: o.overlay_id === undefined || o.overlay_id === null ? null : assertUuid(o.overlay_id, `clips[${i}].overlay_id`),
        presentation: JSON.stringify(o.presentation) as string | null,
        title: null as string | null,
        sketch_id: null as string | null,
      };
    });
    if (new Set(clips.map((c) => c.id)).size !== clips.length) throw new HttpError(400, "a clip id is listed twice");
    const ws = await assertProjectRef(ctx, projectId);
    const stored = await accessIfExists(ctx, "timeline", tid, "editor");
    if (stored && stored !== ws) throw new HttpError(400, "a timeline cannot move to a project of another workspace");
    const photoIdList = [...new Set(clips.map((c) => c.photo_id).filter((x): x is string => !!x))];
    const shotOf = new Map<string, string>();
    if (photoIdList.length) {
      // Photos deleted or moved out of the project meanwhile are dropped (placeholders have none); an overlay of another photo is nulled.
      for (const x of (await env.DB.prepare("SELECT ph.id, ph.shot_id FROM photos ph JOIN shots s ON s.id = ph.shot_id WHERE s.project_id = ?1 AND s.deleted_at IS NULL AND ph.id IN (SELECT value FROM json_each(?2))")
        .bind(projectId, JSON.stringify(photoIdList)).all<{ id: string; shot_id: string }>()).results) shotOf.set(x.id, x.shot_id);
      clips = clips.filter((c) => c.photo_id === null || shotOf.has(c.photo_id));
      const overlayIds = [...new Set(clips.map((c) => c.overlay_id).filter((x): x is string => !!x))];
      if (overlayIds.length) {
        // A clip may show its photo's shot overlays or its own one, never another clip's.
        const rows = new Map((await env.DB.prepare("SELECT id, photo_id, timeline_id, clip_id FROM overlays WHERE id IN (SELECT value FROM json_each(?1))").bind(JSON.stringify(overlayIds)).all<{ id: string; photo_id: string; timeline_id: string | null; clip_id: string | null }>()).results.map((o) => [o.id, o]));
        for (const c of clips) {
          const o = c.overlay_id ? rows.get(c.overlay_id) : undefined;
          if (c.overlay_id && (!o || o.photo_id !== c.photo_id || (o.timeline_id !== null && (o.timeline_id !== tid || o.clip_id !== c.id)))) c.overlay_id = null;
        }
      }
    }
    const sketchIds = [...new Set(clips.map((c) => c.sketch_id).filter((x): x is string => !!x))];
    if (sketchIds.length) {
      // A sketch clip shows its own sketch or a sketch of a shot in the project; anything else falls back to a placeholder.
      const rows = new Map((await env.DB.prepare("SELECT sk.id, sk.timeline_id, sk.clip_id, s.project_id FROM sketches sk LEFT JOIN shots s ON s.id = sk.shot_id WHERE sk.id IN (SELECT value FROM json_each(?1))").bind(JSON.stringify(sketchIds)).all<{ id: string; timeline_id: string | null; clip_id: string | null; project_id: string | null }>()).results.map((x) => [x.id, x]));
      for (const c of clips) {
        const k = c.sketch_id ? rows.get(c.sketch_id) : undefined;
        if (c.sketch_id && (!k || (k.timeline_id !== null ? k.timeline_id !== tid || k.clip_id !== c.id : k.project_id !== projectId))) c.sketch_id = null;
      }
    }
    // Sequence blocks: together and one shot each; blocks without clips are dropped, a "total" block's clips share its length.
    const layout = groupLayoutProblem(clips.map((c) => ({ group_id: c.group_id, shot_id: c.photo_id ? shotOf.get(c.photo_id) ?? null : null })));
    if (layout) throw new HttpError(400, layout);
    const used = [...groups.values()].filter((g) => clips.some((c) => c.group_id === g.id));
    for (const g of used) {
      if (g.mode !== "total") continue;
      const members = clips.filter((c) => c.group_id === g.id);
      splitDuration(g.total_ms, members.length, g.split, g.edge_weight).forEach((ms, i) => { members[i].duration_ms = ms; });
    }
    // Clips that leave the timeline take their own overlays and sketches along (clips not yet saved have none).
    const before = (await env.DB.prepare("SELECT id FROM timeline_clips WHERE timeline_id = ?1").bind(tid).all<{ id: string }>()).results.map((x) => x.id);
    const kept = new Set(clips.map((c) => c.id));
    const removed = JSON.stringify(before.filter((x) => !kept.has(x)));
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO timelines (id, project_id, name, notes, lock_mode, groups, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?7, ?6)
         ON CONFLICT(id) DO UPDATE SET project_id = ?2, name = ?3, notes = ?4, lock_mode = ?5, groups = ?7, updated_at = ?6`,
      ).bind(tid, projectId, name, notes, lockMode, now, JSON.stringify(used)),
      env.DB.prepare("DELETE FROM timeline_clips WHERE timeline_id = ?1").bind(tid),
      ...clips.map((c, i) => env.DB.prepare("INSERT INTO timeline_clips (id, timeline_id, position, photo_id, overlay_id, presentation, duration_ms, notes, title, sketch_id, group_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)")
        .bind(c.id, tid, i, c.photo_id, c.overlay_id, c.presentation, c.duration_ms, c.notes, c.title, c.sketch_id, c.group_id)),
    ]);
    if (removed !== "[]") await deleteClipCompose(env, ownedBy(env, "timeline_id = ?1 AND clip_id IN (SELECT value FROM json_each(?2))", [tid, removed]));
    const row = await env.DB.prepare("SELECT * FROM timelines WHERE id = ?1").bind(tid).first<TimelineRow>();
    return json({ timeline: (await withClips(env, [row!]))[0] });
  });

  /** Moves the timeline to the recycle bin (its clips and their drawings stay until it is purged). */
  r.on("DELETE", "/api/timelines/:id", async (ctx, { id }) => {
    const tid = assertUuid(id, "id");
    await assertAccess(ctx, "timeline", tid, "editor");
    return json(await binResource(ctx.env, "timeline", tid));
  });

  registerPromote(r);
}
