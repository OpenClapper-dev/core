import { assertString, assertUuid, HttpError, json, readJson, type Router } from "@openclapper/service-kit";
import { clearProject, fixedFolders, liveFiles, NOT_SETTINGS } from "./files.ts";
import { extensionsError, masterError } from "@openclapper/model";
import type { Ctx } from "./index.ts";
import { assertBodySize, imageSize, sniffImageType } from "./images.ts";
import { accessIfExists, assertAccess, assertRank, defaultWorkspace, inWorkspaces } from "./tenancy.ts";

interface ProjectRow { id: string; name: string; workspace_id: string; created_at: string; updated_at: string | null; file_count: number; canvas_live: string; master: string; extensions: string; description: string; picture_at: string | null }
/** A project as the API gives it: the master timeline as a list. */
const out = (p: ProjectRow) => ({ ...p, master: JSON.parse(p.master || "[]") as string[], extensions: JSON.parse(p.extensions || "[]") as string[] });

/** A project with how many live files it holds; its two fixed folders, what is in Settings and internal files are not counted. */
const LIST_SQL = `SELECT pr.id, pr.name, pr.workspace_id, pr.created_at, pr.updated_at, pr.canvas_live, pr.master, pr.extensions, pr.description, CASE WHEN pr.picture_type IS NULL THEN NULL ELSE pr.picture_at END AS picture_at,
  (SELECT count(*) FROM files f WHERE f.project_id = pr.id AND f.deleted_at IS NULL AND f.fixed IS NULL AND f.internal_of IS NULL AND ${NOT_SETTINGS("f")}) AS file_count
  FROM projects pr`;

/**
 * A project is a root of files and belongs to a workspace (docs/rewrite/07-organisation.md).
 * Client-owned UUIDs with upsert semantics. Lists hold the projects of all the caller's workspaces.
 */
export function registerProjectRoutes(r: Router<Ctx>) {
  r.on("GET", "/api/projects", async ({ env, tenant }) => {
    const { results } = await env.DB.prepare(`${LIST_SQL} WHERE ${inWorkspaces("pr.workspace_id", 1)} ORDER BY pr.name COLLATE NOCASE`)
      .bind(tenant.wsList).all<ProjectRow>();
    return json({ projects: results.map(out) });
  });

  // Names are unique case-insensitively within a workspace: a clash answers 409 + existing_id so the
  // client can adopt that project. A new project goes to `workspace_id` (default: the caller's own
  // workspace) and gets its fixed folders and the default properties; an existing one never changes workspace.
  r.on("PUT", "/api/projects/:id", async (ctx, { id }) => {
    const { env, request, tenant } = ctx;
    const pid = assertUuid(id, "id");
    const b = await readJson<Record<string, unknown>>(request);
    const name = assertString(b.name, "name", 80);
    // How watchers of a canvas see it change: realtime (a Durable Object) or gradual (reading D1). Absent: kept.
    const live = b.canvas_live === undefined ? null : b.canvas_live === "realtime" || b.canvas_live === "gradual" ? b.canvas_live : (() => { throw new HttpError(400, "canvas_live must be realtime or gradual"); })();
    const stored = await accessIfExists(ctx, "project", pid, "editor");
    const ws = stored ?? (b.workspace_id == null ? await defaultWorkspace(ctx) : assertRank(ctx, assertUuid(b.workspace_id, "workspace_id"), "editor", "workspace not found"));
    const clash = await env.DB.prepare("SELECT id FROM projects WHERE workspace_id = ?3 AND name = ?1 COLLATE NOCASE AND id != ?2")
      .bind(name, pid, ws).first<{ id: string }>();
    if (clash) return json({ error: "a project with this name already exists", existing_id: clash.id }, 409);
    const now = new Date().toISOString();
    // The master timeline: an order of timeline ids (those that are gone are skipped where it is shown).
    const wrongMaster = b.master === undefined ? null : masterError(b.master);
    if (wrongMaster) throw new HttpError(400, wrongMaster);
    const master = b.master === undefined ? null : JSON.stringify((b.master as string[]).map((x) => x.toLowerCase()));
    // The extensions switched on (08-extensions.md); with what each needs. Absent: kept.
    const wrongExt = b.extensions === undefined ? null : extensionsError(b.extensions);
    if (wrongExt) throw new HttpError(400, wrongExt);
    const ext = b.extensions === undefined ? null : JSON.stringify(b.extensions);
    // What the project is about (#426): plain text, shown on its card and in General. Absent: kept.
    const description = b.description === undefined ? null : typeof b.description === "string" && b.description.length <= DESCRIPTION_MAX ? b.description.trim() : (() => { throw new HttpError(400, `description is text of at most ${DESCRIPTION_MAX} characters`); })();
    if (stored) await env.DB.prepare("UPDATE projects SET name = ?2, updated_at = ?3, canvas_live = coalesce(?4, canvas_live), master = coalesce(?5, master), extensions = coalesce(?6, extensions), description = coalesce(?7, description) WHERE id = ?1").bind(pid, name, now, live, master, ext, description).run();
    else {
      await env.DB.batch([
        env.DB.prepare("INSERT INTO projects (id, name, workspace_id, created_at, canvas_live, master, extensions, description) VALUES (?1, ?2, ?3, ?4, coalesce(?5, 'realtime'), coalesce(?6, '[]'), coalesce(?7, '[]'), coalesce(?8, ''))").bind(pid, name, ws, now, live, master, ext, description),
        ...fixedFolders(env, pid, tenant.userId),
      ]);
    }
    const row = await env.DB.prepare(`${LIST_SQL} WHERE pr.id = ?1`).bind(pid).first<ProjectRow>();
    return json({ project: out(row!) }, stored ? 200 : 201);
  });

  // Only a project without live files can be deleted; its recycle bin is emptied with it. Live
  // files are never removed as a side effect.
  r.on("DELETE", "/api/projects/:id", async (ctx, { id }) => {
    const { env } = ctx;
    const pid = assertUuid(id, "id");
    await assertAccess(ctx, "project", pid, "editor");
    const used = await liveFiles(env, pid);
    if (used > 0) throw new HttpError(409, `the project still has ${used} file(s); delete them first`);
    await clearProject(env, pid);
    await env.SHOTS_BUCKET.delete(pictureKey(pid));
    await env.DB.prepare("DELETE FROM projects WHERE id = ?1").bind(pid).run();
    return json({ deleted: pid });
  });

  /**
   * The project's picture (#426): the image itself (JPEG, PNG or WebP, at most 5 MB and 4 megapixels; the Studio
   * scales a larger one down before it sends it). Not a file of the project: it belongs to the project itself.
   */
  r.on("PUT", "/api/projects/:id/picture", async (ctx, { id }) => {
    const { env, request } = ctx;
    const pid = assertUuid(id, "id");
    await assertAccess(ctx, "project", pid, "editor");
    assertBodySize(request, PICTURE_MAX_BYTES);
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (!bytes.byteLength) throw new HttpError(400, "the picture is empty");
    if (bytes.byteLength > PICTURE_MAX_BYTES) throw new HttpError(413, "the picture is larger than 5 MB");
    const type = sniffImageType(bytes.subarray(0, 16));
    if (!type || type === "image/heic") throw new HttpError(415, "the picture must be a JPEG, PNG or WebP image");
    const size = imageSize(bytes);
    if (!size) throw new HttpError(400, "the picture's size cannot be read");
    if (size.width * size.height > PICTURE_MAX_PIXELS) throw new HttpError(413, `the picture has more than 4 megapixels (${size.width} × ${size.height})`);
    await env.SHOTS_BUCKET.put(pictureKey(pid), bytes, { httpMetadata: { contentType: type } });
    await env.DB.prepare("UPDATE projects SET picture_type = ?2, picture_at = ?3 WHERE id = ?1").bind(pid, type, new Date().toISOString()).run();
    const row = await env.DB.prepare(`${LIST_SQL} WHERE pr.id = ?1`).bind(pid).first<ProjectRow>();
    return json({ project: out(row!) });
  });

  r.on("DELETE", "/api/projects/:id/picture", async (ctx, { id }) => {
    const { env } = ctx;
    const pid = assertUuid(id, "id");
    await assertAccess(ctx, "project", pid, "editor");
    await env.SHOTS_BUCKET.delete(pictureKey(pid));
    await env.DB.prepare("UPDATE projects SET picture_type = NULL, picture_at = NULL WHERE id = ?1").bind(pid).run();
    const row = await env.DB.prepare(`${LIST_SQL} WHERE pr.id = ?1`).bind(pid).first<ProjectRow>();
    return json({ project: out(row!) });
  });

  r.on("GET", "/api/projects/:id/picture", async (ctx, { id }) => {
    const { env } = ctx;
    const pid = assertUuid(id, "id");
    await assertAccess(ctx, "project", pid, "viewer");
    const obj = await env.SHOTS_BUCKET.get(pictureKey(pid));
    if (!obj) throw new HttpError(404, "the project has no picture");
    return new Response(obj.body, { headers: { "content-type": obj.httpMetadata?.contentType ?? "image/jpeg", "cache-control": "private, max-age=31536000, immutable" } });
  });
}

const DESCRIPTION_MAX = 2000;
const PICTURE_MAX_BYTES = 5 * 1024 * 1024;
/** About 2000 × 2000: 2048² so a square picture scaled to 2048 px still fits. */
const PICTURE_MAX_PIXELS = 2048 * 2048;
const pictureKey = (projectId: string) => `projects/${projectId}/picture`;
