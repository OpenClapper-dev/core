import { useRef, useState } from "preact/hooks";
import { FILTER_FIELDS, filterField, isGroup, OP_LABELS, OPS_BY_KIND, type FilterGroup, type FilterOp, type FilterRule } from "@fielder/vocab";
import { fieldOptions, type RefLists } from "./shotsQuery";
import { Button, Checkbox, Combobox, cx, ErrorLine, Icon, IconButton, Input, Kbd, MenuItem, Panel, PanelBody, PanelFoot, PanelHead, Seg, Select, useOutsideClick } from "@fielder/ui";

const needsValue = (op: FilterOp) => op !== "empty" && op !== "not_empty";
const isList = (op: FilterOp) => op === "in" || op === "not_in";
const isPair = (op: FilterOp) => op === "between";
const defaultRule = (): FilterRule => ({ field: "state", op: "is", value: "approved" });

/** Filter side panel: nested all/any groups of rules; the result count and Clear all sit in the foot. */
export function FilterPanel({ group, ctx, onChange, onClose, resultLine }: { group: FilterGroup; ctx: RefLists; onChange: (g: FilterGroup) => void; onClose: () => void; resultLine: string }) {
  return (
    <Panel label="Filter">
      <PanelHead title="Filter"><Kbd>F</Kbd><IconButton icon="close" label="Close filter" onClick={onClose} /></PanelHead>
      <PanelBody>
        <GroupEditor group={group} ctx={ctx} onChange={onChange} />
        <p class="meta" style={{ margin: 0 }}>The state switch above counts inside this filter and is saved with the view.</p>
      </PanelBody>
      <PanelFoot><span class="num" style={{ flex: 1, fontWeight: 700 }}>{resultLine}</span><Button kind="ghost" size="sm" disabled={group.rules.length === 0} onClick={() => onChange({ ...group, rules: [] })}>Clear all</Button></PanelFoot>
    </Panel>
  );
}

function GroupEditor({ group, ctx, onChange, onRemove, depth = 0 }: { group: FilterGroup; ctx: RefLists; onChange: (g: FilterGroup) => void; onRemove?: () => void; depth?: number }) {
  const setRule = (i: number, r: FilterRule | FilterGroup) => onChange({ ...group, rules: group.rules.map((x, j) => (j === i ? r : x)) });
  const removeRule = (i: number) => onChange({ ...group, rules: group.rules.filter((_, j) => j !== i) });
  return (
    <div class="f-rgroup">
      <div class="f-rgroup__head">
        Match
        <Seg label="Match" value={group.match} onChange={(m) => onChange({ ...group, match: m })} options={[{ id: "all", label: "all" }, { id: "any", label: "any" }]} />
        {depth === 0 ? "of these rules" : "of"}
        <span class="grow" />
        {onRemove && <IconButton icon="close" label="Remove group" onClick={onRemove} />}
      </div>
      {group.rules.length === 0 && <span class="meta">No rules: every shot matches.</span>}
      {group.rules.map((r, i) => isGroup(r)
        ? <GroupEditor key={i} group={r} ctx={ctx} depth={depth + 1} onChange={(g) => setRule(i, g)} onRemove={() => removeRule(i)} />
        : <RuleRow key={i} rule={r} ctx={ctx} onChange={(x) => setRule(i, x)} onRemove={() => removeRule(i)} />)}
      <div class="f-rgroup__foot">
        <Button kind={depth === 0 ? "secondary" : "ghost"} size="sm" icon="plus" onClick={() => onChange({ ...group, rules: [...group.rules, defaultRule()] })}>Rule</Button>
        {depth < 3 && <Button kind="ghost" size="sm" icon="plus-box-multiple-outline" onClick={() => onChange({ ...group, rules: [...group.rules, { match: group.match === "all" ? "any" : "all", rules: [defaultRule()] }] })}>Group</Button>}
      </div>
    </div>
  );
}

function RuleRow({ rule, ctx, onChange, onRemove }: { rule: FilterRule; ctx: RefLists; onChange: (r: FilterRule) => void; onRemove: () => void }) {
  const f = filterField(rule.field, ctx.extra) ?? FILTER_FIELDS[0];
  const ops = OPS_BY_KIND[f.kind];
  const setField = (id: string) => { const nf = filterField(id, ctx.extra)!; onChange({ field: id, op: OPS_BY_KIND[nf.kind][0], value: undefined }); };
  const setOp = (op: FilterOp) => onChange({ ...rule, op, value: isList(op) ? (Array.isArray(rule.value) ? rule.value : []) : isPair(op) ? ["", ""] : Array.isArray(rule.value) ? undefined : rule.value });
  const opts = fieldOptions(f.id, ctx);
  const pair = Array.isArray(rule.value) && rule.value.length === 2 ? rule.value.map(String) : ["", ""];
  const num = (v: string) => (v.trim() === "" ? "" : Number(v));
  const bad = f.kind === "number" && needsValue(rule.op) && (isPair(rule.op) ? pair.some((x) => x === "" || !Number.isFinite(Number(x))) : typeof rule.value !== "number" || !Number.isFinite(rule.value));

  let value = null;
  if (needsValue(rule.op)) {
    if ((f.kind === "enum" || f.kind === "set" || f.kind === "ref") && isList(rule.op)) {
      const sel = Array.isArray(rule.value) ? rule.value.map(String) : [];
      value = <MultiPick options={opts} value={sel} onChange={(v) => onChange({ ...rule, value: v })} />;
    } else if (f.kind === "enum" || f.kind === "ref") {
      value = <Combobox small options={opts} value={rule.value == null || rule.value === "" ? null : String(rule.value)} onChange={(v) => onChange({ ...rule, value: v ?? "" })} placeholder="Choose" />;
    } else if (f.kind === "text") {
      value = <Input box="label" sm value={String(rule.value ?? "")} onInput={(e) => onChange({ ...rule, value: (e.target as HTMLInputElement).value })} placeholder="Text" />;
    } else if (f.kind === "number") {
      const unit = f.id.endsWith("mm") ? "mm" : undefined;
      value = isPair(rule.op)
        ? <div class="pair"><Input box="label" sm invalid={bad} inputMode="decimal" value={pair[0]} onInput={(e) => onChange({ ...rule, value: [num((e.target as HTMLInputElement).value), num(pair[1])] })} />–<Input box="label" sm invalid={bad} unit={unit} inputMode="decimal" value={pair[1]} onInput={(e) => onChange({ ...rule, value: [num(pair[0]), num((e.target as HTMLInputElement).value)] })} /></div>
        : <Input box="label" sm invalid={bad} unit={unit} inputMode="decimal" value={typeof rule.value === "number" ? String(rule.value) : ""} placeholder="Number" onInput={(e) => { const t = (e.target as HTMLInputElement).value; onChange({ ...rule, value: t.trim() === "" ? undefined : Number(t) }); }} />;
    } else if (f.kind === "date") {
      value = isPair(rule.op)
        ? <div class="pair"><Input box="label" sm type="date" value={pair[0]} onInput={(e) => onChange({ ...rule, value: [(e.target as HTMLInputElement).value, pair[1]] })} />–<Input box="label" sm type="date" value={pair[1]} onInput={(e) => onChange({ ...rule, value: [pair[0], (e.target as HTMLInputElement).value] })} /></div>
        : <Input box="label" sm type="date" value={String(rule.value ?? "")} onInput={(e) => onChange({ ...rule, value: (e.target as HTMLInputElement).value })} />;
    }
  }
  return (
    <div class="f-rule">
      <Select label="Field" value={f.id} onChange={setField}
        options={[...FILTER_FIELDS.map((x) => ({ value: x.id, label: x.label })), ...ctx.extra.map((x) => ({ value: x.id, label: x.label, group: "Extra fields" }))]} />
      <Select label="Operator" value={rule.op} onChange={(v) => setOp(v as FilterOp)} options={ops.map((o) => ({ value: o, label: OP_LABELS[o] }))} />
      <div class="rule-value">{value}</div>
      <IconButton icon="close" label="Remove rule" onClick={onRemove} />
      {bad && <ErrorLine>Enter a number</ErrorLine>}
    </div>
  );
}

/** A compact multi-select: the pick shows a summary, the popover lists the options with checks and a search. */
export function MultiPick({ options, value, onChange, placeholder = "Choose…" }: { options: { value: string; label: string }[]; value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  useOutsideClick(() => box.current, () => setOpen(false), open);
  const names = value.map((v) => options.find((o) => o.value === v)?.label ?? v);
  const summary = names.length === 0 ? placeholder : names.length <= 2 ? names.join(", ") : `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())) : options;
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  return (
    <div ref={box} style={{ position: "relative", minWidth: 0 }} onKeyDown={(e) => { if (e.key === "Escape" && open) { e.stopPropagation(); setOpen(false); } }}>
      <button type="button" class={cx("f-pick", names.length === 0 && "is-empty")} style={{ width: "100%" }} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>{summary}</span><Icon name="chevron-down" />
      </button>
      {open && (
        <div class="f-menu" style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 20, maxHeight: "280px", overflow: "auto" }}>
          {options.length > 8 && <label class="f-input f-input--sm" style={{ margin: "2px 2px 6px" }}><Icon name="magnify" /><input autoFocus value={q} placeholder="Search" onInput={(e) => setQ((e.target as HTMLInputElement).value)} /></label>}
          {shown.map((o) => (
            <MenuItem key={o.value} role="option" aria-selected={value.includes(o.value)} selected={value.includes(o.value)} onClick={() => toggle(o.value)}>
              <Checkbox as="span" checked={value.includes(o.value)} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{o.label}</span>
            </MenuItem>
          ))}
          {shown.length === 0 && <span class="meta" style={{ padding: "6px 10px" }}>No match</span>}
        </div>
      )}
    </div>
  );
}
