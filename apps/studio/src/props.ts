import { defaultPattern, optionId, TEMPLATE, type PropertyDef } from "@openclapper/model";
import * as api from "./api";
import type { FileRec } from "./api";
import { create, fixedFolder, loadRoot, saveBody, useRoot } from "./files";

/**
 * The project's property catalogue and naming patterns in the Studio (docs/features/properties.md):
 * read from the project's files (definitions and patterns are files in Settings, so the file store
 * already has them), and the changes the Project app and the properties panel make.
 */
export interface Definition { id: string; name: string; def: PropertyDef; file: FileRec }

/** File types a property can be attached to, in the order the catalogue offers them. */
export const PROPERTY_TYPES = ["shot", "photo", "collection", "canvas", "set", "location", "timeline", "folder"];
/** File types a naming pattern exists for. */
export const NAMED_TYPES = ["shot", "photo", "collection", "folder", "canvas", "set", "location", "timeline", "filter"];

export const definitionsIn = (files: readonly FileRec[] | null): Definition[] =>
  (files ?? []).filter((f) => f.type === "property" && f.body).map((f) => ({ id: f.id, name: f.name, def: f.body as unknown as PropertyDef, file: f }))
    .sort((a, b) => a.def.order - b.def.order || a.name.localeCompare(b.name));

export function useCatalogue(projectId: string) {
  const root = useRoot({ project: projectId });
  const defs = definitionsIn(root.files);
  const patterns = (root.files ?? []).filter((f) => f.type === "naming" && f.body);
  return { files: root.files, defs, patterns, loaded: root.files !== null };
}

const settingsOf = (files: readonly FileRec[] | null) => fixedFolder(files ?? [], "settings")?.id ?? null;

/** A new definition at the end of the catalogue. */
export async function createDefinition(projectId: string, files: readonly FileRec[] | null, name: string, def: Omit<PropertyDef, "order">, order?: number): Promise<string> {
  const id = crypto.randomUUID();
  const last = definitionsIn(files).reduce((m, d) => Math.max(m, d.def.order), -1);
  await create({ project: projectId }, "property", { id, name, container: settingsOf(files), body: { ...def, order: order ?? last + 1 } });
  return id;
}

/** Saves a definition's name and/or body; the server fits the values it has to a changed body. */
export async function saveDefinition(d: Definition, change: { name?: string; def?: PropertyDef }) {
  try { await api.putFile(d.id, { ...(change.name !== undefined ? { name: change.name } : {}), ...(change.def ? { body: change.def } : {}) }); }
  finally { await loadRoot({ project: d.file.project_id! }); }
}

/** The default properties, for a project made before they existed (or that deleted them all). */
export async function addTemplate(projectId: string, files: readonly FileRec[] | null) {
  const have = new Set(definitionsIn(files).map((d) => d.name.toLowerCase()));
  let order = definitionsIn(files).reduce((m, d) => Math.max(m, d.def.order), -1) + 1;
  for (const t of TEMPLATE) if (!have.has(t.name.toLowerCase())) await api.createFile({ project: projectId }, crypto.randomUUID(), { type: "property", name: t.name, container: settingsOf(files), body: { ...t.def, order: order++ } });
  await loadRoot({ project: projectId });
}

/** A new option for a choice: a free id and the next colour. */
export const newOption = (def: PropertyDef, label: string) => ({ id: optionId(label, (def.options ?? []).map((o) => o.id)), label, color: ((def.options?.length ?? 0) % 8) + 1 });

/** The naming pattern of a type: its file, or the default. */
export function patternOf(patterns: readonly FileRec[], type: string): { file: FileRec | null; pattern: string; digits: number } {
  const f = [...patterns].filter((p) => p.body?.for === type).sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
  return f ? { file: f, pattern: String(f.body!.pattern), digits: Number(f.body!.digits) } : { file: null, ...defaultPattern(type) };
}

/** Saves a type's pattern: changes its file, or makes one in Settings. */
export async function savePattern(projectId: string, files: readonly FileRec[] | null, patterns: readonly FileRec[], type: string, pattern: string, digits: number) {
  const cur = patternOf(patterns, type);
  const body = { for: type, pattern, digits };
  if (cur.file) await saveBody(cur.file, body);
  else await create({ project: projectId }, "naming", { name: `Names of ${type}`, container: settingsOf(files), body });
}

/** Sets property values on one file or many; the store reads the project again. */
export async function setValues(projectId: string, ids: string[], values: Record<string, unknown>) {
  try { if (ids.length === 1) await api.putValues(ids[0], values); else await api.setValuesOn(ids, values); }
  finally { await loadRoot({ project: projectId }); }
}
