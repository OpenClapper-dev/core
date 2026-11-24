/**
 * Filters (docs/rewrite/07-organisation.md, "Finding and bulk editing"): a saved query over the files
 * of a project, itself a file of the type `filter`. A group of rules joined by all or any; groups
 * nest, so "A and (B or C)" can be said. Rules test the system properties, a photo's facts and any
 * property of the catalogue. Evaluated by every client on what it loaded, the same way everywhere.
 */
import { fold, isEmptyValue, type PropertyDef } from "./properties.ts";

export type FilterKind = "text" | "number" | "date" | "enum" | "set" | "ref" | "presence";
export type FilterOp =
  | "is" | "is_not" | "in" | "not_in"
  | "contains" | "not_contains"
  | "eq" | "lt" | "gt" | "between"
  | "before" | "after"
  | "empty" | "not_empty";

export interface FilterRule { field: string; op: FilterOp; value?: unknown }
export interface FilterGroup { match: "all" | "any"; rules: (FilterRule | FilterGroup)[] }
export const isGroup = (r: FilterRule | FilterGroup): r is FilterGroup => "rules" in r;

/** What a filter file stores: its rules, optionally narrowed to file types, and a search text. */
export interface FilterBody extends FilterGroup { types?: string[]; q?: string }

export const OPS_BY_KIND: Record<FilterKind, readonly FilterOp[]> = {
  text: ["contains", "not_contains", "is", "is_not", "empty", "not_empty"],
  number: ["eq", "lt", "gt", "between", "empty", "not_empty"],
  date: ["is", "before", "after", "between", "empty", "not_empty"],
  enum: ["is", "is_not", "in", "not_in", "empty", "not_empty"],
  set: ["in", "not_in", "empty", "not_empty"],
  ref: ["in", "not_in", "empty", "not_empty"],
  presence: ["empty", "not_empty"],
};
export const OP_LABELS: Record<FilterOp, string> = {
  is: "is", is_not: "is not", in: "is one of", not_in: "is none of", contains: "contains", not_contains: "does not contain",
  eq: "=", lt: "<", gt: ">", between: "between", before: "before", after: "after", empty: "is empty", not_empty: "is set",
};

/** A field a rule can test. Property fields are "p:<definition id>". */
export interface FilterField { id: string; label: string; kind: FilterKind; options?: { id: string; label: string }[] }
export const SYSTEM_FIELDS: readonly FilterField[] = [
  { id: "name", label: "Name", kind: "text" },
  { id: "type", label: "Type", kind: "enum" },
  { id: "created", label: "Created", kind: "date" },
  { id: "updated", label: "Changed", kind: "date" },
  { id: "container", label: "Folder or collection", kind: "ref" },
  { id: "taken", label: "Taken (photos)", kind: "date" },
  { id: "aov", label: "Angle of view, horizontal (photos)", kind: "number" },
];

const KIND: Record<PropertyDef["field"], FilterKind> = { text: "text", long: "text", number: "number", yesno: "enum", choice: "enum", multi: "set", date: "date", reference: "ref", position: "presence" };
export function propertyField(id: string, name: string, def: PropertyDef): FilterField {
  const kind = KIND[def.field];
  const options = def.field === "yesno" ? [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }] : def.options?.map((o) => ({ id: o.id, label: o.label }));
  return { id: `p:${id}`, label: name, kind, ...(options ? { options } : {}) };
}

/** What the evaluator reads of a file; both clients map their file records to this. */
export interface Filterable {
  name: string; type: string; created_at: string; updated_at: string; container: string | null;
  taken?: string | null; aov?: number | null;
  values: Readonly<Record<string, unknown>>;
}

function fieldValue(f: Filterable, id: string): unknown {
  switch (id) {
    case "name": return f.name;
    case "type": return f.type;
    case "created": return f.created_at.slice(0, 10);
    case "updated": return f.updated_at.slice(0, 10);
    case "container": return f.container ? [f.container] : [];
    case "taken": return f.taken ? f.taken.slice(0, 10) : null;
    case "aov": return f.aov ?? null;
  }
  if (!id.startsWith("p:")) return null;
  const v = f.values[id.slice(2)];
  return typeof v === "boolean" ? (v ? "yes" : "no") : v ?? null;
}

const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);

export function evaluateRule(r: FilterRule, f: Filterable): boolean {
  const v = fieldValue(f, r.field);
  const blank = isEmptyValue(v);
  switch (r.op) {
    case "empty": return blank;
    case "not_empty": return !blank;
  }
  if (blank) return r.op === "is_not" || r.op === "not_in" || r.op === "not_contains";
  switch (r.op) {
    case "is": return typeof v === "string" && typeof r.value === "string" ? fold(v) === fold(r.value) : v === r.value;
    case "is_not": return typeof v === "string" && typeof r.value === "string" ? fold(v) !== fold(r.value) : v !== r.value;
    case "contains": return typeof v === "string" && typeof r.value === "string" && fold(v).includes(fold(r.value));
    case "not_contains": return !(typeof v === "string" && typeof r.value === "string" && fold(v).includes(fold(r.value)));
    case "in": { const want = asList(r.value); return asList(v).some((x) => want.includes(x)); }
    case "not_in": { const want = asList(r.value); return !asList(v).some((x) => want.includes(x)); }
    case "eq": return typeof v === "number" && v === Number(r.value);
    case "lt": return typeof v === "number" && v < Number(r.value);
    case "gt": return typeof v === "number" && v > Number(r.value);
    case "before": return typeof v === "string" && typeof r.value === "string" && v < r.value;
    case "after": return typeof v === "string" && typeof r.value === "string" && v > r.value;
    case "between": {
      const [a, b] = asList(r.value);
      if (typeof v === "number") return v >= Number(a) && v <= Number(b);
      return typeof v === "string" && typeof a === "string" && typeof b === "string" && v >= a && v <= b;
    }
  }
  return false;
}

/** Whether a file matches a group. An empty group matches everything. */
export function evaluate(g: FilterGroup, f: Filterable): boolean {
  if (!g.rules.length) return true;
  const test = (r: FilterRule | FilterGroup) => (isGroup(r) ? evaluate(r, f) : evaluateRule(r, f));
  return g.match === "all" ? g.rules.every(test) : g.rules.some(test);
}

const OPS = new Set(Object.values(OPS_BY_KIND).flat());
const FIELD_ID = /^(name|type|created|updated|container|taken|aov|p:[0-9a-f-]{36})$/i;
const MAX_RULES = 100;

/** Null when a filter's body is well formed, else what is wrong (it does not check that the properties it names exist: a deleted one just matches as empty). */
export function filterError(body: Record<string, unknown>): string | null {
  for (const k of Object.keys(body)) if (!["match", "rules", "types", "q"].includes(k)) return `a filter has no "${k}"`;
  if (body.types !== undefined && !(Array.isArray(body.types) && body.types.length <= 40 && body.types.every((t) => typeof t === "string" && /^[a-z][a-z0-9-]{0,39}$/.test(t)))) return "types is a list of file types";
  if (body.q !== undefined && (typeof body.q !== "string" || body.q.length > 200)) return "q is a text of at most 200 characters";
  let count = 0;
  const group = (g: unknown, depth: number): string | null => {
    if (typeof g !== "object" || g === null || Array.isArray(g)) return "a group is an object";
    const x = g as Record<string, unknown>;
    if (x.match !== "all" && x.match !== "any") return "match is all or any";
    if (!Array.isArray(x.rules)) return "rules is a list";
    if (depth > 4) return "groups nest at most 4 deep";
    for (const r of x.rules) {
      if (++count > MAX_RULES) return `at most ${MAX_RULES} rules`;
      if (typeof r === "object" && r !== null && "rules" in r) { const e = group(r, depth + 1); if (e) return e; continue; }
      const rule = r as Record<string, unknown>;
      if (typeof rule.field !== "string" || !FIELD_ID.test(rule.field)) return "a rule names a field";
      if (typeof rule.op !== "string" || !OPS.has(rule.op as FilterOp)) return "a rule has an operator";
      if (rule.value !== undefined && JSON.stringify(rule.value).length > 2000) return "a rule's value is too large";
    }
    return null;
  };
  return group({ match: body.match, rules: body.rules }, 1);
}
