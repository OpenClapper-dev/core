/**
 * Properties on the server (docs/rewrite/07-organisation.md; rules in @openclapper/model
 * properties.ts): the values of files, names from naming patterns, search over names and values,
 * and what a changed definition does to the values it has.
 *
 * Values are rows of `property_values`. A reference value also keeps `refs` rows of kind "property"
 * (data: the definition), so "where is this file used" counts it; those rows are rewritten from the
 * values whenever a file's values change.
 */
import { assertUuid, HttpError, json, readJson, type Router } from "@openclapper/service-kit";
import {
  attachedTo, defaultPattern, fileType, filesNamed, fitValue, isEmptyValue, MAX_BULK, patternProblems, renderName, valueError, valueText,
  type PropertyDef,
} from "@openclapper/model";
import { accessFile } from "./files.ts";
import type { Ctx, Env } from "./index.ts";

interface Def { id: string; name: string; def: PropertyDef; deleted: boolean }

/** The definitions of a project, binned ones too (their values are kept, not shown). */
export async function definitions(env: Env, projectId: string): Promise<Def[]> {
  const { results } = await env.DB.prepare("SELECT id, name, body, deleted_at FROM files WHERE project_id = ?1 AND type = 'property' ORDER BY id")
    .bind(projectId).all<{ id: string; name: string; body: string; deleted_at: string | null }>();
  return results.map((r) => ({ id: r.id, name: r.name, def: JSON.parse(r.body) as PropertyDef, deleted: r.deleted_at !== null }));
}

/** The values of these files, by file and definition. */
export async function valuesOf(env: Env, ids: readonly string[]): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < ids.length; i += 500) {
    const { results } = await env.DB.prepare("SELECT file_id, definition_id, value FROM property_values WHERE file_id IN (SELECT value FROM json_each(?1))")
      .bind(JSON.stringify(ids.slice(i, i + 500))).all<{ file_id: string; definition_id: string; value: string }>();
    for (const r of results) out.set(r.file_id, { ...out.get(r.file_id), [r.definition_id]: JSON.parse(r.value) });
  }
  return out;
}

/** Rewrites a file's "property" references from its reference values. */
export const propertyRefs = (env: Env, fileId: string): D1PreparedStatement[] => [
  env.DB.prepare("DELETE FROM refs WHERE from_file = ?1 AND kind = 'property'").bind(fileId),
  env.DB.prepare(
    `INSERT INTO refs (from_file, kind, position, to_file, data)
     SELECT v.file_id, 'property', row_number() OVER (ORDER BY v.definition_id, j.key) - 1, j.value, json_object('property', v.definition_id)
     FROM property_values v JOIN files d ON d.id = v.definition_id JOIN json_each(v.value) j
     WHERE v.file_id = ?1 AND json_extract(d.body, '$.field') = 'reference'`,
  ).bind(fileId),
];

// ---------- Names ----------

/**
 * The name of a new file of a project from its type's naming pattern (04-shots.md, "Names"): the
 * project's pattern file for the type, else the default; a pattern with a problem is not used. The
 * counter is raised in the same statement that reads it.
 */
export async function nextName(env: Env, projectId: string, type: string, facts: { device?: string | null; focal?: number | null } = {}): Promise<string> {
  const t = fileType(type);
  const label = t?.label ?? type;
  const row = await env.DB.prepare("SELECT body FROM files WHERE project_id = ?1 AND type = 'naming' AND deleted_at IS NULL AND json_extract(body, '$.for') = ?2 ORDER BY created_at, id LIMIT 1")
    .bind(projectId, type).first<{ body: string }>();
  let p = defaultPattern(type);
  if (row) { const b = JSON.parse(row.body) as { pattern: string; digits: number }; if (!patternProblems(b.pattern, type).length) p = b; }
  const counter = (await env.DB.prepare("INSERT INTO name_counters (project_id, type, next) VALUES (?1, ?2, 1) ON CONFLICT (project_id, type) DO UPDATE SET next = next + 1 RETURNING next")
    .bind(projectId, type).first<{ next: number }>())!.next;
  return renderName(p.pattern, p.digits, { type, label, counter, at: new Date(), ...facts });
}

// ---------- Search ----------

/** What search looks at for each file: its name and its values as text. */
export async function searchTexts(env: Env, projectId: string | null, files: readonly { id: string; name: string }[]): Promise<Map<string, string[]>> {
  const out = new Map(files.map((f) => [f.id, [f.name]]));
  if (!projectId || !files.length) return out;
  const defs = new Map((await definitions(env, projectId)).filter((d) => !d.deleted).map((d) => [d.id, d.def]));
  const values = await valuesOf(env, files.map((f) => f.id));
  const named = [...new Set([...values.entries()].flatMap(([, v]) => Object.entries(v).flatMap(([d, x]) => (defs.get(d) ? filesNamed(defs.get(d)!, x) : []))))];
  const names = new Map<string, string>();
  for (let i = 0; i < named.length; i += 500) {
    const { results } = await env.DB.prepare("SELECT id, name FROM files WHERE id IN (SELECT value FROM json_each(?1))").bind(JSON.stringify(named.slice(i, i + 500))).all<{ id: string; name: string }>();
    for (const r of results) names.set(r.id, r.name);
  }
  for (const [id, v] of values) for (const [d, x] of Object.entries(v)) { const def = defs.get(d); if (def) out.get(id)?.push(valueText(def, x, (n) => names.get(n))); }
  return out;
}

// ---------- A definition changed ----------

/**
 * After a definition was saved: values that no longer fit it (another field type, an option that is
 * gone, a reference that may hold one file now) are fitted or dropped, and so are the values of
 * choices that depend on it. Options are kept by id, so a renamed one keeps its values.
 */
export async function refitValues(env: Env, projectId: string, defId: string): Promise<void> {
  const defs = await definitions(env, projectId);
  const affected = defs.filter((d) => d.id === defId || d.def.dependsOn?.property === defId);
  const stmts: D1PreparedStatement[] = [];
  const touched = new Set<string>();
  for (const d of affected) {
    const { results } = await env.DB.prepare("SELECT file_id, value FROM property_values WHERE definition_id = ?1").bind(d.id).all<{ file_id: string; value: string }>();
    const parentId = d.def.dependsOn?.property;
    const parents = parentId ? await valuesOf(env, results.map((r) => r.file_id)) : null;
    for (const r of results) {
      const v = JSON.parse(r.value) as unknown;
      const fit = fitValue(d.def, v, parentId ? parents?.get(r.file_id)?.[parentId] : undefined);
      if (JSON.stringify(fit) === r.value) continue;
      touched.add(r.file_id);
      stmts.push(fit === null
        ? env.DB.prepare("DELETE FROM property_values WHERE file_id = ?1 AND definition_id = ?2").bind(r.file_id, d.id)
        : env.DB.prepare("UPDATE property_values SET value = ?3 WHERE file_id = ?1 AND definition_id = ?2").bind(r.file_id, d.id, JSON.stringify(fit)));
    }
  }
  for (const id of touched) stmts.push(...propertyRefs(env, id));
  for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));
}

// ---------- Setting values ----------

type Change = Record<string, unknown>;

function readChange(v: unknown): Change {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new HttpError(400, "values must be an object of property ids to values");
  const out: Change = {};
  for (const [k, x] of Object.entries(v)) out[assertUuid(k, "a property id")] = x;
  if (Object.keys(out).length > 200) throw new HttpError(400, "at most 200 properties at once");
  return out;
}

/**
 * Sets values on files of one project: each property must be live, of this project and attached to
 * the file's type; each value must fit (strictly: an interactive edit). null removes a value. A
 * dependent choice whose parent changed loses a value that no longer fits. A reference must name
 * live files of the project of a type it allows.
 */
async function setValues(ctx: Ctx, ids: string[], change: Change) {
  const { env } = ctx;
  const files = await Promise.all(ids.map((id) => accessFile(ctx, id, "editor")));
  const projectId = files[0].project_id;
  if (!projectId || files.some((f) => f.project_id !== projectId)) throw new HttpError(400, "properties are set on files of one project");
  const binned = files.find((f) => f.deleted_at);
  if (binned) throw new HttpError(409, `"${binned.name}" is in the recycle bin; restore it first`);
  const defs = new Map((await definitions(env, projectId)).filter((d) => !d.deleted).map((d) => [d.id, d]));
  for (const [id, v] of Object.entries(change)) {
    const d = defs.get(id);
    if (!d) throw new HttpError(400, `no property ${id} in this project`);
    for (const f of files) if (!attachedTo(d.def, f.type)) throw new HttpError(400, `"${d.name}" is not a property of ${fileType(f.type)?.plural.toLowerCase() ?? f.type}`);
    if (v !== null && d.def.field === "reference") {
      const named = filesNamed(d.def, v);
      if (named.length) {
        const { results } = await env.DB.prepare("SELECT id, type FROM files WHERE project_id = ?2 AND deleted_at IS NULL AND id IN (SELECT value FROM json_each(?1))").bind(JSON.stringify(named), projectId).all<{ id: string; type: string }>();
        if (results.length !== new Set(named).size) throw new HttpError(400, `"${d.name}": a file it names is not in this project`);
        const targets = d.def.targets ?? [];
        const wrong = targets.length ? results.find((r) => !targets.includes(r.type)) : undefined;
        if (wrong) throw new HttpError(400, `"${d.name}" points at ${targets.join(" or ")} only`);
      }
    }
  }
  const current = await valuesOf(env, ids);
  const stmts: D1PreparedStatement[] = [];
  const at = new Date().toISOString();
  for (const f of files) {
    const now: Record<string, unknown> = { ...current.get(f.id), ...change };
    for (const [id, v] of Object.entries(change)) {
      const d = defs.get(id)!;
      if (v !== null && !isEmptyValue(v)) {
        const parent = d.def.dependsOn ? now[d.def.dependsOn.property] : undefined;
        const wrong = valueError(d.def, v, parent);
        if (wrong) throw new HttpError(400, `"${d.name}": ${wrong}`);
      }
    }
    // Dependent choices whose parent was changed keep only what still fits.
    for (const d of defs.values()) {
      if (!d.def.dependsOn || !(d.def.dependsOn.property in change) || d.id in change) continue;
      if (now[d.id] === undefined) continue;
      const fit = fitValue(d.def, now[d.id], now[d.def.dependsOn.property]);
      if (JSON.stringify(fit) !== JSON.stringify(now[d.id])) now[d.id] = fit;
    }
    for (const [id, v] of Object.entries(now)) {
      if (!(id in change) && v === current.get(f.id)?.[id]) continue;
      stmts.push(v === null || isEmptyValue(v)
        ? env.DB.prepare("DELETE FROM property_values WHERE file_id = ?1 AND definition_id = ?2").bind(f.id, id)
        : env.DB.prepare("INSERT INTO property_values (file_id, definition_id, value) VALUES (?1, ?2, ?3) ON CONFLICT (file_id, definition_id) DO UPDATE SET value = excluded.value").bind(f.id, id, JSON.stringify(v)));
    }
    stmts.push(...propertyRefs(env, f.id), env.DB.prepare("UPDATE files SET updated_at = ?2 WHERE id = ?1").bind(f.id, at));
  }
  await env.DB.batch(stmts);
  const after = await valuesOf(env, ids);
  return Object.fromEntries(ids.map((id) => [id, after.get(id) ?? {}]));
}

export function registerPropertyRoutes(r: Router<Ctx>) {
  /** Values of one file: JSON { values: { <property id>: value | null } } → { values } (all of the file's values after). */
  r.on("PUT", "/api/files/:id/properties", async (ctx, { id }) => {
    const b = await readJson<Record<string, unknown>>(ctx.request);
    const fid = assertUuid(id, "id");
    const out = await setValues(ctx, [fid], readChange(b.values));
    return json({ values: out[fid] });
  });

  /** The same values on many files at once (bulk edit): JSON { ids, values } → { values: { <file id>: values } }. All or none. */
  r.on("POST", "/api/properties/set", async (ctx) => {
    const b = await readJson<Record<string, unknown>>(ctx.request);
    if (!Array.isArray(b.ids) || !b.ids.length || b.ids.length > MAX_BULK) throw new HttpError(400, `ids must be a list of 1 to ${MAX_BULK} file ids`);
    const ids = [...new Set(b.ids.map((x) => assertUuid(x, "ids")))];
    return json({ values: await setValues(ctx, ids, readChange(b.values)) });
  });
}
