import { emptyFilter, evaluateFilter, filterField, isGroup, label, OP_LABELS, type FilterField, type FilterGroup, type FilterRule } from "@openclapper/vocab";
import type { Location, Preset, Project, Shot, ShotState, Spot } from "./api";
import { cover, filterable, placeLabel, rigLabel, shotTitle } from "./format";

export type StateFilter = ShotState | "all";
export type Sort = "newest" | "oldest" | "name";
export type Layout = "grid" | "list" | "map";

/** What the Shots page shows: the rule filter (saved with a view), the state switch, a quick search and the order. */
export interface ShotsQuery { filter: FilterGroup; state: StateFilter; search: string; sort: Sort }
export const emptyQuery = (): ShotsQuery => ({ filter: emptyFilter(), state: "all", search: "", sort: "newest" });

export interface RefLists { projects: Project[]; locations: Location[]; spots: Spot[]; presets: Preset[]; extra: readonly FilterField[] }

const stateRule = (s: ShotState): FilterRule => ({ field: "state", op: "is", value: s });
const isStateRule = (r: FilterRule | FilterGroup): r is FilterRule => !isGroup(r) && r.field === "state" && r.op === "is" && typeof r.value === "string";

/** A saved view holds the state switch as a leading "state is …" rule, so it restores both. */
export function encodeView(q: Pick<ShotsQuery, "filter" | "state">): FilterGroup {
  if (q.state === "all") return q.filter;
  if (q.filter.match === "all") return { match: "all", rules: [stateRule(q.state), ...q.filter.rules] };
  return { match: "all", rules: [stateRule(q.state), q.filter] };
}

export function decodeView(f: FilterGroup): Pick<ShotsQuery, "filter" | "state"> {
  const first = f.rules[0];
  if (f.match !== "all" || !first || !isStateRule(first)) return { filter: f, state: "all" };
  const rest = f.rules.slice(1);
  const only = rest.length === 1 ? rest[0] : null;
  return { state: first.value as ShotState, filter: only && isGroup(only) && only.match === "any" ? only : { match: "all", rules: rest } };
}

const norm = (s: string) => s.trim().toLowerCase();
const matchesSearch = (s: Shot, q: string) => !q || [shotTitle(s), placeLabel(s), rigLabel(cover(s)), s.project_name ?? ""].some((t) => norm(t).includes(q));

export interface QueryResult {
  /** After filter, search and state, in the chosen order. */
  shots: Shot[];
  /** Per state, within filter + search: the state switch counts inside the filter. */
  counts: Record<StateFilter, number>;
  /** After filter + search, before the state switch. */
  matched: number;
}

export function runQuery(all: Shot[], q: ShotsQuery, extra: readonly FilterField[]): QueryResult {
  const search = norm(q.search);
  const matched = all.filter((s) => matchesSearch(s, search) && evaluateFilter(q.filter, filterable(s), extra));
  const counts: Record<StateFilter, number> = { all: matched.length, unreviewed: 0, approved: 0, archived: 0 };
  for (const s of matched) counts[s.state]++;
  const shots = matched.filter((s) => q.state === "all" || s.state === q.state);
  const cmp: Record<Sort, (a: Shot, b: Shot) => number> = {
    newest: (a, b) => b.captured_at.localeCompare(a.captured_at),
    oldest: (a, b) => a.captured_at.localeCompare(b.captured_at),
    name: (a, b) => shotTitle(a).localeCompare(shotTitle(b), undefined, { sensitivity: "base" }),
  };
  shots.sort(cmp[q.sort]);
  return { shots, counts, matched: matched.length };
}

/** Options for a ref/enum field (ids → names for refs). */
export function fieldOptions(fieldId: string, ctx: RefLists): { value: string; label: string }[] {
  const f = filterField(fieldId, ctx.extra);
  if (!f) return [];
  if (f.kind === "ref") return (f.ref === "location" ? ctx.locations : f.ref === "spot" ? ctx.spots.map((sp) => ({ ...sp, name: `${ctx.locations.find((l) => l.id === sp.location_id)?.name ?? "?"} · ${sp.name}` })) : ctx.presets).map((x) => ({ value: x.id, label: x.name }));
  return (f.options ?? []).map((v) => ({ value: v, label: f.id.startsWith("extra.") ? v : label(v) }));
}

/** Short text for a rule's value, e.g. "Dusk, Night" or "4 places". */
export function ruleValueText(r: FilterRule, ctx: RefLists): string {
  const f = filterField(r.field, ctx.extra);
  if (r.op === "empty" || r.op === "not_empty") return OP_LABELS[r.op];
  const opts = fieldOptions(r.field, ctx);
  const name = (v: unknown) => opts.find((o) => o.value === String(v))?.label ?? String(v);
  if (Array.isArray(r.value)) {
    if (r.op === "between") return `${r.value[0]}–${r.value[1]}${f?.kind === "number" && f.id.endsWith("mm") ? " mm" : ""}`;
    if (r.value.length > 2) return `${r.value.length} ${f?.ref === "location" ? "places" : "values"}`;
    return r.value.map(name).join(", ");
  }
  const v = r.value == null || r.value === "" ? "—" : name(r.value);
  const op = r.op === "is" || r.op === "in" || r.op === "contains" ? "" : `${OP_LABELS[r.op]} `;
  return `${op}${v}`;
}

export interface Pill { index: number; text: string; bold: string; any: boolean }

/** Top-level rules as removable pills under the toolbar. */
export function filterPills(g: FilterGroup, ctx: RefLists): Pill[] {
  return g.rules.map((r, index) => {
    if (isGroup(r)) return { index, text: r.match === "any" ? "Any of" : "All of", bold: `${r.rules.length} rule${r.rules.length === 1 ? "" : "s"}`, any: r.match === "any" };
    const f = filterField(r.field, ctx.extra);
    const flat = f?.kind === "enum" && (r.op === "is" || r.op === "in") && (f.id === "int_ext");
    return { index, text: flat ? "" : f?.label ?? r.field, bold: ruleValueText(r, ctx), any: false };
  });
}

/** Number of rules at any depth. */
export const ruleCount = (g: FilterGroup): number => g.rules.reduce((n, r) => n + (isGroup(r) ? ruleCount(r) : 1), 0);
