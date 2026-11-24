// The Project app's property catalogue (docs/features/properties.md, UX workshop U1): every property of
// the project in its sections, narrowed by file type, and the editor of the one chosen. Every change is
// saved at once; the server fits the values a property has to a changed definition.
import { useEffect, useState } from "preact/hooks";
import { AppIcon, Button, Checkbox, Combobox, colorCss, FormField, Icon, ResizablePanel, Select, TextInput, cx } from "@openclapper/design";
import { FIELD_TYPES, isChoice, type FieldType, type PropertyDef } from "@openclapper/model";
import type { FileRec } from "../../api";
import { kindOf } from "../../fileKinds";
import { confirm, toast, toastError } from "../../hosts";
import { addTemplate, createDefinition, newOption, PROPERTY_TYPES, saveDefinition, type Definition } from "../../props";
import { bin } from "../../files";
import { ColourButton, FIELD_ICON, fieldLabel, OnIcons } from "./parts";
import { AiEdit } from "./AiEdit";

/** Read-only properties every file has, and the facts a file type brings, so the catalogue shows the whole picture. */
const SYSTEM = ["Name", "Type", "Created", "Changed", "Created by"];
const FACTS: Record<string, string[]> = { photo: ["Size", "Taken", "Angle of view", "Lens", "Device", "EXIF"], collection: ["Photos", "Colour"] };

/** How many files have a value of a property (of one option, when given). */
export function usesOf(files: readonly FileRec[] | null, id: string, option?: string): number {
  let n = 0;
  for (const f of files ?? []) {
    const v = f.values?.[id];
    if (v === undefined) continue;
    if (option === undefined || v === option || (Array.isArray(v) && v.includes(option))) n++;
  }
  return n;
}

export function PropertiesPage({ projectId, files, defs }: { projectId: string; files: FileRec[] | null; defs: Definition[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const [scope, setScope] = useState("all");
  const [ai, setAi] = useState(false);
  const def = defs.find((d) => d.id === open) ?? null;
  const shown = defs.filter((d) => scope === "all" || d.def.attached.some((a) => a.type === scope));
  const sections = [...new Set(shown.map((d) => d.def.section ?? ""))].sort((a, b) => (a === "" ? 1 : b === "" ? -1 : 0));

  const add = async () => {
    try {
      const id = await createDefinition(projectId, files, "New property", { field: "text", attached: [{ type: scope === "all" ? "shot" : scope }] });
      setOpen(id);
    } catch (e) { toastError(e); }
  };

  return (
    <div className="pc-split">
      <div className="pc-list">
        <div className="pc-listhead">
          <Select size="sm" value={scope} onChange={setScope} aria-label="Narrow to a file type" options={[{ value: "all", label: "All file types" }, ...PROPERTY_TYPES.map((t) => ({ value: t, label: `On ${kindOf(t).plural.toLowerCase()}` }))]} />
          <span style={{ flex: 1 }} />
          <Button size="sm" icon="bulb" onClick={() => setAi(true)}>Edit with AI…</Button>
          <Button size="sm" variant="primary" icon="plus" onClick={() => void add()}>New property</Button>
        </div>
        {scope !== "all" && (
          <section className="pc-group">
            <h3><Icon name="lock" size={12} /> Always there</h3>
            <p className="pc-fixed">{SYSTEM.map((n) => <span key={n}>{n}</span>)}</p>
            {FACTS[scope] && <><h3><Icon name="lock" size={12} /> Facts of a {kindOf(scope).label.toLowerCase()} · read-only</h3><p className="pc-fixed">{FACTS[scope].map((n) => <span key={n}>{n}</span>)}</p></>}
          </section>
        )}
        {!defs.length && (
          <section className="pc-group">
            <p className="pc-empty">This project has no properties yet.</p>
            <p><Button size="sm" onClick={() => void addTemplate(projectId, files).catch(toastError)}>Add the default properties</Button></p>
          </section>
        )}
        {sections.map((s) => (
          <section key={s || "none"} className="pc-group">
            <h3>{s || "No section"}</h3>
            {shown.filter((d) => (d.def.section ?? "") === s).map((d) => (
              <button type="button" key={d.id} className={cx("pc-row", open === d.id && "is-current")} onClick={() => setOpen(d.id)}>
                <Icon name={FIELD_ICON[d.def.field]} />
                <span className="pc-row__name">{d.name}</span>
                <span className="pc-row__type">{fieldLabel(d.def.field)}{d.def.field === "reference" && d.def.targets?.length ? ` → ${d.def.targets.map((t) => kindOf(t).label).join(", ")}` : ""}{d.def.options ? ` · ${d.def.options.length}` : ""}{d.def.dependsOn ? " · depends" : ""}</span>
                <OnIcons def={d.def} />
              </button>
            ))}
          </section>
        ))}
        <section className="pc-group"><h3><Icon name="extension" size={12} /> Provided by apps and extensions</h3><p className="pc-empty">None yet. An app or extension that calculates with a property brings it here, with a fixed meaning.</p></section>
      </div>
      <ResizablePanel side="right" defaultSize={380} min={300} max={560} className="pc-editpanel" aria-label="Property">
        <div className="pc-edit">
          {!def ? <p className="pc-empty">Choose a property to edit it.</p> : <Editor key={def.id} d={def} defs={defs} files={files} onGone={() => setOpen(null)} />}
        </div>
      </ResizablePanel>
      {ai && <AiEdit projectId={projectId} files={files} defs={defs} onClose={() => setAi(false)} />}
    </div>
  );
}

function Editor({ d, defs, files, onGone }: { d: Definition; defs: Definition[]; files: FileRec[] | null; onGone: () => void }) {
  const [name, setName] = useState(d.name);
  const [draft, setDraft] = useState<PropertyDef>(d.def);
  useEffect(() => { setDraft(d.def); }, [JSON.stringify(d.def)]);
  useEffect(() => { setName(d.name); }, [d.name]);
  const save = (next: PropertyDef) => { setDraft(next); void saveDefinition(d, { def: next }).catch((e) => { toastError(e); setDraft(d.def); }); };
  const commitName = () => { const n = name.trim(); if (n && n !== d.name) void saveDefinition(d, { name: n }).catch(toastError); else setName(d.name); };
  const used = usesOf(files, d.id);

  const setField = async (f: FieldType) => {
    if (f === draft.field) return;
    if (used && !(await confirm({ title: `Make “${d.name}” a ${fieldLabel(f).toLowerCase()} property?`, message: `${used} file${used === 1 ? " has" : "s have"} a value. Values that do not fit the new type are cleared.`, confirmLabel: "Change", danger: true }))) return;
    const keepOptions = isChoice(f) && isChoice(draft.field);
    const next: PropertyDef = { field: f, attached: draft.attached, order: draft.order, ...(draft.section ? { section: draft.section } : {}) };
    if (isChoice(f)) next.options = keepOptions ? draft.options : [newOption({ ...next, options: [] }, "Option 1")];
    if (keepOptions && f === "choice" && draft.dependsOn) next.dependsOn = draft.dependsOn;
    if (f === "reference") { next.targets = []; next.many = false; }
    save(next);
  };
  const removeOption = async (id: string) => {
    const n = usesOf(files, d.id, id), label = draft.options?.find((o) => o.id === id)?.label;
    if (n && !(await confirm({ title: `Remove “${label}”?`, message: `${n} file${n === 1 ? " uses" : "s use"} it and lose${n === 1 ? "s" : ""} the value.`, confirmLabel: "Remove", danger: true }))) return;
    const map = draft.dependsOn ? Object.fromEntries(Object.entries(draft.dependsOn.map).map(([k, v]) => [k, v.filter((x) => x !== id)])) : null;
    save({ ...draft, options: draft.options!.filter((o) => o.id !== id), ...(map ? { dependsOn: { ...draft.dependsOn!, map } } : {}) });
  };
  const moveOption = (i: number, by: -1 | 1) => { const o = [...draft.options!]; const j = i + by; if (j < 0 || j >= o.length) return; [o[i], o[j]] = [o[j], o[i]]; save({ ...draft, options: o }); };
  const parents = defs.filter((x) => x.id !== d.id && x.def.field === "choice" && x.def.dependsOn?.property !== d.id);
  const parent = draft.dependsOn ? defs.find((x) => x.id === draft.dependsOn!.property) ?? null : null;
  const remove = async () => {
    if (!(await confirm({ title: `Delete “${d.name}”?`, message: used ? `${used} file${used === 1 ? " has" : "s have"} a value. The property goes to the recycle bin with its values; restoring it brings both back.` : "It goes to the recycle bin and can be restored.", confirmLabel: "Delete", danger: true }))) return;
    try { await bin({ project: d.file.project_id! }, [d.id]); onGone(); toast(`“${d.name}” is in the recycle bin`); } catch (e) { toastError(e); }
  };
  const attach = (t: string, on: boolean) => save({ ...draft, attached: on ? [...draft.attached, { type: t }] : draft.attached.filter((a) => a.type !== t) });
  const hide = (t: string) => save({ ...draft, attached: draft.attached.map((a) => (a.type === t ? { ...a, hidden: !a.hidden || undefined } : a)).map((a) => (a.hidden ? a : { type: a.type })) });
  const sections = [...new Set(defs.map((x) => x.def.section).filter((x): x is string => !!x))];

  return (
    <>
      <FormField label="Name"><TextInput value={name} maxLength={120} onInput={(e) => setName(e.currentTarget.value)} onBlur={commitName} onKeyDown={(e) => { if (e.key === "Enter") commitName(); }} /></FormField>
      <FormField label="Field type" hint={draft.field === "reference" ? "Points at files; search, filters and the board work with it." : draft.field === "position" ? "A place as latitude and longitude." : undefined}>
        <Select value={draft.field} onChange={(v) => void setField(v as FieldType)} options={FIELD_TYPES.map((f) => ({ value: f, label: fieldLabel(f) }))} />
      </FormField>
      {draft.field === "number" && (
        <FormField label="Unit" hint="Shown after the number, e.g. mm or m."><TextInput size="sm" value={draft.unit ?? ""} maxLength={12} style={{ width: 120 }} onChange={(e) => { const u = e.currentTarget.value.trim(); save(u ? { ...draft, unit: u } : (({ unit: _u, ...rest }) => rest)(draft)); }} /></FormField>
      )}
      {draft.field === "reference" && (
        <FormField label="Points at" hint="Nothing ticked: any file of the project.">
          <div className="pc-on">
            {PROPERTY_TYPES.map((t) => { const k = kindOf(t); return <Checkbox key={t} checked={!!draft.targets?.includes(t)} onChange={(c) => save({ ...draft, targets: c ? [...(draft.targets ?? []), t] : (draft.targets ?? []).filter((x) => x !== t) })}><AppIcon glyph={k.glyph} color={k.color} size={20} /> {k.plural}</Checkbox>; })}
            <Checkbox checked={!!draft.many} onChange={(c) => save({ ...draft, many: c })}>Several files</Checkbox>
          </div>
        </FormField>
      )}
      {draft.options && (
        <FormField label="Options" hint="A colour each. The order here is the order in menus and on the board. Renaming keeps the values.">
          <div className="pc-options">
            {draft.options.map((o, i) => (
              <div key={o.id} className="pc-option">
                <ColourButton value={o.color} label={`Colour of ${o.label}`} onChange={(c) => save({ ...draft, options: draft.options!.map((x) => (x.id === o.id ? { ...x, color: c } : x)) })} />
                <TextInput size="sm" value={o.label} maxLength={80} aria-label="Option" onChange={(e) => { const l = e.currentTarget.value.trim(); if (l && l !== o.label) save({ ...draft, options: draft.options!.map((x) => (x.id === o.id ? { ...x, label: l } : x)) }); }} />
                <span className="pc-option__acts">
                  <Button size="sm" variant="quiet" icon="arrow-up" label="Earlier" disabled={i === 0} onClick={() => moveOption(i, -1)} />
                  <Button size="sm" variant="quiet" icon="arrow-down" label="Later" disabled={i === draft.options!.length - 1} onClick={() => moveOption(i, 1)} />
                  <Button size="sm" variant="quiet" icon="close" label={`Remove ${o.label}`} disabled={draft.options!.length <= 1} onClick={() => void removeOption(o.id)} />
                </span>
              </div>
            ))}
            <Button size="sm" variant="quiet" icon="plus" onClick={() => save({ ...draft, options: [...draft.options!, newOption(draft, `Option ${draft.options!.length + 1}`)] })}>Add option</Button>
          </div>
        </FormField>
      )}
      {draft.field === "choice" && (
        <FormField label="Depends on" hint="Its options then follow another choice: picking a line limits the stations.">
          <Select value={draft.dependsOn?.property ?? ""} onChange={(v) => save(v ? { ...draft, dependsOn: { property: v, map: Object.fromEntries((defs.find((x) => x.id === v)?.def.options ?? []).map((po) => [po.id, (draft.options ?? []).map((o) => o.id)])) } } : (({ dependsOn: _d, ...rest }) => rest)(draft))}
            options={[{ value: "", label: "Nothing" }, ...parents.map((x) => ({ value: x.id, label: x.name }))]} />
          {parent && draft.dependsOn && (
            <div className="pc-depends">
              {(parent.def.options ?? []).map((po) => (
                <div key={po.id} className="pc-depends__row">
                  <span className="pc-tag"><i style={{ background: colorCss(po.color) }} />{po.label}</span>
                  <span className="pc-depends__opts">
                    {(draft.options ?? []).map((o) => { const on = draft.dependsOn!.map[po.id]?.includes(o.id) ?? false; return (
                      <Checkbox key={o.id} checked={on} onChange={(c) => save({ ...draft, dependsOn: { ...draft.dependsOn!, map: { ...draft.dependsOn!.map, [po.id]: c ? [...(draft.dependsOn!.map[po.id] ?? []), o.id] : (draft.dependsOn!.map[po.id] ?? []).filter((x) => x !== o.id) } } })}>{o.label}</Checkbox>
                    ); })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </FormField>
      )}
      <FormField label="On" hint="The file types that carry it. Hidden keeps the values.">
        <div className="pc-on">
          {PROPERTY_TYPES.map((t) => { const a = draft.attached.find((x) => x.type === t), k = kindOf(t); return (
            <div key={t} className="pc-onrow">
              <Checkbox checked={!!a} onChange={(c) => attach(t, c)}><AppIcon glyph={k.glyph} color={k.color} size={20} /> {k.plural}</Checkbox>
              {a && <Button size="sm" variant="quiet" icon={a.hidden ? "eye-off" : "eye"} selected={!!a.hidden} label={a.hidden ? "Hidden: show again" : "Hide here"} onClick={() => hide(t)} />}
            </div>
          ); })}
        </div>
      </FormField>
      <FormField label="Section" hint="A heading in the properties list; visual only. Pick one that exists, or type a new name.">
        <Combobox value={draft.section ?? ""} placeholder="No section" options={[{ value: "", label: "No section" }, ...sections.map((x) => ({ value: x, label: x }))]}
          onChange={(v) => save(v ? { ...draft, section: v } : (({ section: _s, ...rest }) => rest)(draft))} onCreate={(v) => save({ ...draft, section: v.slice(0, 60) })} />
      </FormField>
      <p className="pc-empty">{used ? `${used} file${used === 1 ? " has" : "s have"} a value.` : "No file has a value yet."}</p>
      <div className="pc-foot"><Button variant="danger" icon="trash" onClick={() => void remove()}>Delete</Button></div>
    </>
  );
}
