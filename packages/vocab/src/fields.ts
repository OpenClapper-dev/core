/**
 * User-defined "extra" fields. A definition is a small JSON tree (easy to have an AI write):
 *
 *   { "key": "ubahn", "label": "U-Bahn", "type": "group", "fields": [
 *       { "key": "line", "label": "Line", "type": "select", "options": ["U1", "U2", "U4"] },
 *       { "key": "station", "label": "Station", "type": "select",
 *         "optionsBy": { "field": "line", "options": { "U4": ["Nollendorfplatz", "Bayerischer Platz"] } } } ] }
 *
 * Types: text, number, boolean, select (options, or optionsBy = options depending on a sibling
 * field's value; `multiple` allows several), group (nested `fields`). A shot stores its values in
 * `extra` under each top-level key; a group's value is an object keyed by its child keys.
 * Definitions are global; each project picks the ones it uses.
 */
import type { Extra, ExtraValue } from "./vocab.ts";

export type FieldType = "text" | "number" | "boolean" | "select" | "group";
export const FIELD_TYPES: readonly FieldType[] = ["text", "number", "boolean", "select", "group"];

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  help?: string;
  /** select: fixed options. */
  options?: string[];
  /** select: options that depend on the value of a sibling field (same group). */
  optionsBy?: { field: string; options: Record<string, string[]> };
  /** select: allow several values (stored as an array). */
  multiple?: boolean;
  /** group: child fields. */
  fields?: FieldDef[];
}

/** A stored definition (one top-level field, possibly a group). */
export interface FieldDefinition { id: string; key: string; definition: FieldDef; created_at: string; updated_at: string | null }

const KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;
const MAX_DEPTH = 4;
const MAX_OPTIONS = 2000;

/** Structural check of a definition tree. Returns an error message (with a path) or null. */
export function validateFieldDef(v: unknown, path = "", depth = 0): string | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return `${path || "field"} must be an object`;
  const f = v as Record<string, unknown>;
  const here = path ? `${path}.${String(f.key)}` : String(f.key);
  if (typeof f.key !== "string" || !KEY_RE.test(f.key)) return `${path || "field"}: key must be lowercase letters, digits or _ (start with a letter, max 40)`;
  if (typeof f.label !== "string" || !f.label.trim() || f.label.length > 80) return `${here}: label must be a non-empty string (max 80)`;
  if (!FIELD_TYPES.includes(f.type as FieldType)) return `${here}: type must be one of ${FIELD_TYPES.join(", ")}`;
  if (f.help !== undefined && (typeof f.help !== "string" || f.help.length > 300)) return `${here}: help must be a string (max 300)`;
  const strings = (x: unknown) => Array.isArray(x) && x.every((s) => typeof s === "string" && s.trim() !== "" && s.length <= 120);
  if (f.type === "select") {
    const hasOptions = f.options !== undefined, hasBy = f.optionsBy !== undefined;
    if (hasOptions === hasBy) return `${here}: a select needs exactly one of options or optionsBy`;
    if (hasOptions && (!strings(f.options) || (f.options as string[]).length === 0 || (f.options as string[]).length > MAX_OPTIONS)) return `${here}: options must be a non-empty list of strings`;
    if (hasBy) {
      const by = f.optionsBy as Record<string, unknown>;
      if (typeof by !== "object" || by === null || typeof by.field !== "string" || typeof by.options !== "object" || by.options === null) return `${here}: optionsBy must be { field, options: { value: [..] } }`;
      for (const list of Object.values(by.options as Record<string, unknown>)) if (!strings(list)) return `${here}: every optionsBy list must be strings`;
    }
    if (f.multiple !== undefined && typeof f.multiple !== "boolean") return `${here}: multiple must be true or false`;
  } else if (f.options !== undefined || f.optionsBy !== undefined || f.multiple !== undefined) {
    return `${here}: options, optionsBy and multiple only apply to selects`;
  }
  if (f.type === "group") {
    if (depth >= MAX_DEPTH) return `${here}: nested too deep (max ${MAX_DEPTH} levels)`;
    if (!Array.isArray(f.fields) || f.fields.length === 0) return `${here}: a group needs a non-empty fields list`;
    const keys = new Set<string>();
    for (const c of f.fields) {
      const err = validateFieldDef(c, here, depth + 1);
      if (err) return err;
      const k = (c as FieldDef).key;
      if (keys.has(k)) return `${here}: duplicate key ${k}`;
      keys.add(k);
    }
    for (const c of f.fields as FieldDef[]) {
      if (c.optionsBy && !keys.has(c.optionsBy.field)) return `${here}.${c.key}: optionsBy.field "${c.optionsBy.field}" is not a sibling field`;
    }
  } else if (f.fields !== undefined) {
    return `${here}: only groups have fields`;
  }
  return null;
}

/** Options of a select given the values of its siblings (for optionsBy). */
export function selectOptions(f: FieldDef, siblings: Record<string, ExtraValue> | null | undefined): string[] {
  if (f.options) return f.options;
  if (!f.optionsBy) return [];
  const parent = siblings?.[f.optionsBy.field];
  return typeof parent === "string" ? f.optionsBy.options[parent] ?? [] : [];
}

/** Every option a select can ever have (for filters). */
export const allSelectOptions = (f: FieldDef): string[] =>
  f.options ?? [...new Set(Object.values(f.optionsBy?.options ?? {}).flat())];

const isEmpty = (v: ExtraValue | undefined) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

function validateValue(f: FieldDef, v: ExtraValue, siblings: Record<string, ExtraValue>, path: string): string | null {
  if (isEmpty(v)) return null;
  switch (f.type) {
    case "text": return typeof v === "string" && v.length <= 2000 ? null : `${path} must be text`;
    case "number": return typeof v === "number" && Number.isFinite(v) ? null : `${path} must be a number`;
    case "boolean": return typeof v === "boolean" ? null : `${path} must be true or false`;
    case "select": {
      const opts = selectOptions(f, siblings);
      const vals = f.multiple ? v : [v];
      if (!Array.isArray(vals) || vals.some((x) => typeof x !== "string" || !opts.includes(x))) return `${path}: not one of the allowed options`;
      return null;
    }
    case "group": {
      if (typeof v !== "object" || v === null || Array.isArray(v)) return `${path} must be an object`;
      return validateValues(f.fields ?? [], v, path);
    }
  }
}

/**
 * Validates `extra` against the fields a project uses: known keys only, values of the right type.
 * `only` limits the check to those top-level keys (a bulk edit must not fail on values it leaves alone).
 */
export function validateValues(defs: readonly FieldDef[], extra: Record<string, ExtraValue>, path = "extra", only?: readonly string[]): string | null {
  for (const [k, v] of Object.entries(extra)) {
    if (only && !only.includes(k)) continue;
    const f = defs.find((d) => d.key === k);
    if (!f) return `${path}.${k}: no such field in this project`;
    const err = validateValue(f, v, extra, `${path}.${k}`);
    if (err) return err;
  }
  return null;
}

/** Drops empty values and empty groups so stored JSON stays small and "is empty" filters work. */
export function pruneExtra(extra: Record<string, ExtraValue>): Extra {
  const out: Extra = {};
  for (const [k, v] of Object.entries(extra)) {
    if (isEmpty(v)) continue;
    if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      const inner = pruneExtra(v);
      if (Object.keys(inner).length) out[k] = inner;
    } else out[k] = v;
  }
  return out;
}

const isObject = (v: ExtraValue | undefined): v is Extra => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Applies a bulk edit to one shot's `extra`: each key in `patch` replaces that key, an empty value
 * removes it, other keys stay. A group merges the same way, child by child, so editing one child
 * keeps its siblings. Like the editor, a changed parent drops a dependent select whose value its
 * new options no longer offer.
 */
export function patchExtra(defs: readonly FieldDef[], extra: Extra, patch: Record<string, ExtraValue>): Extra {
  const next: Extra = { ...extra };
  for (const [k, v] of Object.entries(patch)) {
    const d = defs.find((x) => x.key === k);
    next[k] = d?.type === "group" && isObject(v) ? patchExtra(d.fields ?? [], isObject(extra[k]) ? extra[k] : {}, v) : v;
  }
  for (const d of defs) {
    if (!d.optionsBy || !(d.optionsBy.field in patch) || d.key in patch || isEmpty(next[d.key])) continue;
    const opts = selectOptions(d, next);
    const v = next[d.key];
    if ((Array.isArray(v) ? v : [v]).some((x) => typeof x !== "string" || !opts.includes(x))) delete next[d.key];
  }
  return pruneExtra(next);
}

/** "U-Bahn: Line U4 · Station Nollendorfplatz"; unknown keys (field deleted) fall back to the raw key. */
export function extraSummary(defs: readonly FieldDef[], extra: Extra | null | undefined): string {
  if (!extra) return "";
  const parts: string[] = [];
  const walk = (fields: readonly FieldDef[], values: Extra, prefix: string) => {
    for (const [k, v] of Object.entries(values)) {
      if (isEmpty(v)) continue;
      const f = fields.find((d) => d.key === k);
      const name = f?.label ?? k;
      if (typeof v === "object" && v !== null && !Array.isArray(v)) walk(f?.fields ?? [], v, prefix ? `${prefix} › ${name}` : name);
      else {
        const shown = typeof v === "boolean" ? (v ? "yes" : "no") : Array.isArray(v) ? v.join(", ") : String(v);
        parts.push(`${prefix ? `${prefix} › ` : ""}${name}: ${shown}`);
      }
    }
  };
  walk(defs, extra, "");
  return parts.join(" · ");
}

/** Leaf fields with their dotted path below `extra` (for the filter builder). */
export function leafFields(defs: readonly FieldDef[], prefix = ""): { path: string; label: string; def: FieldDef }[] {
  return defs.flatMap((f) => f.type === "group"
    ? leafFields(f.fields ?? [], `${prefix}${f.key}.`).map((x) => ({ ...x, label: `${f.label} › ${x.label}` }))
    : [{ path: `${prefix}${f.key}`, label: f.label, def: f }]);
}

/** Text for the "copy prompt for AI" button: explains the format so a model can write definitions. */
export const FIELD_PROMPT = `Write field definitions for a film location-scouting app as a JSON array. Each element is one field:
{ "key": "snake_case_id", "label": "Shown name", "type": "text" | "number" | "boolean" | "select" | "group", "help"?: "short hint" }
- select: add "options": ["A", "B"] (fixed list) OR "optionsBy": { "field": "<sibling key>", "options": { "<sibling value>": ["..."] } } for options that depend on another field in the same group. Add "multiple": true to allow several values.
- group: add "fields": [ ...child fields ] (max 4 levels deep). Child keys must be unique inside the group.
- keys: lowercase letters, digits and _, starting with a letter, max 40 characters.
Return only the JSON array. Example:
[{ "key": "ubahn", "label": "U-Bahn", "type": "group", "fields": [
  { "key": "line", "label": "Line", "type": "select", "options": ["U1", "U4"] },
  { "key": "station", "label": "Station", "type": "select", "optionsBy": { "field": "line", "options": { "U1": ["Kurfürstendamm"], "U4": ["Nollendorfplatz", "Bayerischer Platz"] } } } ] }]`;

/**
 * Values as they fit another project's fields (a shot moving there): top-level keys it does not define,
 * or whose value its definition rejects, are dropped. The client lists `droppedKeys` before the move.
 */
export function fitExtra(defs: readonly FieldDef[], extra: Extra): Extra {
  const out: Extra = {};
  for (const [k, v] of Object.entries(extra)) if (defs.some((d) => d.key === k) && !validateValues(defs, extra, "extra", [k])) out[k] = v;
  return out;
}

/** Top-level keys `fitExtra` would drop. */
export const droppedKeys = (defs: readonly FieldDef[], extra: Extra): string[] => {
  const kept = fitExtra(defs, extra);
  return Object.keys(extra).filter((k) => !(k in kept));
};
