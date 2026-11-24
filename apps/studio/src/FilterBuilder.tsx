// The filter builder of the file browser (docs/features/properties.md#filters): a group of rules joined by
// all or any, groups nesting four deep, as the first app's Shots filter had it. Fields are the system
// properties, a photo's facts and the project's properties; each kind brings its operators and value
// controls. What it builds is a filter file's body, evaluated with the shared code.
import { Button, DropdownMenu, NumberInput, Segmented, Select, TextInput } from "@openclapper/design";
import { isGroup, OP_LABELS, OPS_BY_KIND, propertyField, SYSTEM_FIELDS, type FilterField, type FilterGroup, type FilterOp, type FilterRule } from "@openclapper/model";
import type { FileRec } from "./api";
import { kindOf } from "./fileKinds";
import type { Definition } from "./props";

const needsValue = (op: FilterOp) => op !== "empty" && op !== "not_empty";
const isList = (op: FilterOp) => op === "in" || op === "not_in";
const isPair = (op: FilterOp) => op === "between";

/** Every field a rule can test in this project, with the options of the kinds that have them. */
export function filterFields(defs: readonly Definition[], files: readonly FileRec[]): FilterField[] {
  const types = [...new Set(files.filter((f) => !f.fixed && !["property", "naming"].includes(f.type)).map((f) => f.type))];
  const holders = files.filter((f) => kindOf(f.type).holds && !f.fixed);
  return [
    ...SYSTEM_FIELDS.map((f) => (f.id === "type" ? { ...f, options: types.map((t) => ({ id: t, label: kindOf(t).label })) } : f.id === "container" ? { ...f, options: holders.map((h) => ({ id: h.id, label: h.name })) } : f)),
    ...defs.map((d) => {
      const field = propertyField(d.id, d.name, d.def);
      if (d.def.field !== "reference") return field;
      const targets = d.def.targets ?? [];
      return { ...field, options: files.filter((f) => !f.fixed && !f.internal_of && (targets.length ? targets.includes(f.type) : true)).map((f) => ({ id: f.id, label: f.name })) };
    }),
  ];
}

export function FilterBuilder({ group, fields, onChange }: { group: FilterGroup; fields: FilterField[]; onChange: (g: FilterGroup) => void }) {
  return <GroupEditor group={group} fields={fields} onChange={onChange} />;
}

function GroupEditor({ group, fields, onChange, onRemove, depth = 0 }: { group: FilterGroup; fields: FilterField[]; onChange: (g: FilterGroup) => void; onRemove?: () => void; depth?: number }) {
  const first = (): FilterRule => ({ field: "name", op: "contains", value: "" });
  const setRule = (i: number, r: FilterRule | FilterGroup) => onChange({ ...group, rules: group.rules.map((x, j) => (j === i ? r : x)) });
  const removeRule = (i: number) => onChange({ ...group, rules: group.rules.filter((_, j) => j !== i) });
  return (
    <div className={`st-fgroup${depth ? " st-fgroup--inner" : ""}`}>
      <div className="st-fgroup__head">
        <span>Match</span>
        <Segmented label="Match" value={group.match} onChange={(m) => onChange({ ...group, match: m as "all" | "any" })} options={[{ value: "all", label: "all" }, { value: "any", label: "any" }]} />
        <span>{depth === 0 ? "of these rules" : "of"}</span>
        <span style={{ flex: 1 }} />
        {onRemove && <Button size="sm" variant="quiet" icon="close" label="Remove group" onClick={onRemove} />}
      </div>
      {group.rules.length === 0 && <span className="st-note">No rules: every file matches.</span>}
      {group.rules.map((r, i) => (isGroup(r)
        ? <GroupEditor key={i} group={r} fields={fields} depth={depth + 1} onChange={(g) => setRule(i, g)} onRemove={() => removeRule(i)} />
        : <RuleRow key={i} rule={r} fields={fields} onChange={(x) => setRule(i, x)} onRemove={() => removeRule(i)} />))}
      <div className="st-fgroup__foot">
        <Button size="sm" variant={depth === 0 ? "secondary" : "quiet"} icon="plus" onClick={() => onChange({ ...group, rules: [...group.rules, first()] })}>Rule</Button>
        {depth < 3 && <Button size="sm" variant="quiet" icon="plus" onClick={() => onChange({ ...group, rules: [...group.rules, { match: group.match === "all" ? "any" : "all", rules: [first()] }] })}>Group</Button>}
      </div>
    </div>
  );
}

function RuleRow({ rule, fields, onChange, onRemove }: { rule: FilterRule; fields: FilterField[]; onChange: (r: FilterRule) => void; onRemove: () => void }) {
  const f = fields.find((x) => x.id === rule.field) ?? { id: rule.field, label: "A deleted property", kind: "presence" as const };
  const ops = OPS_BY_KIND[f.kind];
  const setField = (id: string) => { const nf = fields.find((x) => x.id === id)!; onChange({ field: id, op: OPS_BY_KIND[nf.kind][0], value: undefined }); };
  const setOp = (op: FilterOp) => onChange({ ...rule, op, value: isList(op) ? (Array.isArray(rule.value) ? rule.value : []) : isPair(op) ? ["", ""] : Array.isArray(rule.value) ? undefined : rule.value });
  const pair = Array.isArray(rule.value) && rule.value.length === 2 ? rule.value : ["", ""];
  const options = f.options ?? [];
  let value = null;
  if (needsValue(rule.op)) {
    if ((f.kind === "enum" || f.kind === "set" || f.kind === "ref") && isList(rule.op)) {
      const sel = Array.isArray(rule.value) ? rule.value.map(String) : [];
      value = <DropdownMenu size="sm" variant="secondary" label={sel.length ? sel.map((id) => options.find((o) => o.id === id)?.label ?? "?").join(", ") : "Choose…"} items={options.map((o) => ({ id: o.id, label: o.label, checked: sel.includes(o.id) }))} onSelect={(id) => onChange({ ...rule, value: sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id] })} />;
    } else if (f.kind === "enum" || f.kind === "ref" || f.kind === "set") {
      value = <Select size="sm" value={typeof rule.value === "string" ? rule.value : ""} onChange={(v) => onChange({ ...rule, value: v })} options={[{ value: "", label: "Choose…" }, ...options.map((o) => ({ value: o.id, label: o.label }))]} />;
    } else if (f.kind === "number") {
      const num = (x: unknown) => (typeof x === "number" ? x : null);
      value = isPair(rule.op)
        ? <span className="st-inline"><NumberInput size="sm" value={num(pair[0])} style={{ width: 90 }} onChange={(n) => onChange({ ...rule, value: [n, pair[1]] })} />–<NumberInput size="sm" value={num(pair[1])} style={{ width: 90 }} onChange={(n) => onChange({ ...rule, value: [pair[0], n] })} /></span>
        : <NumberInput size="sm" value={num(rule.value)} style={{ width: 110 }} onChange={(n) => onChange({ ...rule, value: n })} />;
    } else if (f.kind === "date") {
      value = isPair(rule.op)
        ? <span className="st-inline"><TextInput size="sm" placeholder="YYYY-MM-DD" style={{ width: 120 }} value={String(pair[0] ?? "")} onInput={(e) => onChange({ ...rule, value: [e.currentTarget.value, pair[1]] })} />–<TextInput size="sm" placeholder="YYYY-MM-DD" style={{ width: 120 }} value={String(pair[1] ?? "")} onInput={(e) => onChange({ ...rule, value: [pair[0], e.currentTarget.value] })} /></span>
        : <TextInput size="sm" placeholder="YYYY-MM-DD" style={{ width: 130 }} value={String(rule.value ?? "")} onInput={(e) => onChange({ ...rule, value: e.currentTarget.value })} />;
    } else {
      value = <TextInput size="sm" placeholder="Text" style={{ width: 150 }} value={String(rule.value ?? "")} onInput={(e) => onChange({ ...rule, value: e.currentTarget.value })} />;
    }
  }
  return (
    <div className="st-frule">
      <Select size="sm" value={f.id} onChange={setField} options={fields.map((x) => ({ value: x.id, label: x.label }))} aria-label="Field" />
      <Select size="sm" value={rule.op} onChange={(o) => setOp(o as FilterOp)} options={ops.map((o) => ({ value: o, label: OP_LABELS[o] }))} aria-label="Operator" />
      {value}
      <span style={{ flex: 1 }} />
      <Button size="sm" variant="quiet" icon="close" label="Remove rule" onClick={onRemove} />
    </div>
  );
}

/** How many rules a group holds, nested ones included. */
export const ruleCount = (g: FilterGroup): number => g.rules.reduce((n, r) => n + (isGroup(r) ? ruleCount(r) : 1), 0);
