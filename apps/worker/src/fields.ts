import { validateFieldDef, type FieldDef } from "@fielder/vocab";
import { assertUuid, HttpError, json, readJson, type Router } from "@fielder/service-kit";
import type { Ctx } from "./index.ts";
import { accessIfExists, assertAccess, assertProjectRef, inWorkspaces } from "./tenancy.ts";
import { binResource } from "./trash.ts";

interface FieldRow { id: string; project_id: string; position: number; key: string; definition: string; created_at: string; updated_at: string | null }
const toApi = (r: FieldRow) => ({ ...r, definition: JSON.parse(r.definition) as FieldDef });
const ORDER = "ORDER BY project_id, position, key";

function parseDefinition(v: unknown): FieldDef {
  const err = validateFieldDef(v);
  if (err) throw new HttpError(400, err);
  const s = JSON.stringify(v);
  if (s.length > 256 * 1024) throw new HttpError(413, "definition too large");
  return v as FieldDef;
}

/** The fields a project uses, in its order (for validating shot `extra`). */
export async function projectFieldDefs(env: Ctx["env"], projectId: string): Promise<FieldDef[]> {
  const { results } = await env.DB.prepare("SELECT definition FROM field_definitions WHERE project_id = ?1 AND deleted_at IS NULL ORDER BY position, key")
    .bind(projectId).all<{ definition: string }>();
  return results.map((r) => JSON.parse(r.definition) as FieldDef);
}


async function upsert(env: Ctx["env"], id: string, projectId: string, def: FieldDef): Promise<void> {
  const clash = await env.DB.prepare("SELECT id FROM field_definitions WHERE project_id = ?1 AND key = ?2 AND id != ?3 AND deleted_at IS NULL").bind(projectId, def.key, id).first<{ id: string }>();
  if (clash) throw new HttpError(409, `another field of this project already uses the key "${def.key}"`);
  await env.DB.prepare(
    `INSERT INTO field_definitions (id, project_id, key, definition, updated_at, position)
       VALUES (?1, ?2, ?3, ?4, ?5, (SELECT coalesce(max(position) + 1, 0) FROM field_definitions WHERE project_id = ?2 AND deleted_at IS NULL))
     ON CONFLICT(id) DO UPDATE SET key = ?3, definition = ?4, updated_at = ?5`,
  ).bind(id, projectId, def.key, JSON.stringify(def), new Date().toISOString()).run();
}

/** Extra-field definitions, each owned by one project (issue #44): CRUD, bulk JSON import (e.g. written by an AI), order. */
export function registerFieldRoutes(r: Router<Ctx>) {
  // The fields of every project in the caller's workspaces (each carries project_id and position), or one project's with ?project_id=.
  r.on("GET", "/api/fields", async ({ env, url, tenant }) => {
    const project = url.searchParams.get("project_id");
    const mine = `project_id IN (SELECT id FROM projects WHERE ${inWorkspaces("workspace_id", 1)})`;
    const stmt = project
      ? env.DB.prepare(`SELECT * FROM field_definitions WHERE ${mine} AND project_id = ?2 AND deleted_at IS NULL ${ORDER}`).bind(tenant.wsList, assertUuid(project, "project_id"))
      : env.DB.prepare(`SELECT * FROM field_definitions WHERE ${mine} AND deleted_at IS NULL ${ORDER}`).bind(tenant.wsList);
    const { results } = await stmt.all<FieldRow>();
    return json({ fields: results.map(toApi) });
  });

  /** JSON { project_id (required to create; a field never changes project), definition }. New fields go last. */
  r.on("PUT", "/api/fields/:id", async (ctx, { id }) => {
    const { env, request } = ctx;
    const fid = assertUuid(id, "id");
    const b = await readJson<Record<string, unknown>>(request);
    const def = parseDefinition(b.definition);
    await accessIfExists(ctx, "field", fid, "editor");
    const stored = await env.DB.prepare("SELECT project_id FROM field_definitions WHERE id = ?1").bind(fid).first<{ project_id: string }>();
    const projectId = stored?.project_id ?? assertUuid(b.project_id, "project_id");
    if (!stored) await assertProjectRef(ctx, projectId);
    await upsert(env, fid, projectId, def);
    const row = await env.DB.prepare("SELECT * FROM field_definitions WHERE id = ?1").bind(fid).first<FieldRow>();
    return json({ field: toApi(row!) });
  });

  /**
   * JSON { project_id, fields: FieldDef[] }: creates new keys in the project and replaces the definition
   * of its existing keys. All definitions are validated before anything is written.
   */
  r.on("POST", "/api/fields/import", async (ctx) => {
    const { env, request } = ctx;
    const b = await readJson<Record<string, unknown>>(request);
    const projectId = assertUuid(b.project_id, "project_id");
    await assertProjectRef(ctx, projectId);
    const list = Array.isArray(b.fields) ? b.fields : null;
    if (!list || list.length === 0) throw new HttpError(400, "fields must be a non-empty array");
    if (list.length > 200) throw new HttpError(413, "at most 200 fields per import");
    const defs = list.map((d, i) => { try { return parseDefinition(d); } catch (e) { throw new HttpError(400, `fields[${i}]: ${(e as Error).message}`); } });
    const keys = new Set<string>();
    for (const d of defs) { if (keys.has(d.key)) throw new HttpError(400, `duplicate key "${d.key}" in the import`); keys.add(d.key); }
    const existing = new Map((await env.DB.prepare("SELECT id, key FROM field_definitions WHERE project_id = ?1 AND deleted_at IS NULL").bind(projectId).all<{ id: string; key: string }>()).results.map((x) => [x.key, x.id]));
    let created = 0, updated = 0;
    for (const d of defs) {
      const id = existing.get(d.key);
      if (id) updated++; else created++;
      await upsert(env, id ?? crypto.randomUUID(), projectId, d);
    }
    const { results } = await env.DB.prepare(`SELECT * FROM field_definitions WHERE project_id = ?1 AND deleted_at IS NULL ${ORDER}`).bind(projectId).all<FieldRow>();
    return json({ fields: results.map(toApi), created, updated });
  });

  // Moves the field to the recycle bin. Shots keep their stored values; they just stop being shown/validated.
  r.on("DELETE", "/api/fields/:id", async (ctx, { id }) => {
    const rid = assertUuid(id, "id");
    await assertAccess(ctx, "field", rid, "editor");
    return json(await binResource(ctx.env, "field", rid));
  });

  /** JSON { field_ids: [...] }: the project's fields in display order (every one of them, nothing else). */
  r.on("PUT", "/api/projects/:id/fields", async (ctx, { id }) => {
    const { env, request } = ctx;
    const pid = assertUuid(id, "id");
    const b = await readJson<Record<string, unknown>>(request);
    if (!Array.isArray(b.field_ids)) throw new HttpError(400, "field_ids must be an array");
    const ids = b.field_ids.map((x, i) => assertUuid(x, `field_ids[${i}]`));
    await assertAccess(ctx, "project", pid, "editor");
    const own = new Set((await env.DB.prepare("SELECT id FROM field_definitions WHERE project_id = ?1 AND deleted_at IS NULL").bind(pid).all<{ id: string }>()).results.map((x) => x.id));
    if (ids.length !== own.size || new Set(ids).size !== ids.length || ids.some((x) => !own.has(x))) throw new HttpError(400, "field_ids must list exactly the project's fields");
    await env.DB.batch(ids.map((fid, i) => env.DB.prepare("UPDATE field_definitions SET position = ?1 WHERE id = ?2").bind(i, fid)));
    return json({ project_id: pid, field_ids: ids });
  });
}
