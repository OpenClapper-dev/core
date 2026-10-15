import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { FIELD_PROMPT, validateFieldDef, type Extra, type FieldDef } from "@fielder/vocab";
import { deleteField, importFields, putField, putProjectFields, type FieldDefinition, type Project } from "./api";
import { ExtraEditor } from "./ExtraEditor";
import { bind, useKeys } from "./keys";
import { Banner, Button, confirmDialog, cx, Empty, EmptyNote, Icon, ListRow, MenuItem, Panel, PanelBody, PanelHead, Popover, ReorderButtons, SaveStatus, toast, Toolbar, ToolbarSpacer, ToolbarTitle, type SaveState } from "./ui";

/** The active project's fields: definitions belong to one project (issue #44). */
interface Props { project: Project; fields: FieldDefinition[]; onChange: (f: FieldDefinition[]) => void; selectedId: string | null; onSelect: (id: string | null) => void }

const byPosition = (list: FieldDefinition[]) => [...list].sort((a, b) => a.position - b.position || a.key.localeCompare(b.key));

const TEMPLATES: Record<string, { label: string; def: FieldDef }> = {
  text: { label: "Text", def: { key: "notes", label: "Notes", type: "text" } },
  number: { label: "Number", def: { key: "floors", label: "Floors", type: "number" } },
  boolean: { label: "Yes / no", def: { key: "parking", label: "Parking", type: "boolean" } },
  select: { label: "Select", def: { key: "power", label: "Power", type: "select", options: ["Mains", "Generator", "None"] } },
  group: {
    label: "Group with a dependent select",
    def: { key: "ubahn", label: "U-Bahn", type: "group", fields: [
      { key: "line", label: "Line", type: "select", options: ["U1", "U4"] },
      { key: "station", label: "Station", type: "select", optionsBy: { field: "line", options: { U1: ["Kurfürstendamm"], U4: ["Nollendorfplatz", "Bayerischer Platz"] } } },
    ] },
  },
};

const pretty = (v: unknown) => JSON.stringify(v, null, 2);

/** Line (1-based) of a JSON.parse error, from "position N" or "line L column C" in the message. */
function errorLine(text: string, message: string): number | null {
  const lc = /line (\d+)/.exec(message);
  if (lc) return Number(lc[1]);
  const pos = /position (\d+)/.exec(message);
  if (pos) return text.slice(0, Number(pos[1])).split("\n").length;
  return null;
}

/** Library › Fields: the project's fields in order | JSON editor with line numbers and the error line | live preview of the form. */
export function FieldsPage({ project, fields: unsorted, onChange, selectedId, onSelect }: Props) {
  const fields = byPosition(unsorted);
  const [menu, setMenu] = useState(false);
  const [importing, setImporting] = useState(false);
  const [draft, setDraft] = useState<{ id: string; isNew: boolean; text: string } | null>(null);
  const selected = fields.find((f) => f.id === selectedId) ?? null;
  useEffect(() => { if (selected && draft?.id !== selected.id) setDraft({ id: selected.id, isNew: false, text: pretty(selected.definition) }); }, [selected?.id]);
  useEffect(() => { if (!selectedId && !draft && fields[0]) onSelect(fields[0].id); }, [fields.length]);

  const copy = (text: string, what: string) => void navigator.clipboard.writeText(text).then(() => toast(`${what} copied`));
  async function move(i: number, d: number) {
    const list = [...fields];
    const [x] = list.splice(i, 1);
    list.splice(i + d, 0, x);
    const next = list.map((f, position) => ({ ...f, position }));
    onChange(next);
    try { await putProjectFields(project.id, next.map((f) => f.id)); } catch (e) { onChange(fields); toast(`Reordering failed: ${(e as Error).message}`, "danger"); }
  }
  const startNew = (t: FieldDef) => { setMenu(false); setImporting(false); onSelect(null); setDraft({ id: crypto.randomUUID(), isNew: true, text: pretty(t) }); };

  return (
    <>
      <Toolbar>
        <ToolbarTitle count={fields.length}>Extra fields · {project.name}</ToolbarTitle>
        <ToolbarSpacer />
        <div class="menu-anchor">
          <Button size="sm" icon="plus" iconAfter="chevron-down" aria-expanded={menu} onClick={() => setMenu(!menu)}>New field</Button>
          {menu && <Popover right onClose={() => setMenu(false)}><div class="f-menu__label">Start from</div>{Object.entries(TEMPLATES).map(([k, t]) => <MenuItem key={k} onClick={() => startNew(t.def)}>{t.label}</MenuItem>)}</Popover>}
        </div>
        <Button kind="secondary" size="sm" icon="file-import-outline" aria-pressed={importing} onClick={() => setImporting(!importing)}>Import JSON…</Button>
        <Button kind="secondary" size="sm" icon="content-copy" disabled={fields.length === 0} onClick={() => copy(pretty(fields.map((f) => f.definition)), "All definitions")}>Copy all</Button>
        <Button kind="secondary" size="sm" icon="robot-outline" onClick={() => copy(FIELD_PROMPT, "Prompt")}>Copy prompt for AI</Button>
      </Toolbar>
      <div class="f-app__body">
        <Panel left width="260px">
          <PanelBody flush role="listbox" aria-label="Fields">
            {fields.length === 0 && <EmptyNote>No fields in this project yet. Start from a template or import JSON (e.g. written by an AI with the copied prompt). To reuse another project's fields, “Copy all” there and import them here.</EmptyNote>}
            {draft?.isNew && <ListRow as="div" selected title="New field" meta="not saved yet" />}
            {fields.map((f, i) => (
              <ListRow key={f.id} role="option" aria-selected={f.id === selectedId && !importing} selected={f.id === selectedId && !draft?.isNew && !importing} onClick={() => { setImporting(false); onSelect(f.id); }}
                title={f.definition.label}
                meta={<><span class="mono">{f.key}</span> · {f.definition.type}{f.definition.multiple ? " · multiple" : ""}</>}
                trailing={<div class="btn-row" style={{ gap: "2px" }} onClick={(e) => e.stopPropagation()}><ReorderButtons index={i} count={fields.length} onMove={(at, d) => void move(at, d)} /></div>} />
            ))}
          </PanelBody>
        </Panel>
        {importing ? <ImportPane projectId={project.id} onDone={(list) => { onChange(list); setImporting(false); }} onCancel={() => setImporting(false)} />
          : draft ? <Editor key={draft.id} draft={draft} projectId={project.id} fields={fields} onChange={onChange}
            onSaved={(f) => { setDraft({ id: f.id, isNew: false, text: pretty(f.definition) }); onSelect(f.id); }}
            onDeleted={() => { setDraft(null); onSelect(null); }} onCancelNew={() => { setDraft(null); onSelect(fields[0]?.id ?? null); }} />
          : <Empty icon="form-textbox" title="No field selected" />}
      </div>
    </>
  );
}

function Editor({ draft, projectId, fields, onChange, onSaved, onDeleted, onCancelNew }: { draft: { id: string; isNew: boolean; text: string }; projectId: string; fields: FieldDefinition[]; onChange: (f: FieldDefinition[]) => void; onSaved: (f: FieldDefinition) => void; onDeleted: () => void; onCancelNew: () => void }) {
  const [text, setText] = useState(draft.text);
  const [save, setSave] = useState<SaveState>("idle");
  const [preview, setPreview] = useState<Extra>({});
  const [lastValid, setLastValid] = useState<FieldDef | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const parsed = useMemo((): { def: FieldDef | null; err: string | null; line: number | null } => {
    try { const v = JSON.parse(text) as unknown; const err = validateFieldDef(v); return { def: err ? null : (v as FieldDef), err, line: null }; }
    catch (e) { const m = (e as Error).message; return { def: null, err: `JSON: ${m}`, line: errorLine(text, m) }; }
  }, [text]);
  useEffect(() => { if (parsed.def) setLastValid(parsed.def); }, [parsed.def]);
  const dirty = text !== draft.text || draft.isNew;
  const lines = text.split("\n").length;

  async function saveField() {
    if (!parsed.def) return;
    setSave("saving");
    try {
      const saved = await putField(draft.id, projectId, parsed.def);
      onChange([...fields.filter((f) => f.id !== saved.id), saved]);
      setSave("saved");
      onSaved(saved);
    } catch (e) { setSave("error"); toast((e as Error).message, "danger"); }
  }
  async function remove() {
    const def = fields.find((f) => f.id === draft.id);
    if (!def) return;
    const ok = await confirmDialog({ title: `Delete “${def.definition.label}”?`, body: "Values already stored on this project's shots stay in the data but are no longer shown or edited.", confirmLabel: "Delete field", danger: true });
    if (!ok) return;
    try { await deleteField(def.id); onChange(fields.filter((x) => x.id !== def.id)); onDeleted(); toast("Field deleted"); } catch (e) { toast(`Delete failed: ${(e as Error).message}`, "danger"); }
  }
  useKeys(bind("fields", { save: () => void saveField(), leave: () => area.current?.blur() }));

  const title = parsed.def ?? lastValid;
  return (
    <>
      <div class="json-pane">
        <div class="btn-row">
          <strong style={{ flex: 1 }}>{title?.label ?? "Field"} <span class="mono meta">{title?.key}</span></strong>
          <SaveStatus state={parsed.err ? "idle" : dirty ? "dirty" : save} />
          {parsed.err && <span class="f-save f-save--error"><Icon name="alert-circle" />1 error</span>}
        </div>
        <div class={cx("f-json", parsed.err && "is-error")} style={{ flex: 1 }}>
          <div class="f-json__gutter" ref={gutter} aria-hidden="true">{Array.from({ length: lines }, (_, i) => <span key={i} class={parsed.line === i + 1 ? "is-err" : ""}>{i + 1}</span>)}</div>
          <textarea ref={area} class="json-area" spellcheck={false} aria-label="Definition JSON" value={text} rows={lines}
            onInput={(e) => { setText((e.target as HTMLTextAreaElement).value); setSave("idle"); }}
            onKeyDown={(e) => { if (e.key === "Tab") { e.preventDefault(); const t = e.target as HTMLTextAreaElement; const s = t.selectionStart; setText(text.slice(0, s) + "  " + text.slice(t.selectionEnd)); requestAnimationFrame(() => t.setSelectionRange(s + 2, s + 2)); } }} />
        </div>
        {parsed.err && <Banner title={parsed.line ? `Line ${parsed.line}` : "Definition"} meta={parsed.err} metaClass="mono" />}
        <div class="btn-row">
          <Button kbd="⌘S" disabled={!parsed.def || !dirty} onClick={() => void saveField()}>Save field</Button>
          {draft.isNew ? <Button kind="ghost" onClick={onCancelNew}>Cancel</Button> : <Button kind="ghost" disabled={!dirty} onClick={() => setText(draft.text)}>Revert</Button>}
          <span class="grow" />
          {!draft.isNew && <Button kind="danger" size="sm" icon="delete-outline" onClick={() => void remove()}>Delete…</Button>}
        </div>
      </div>
      <Panel width="300px">
        <PanelHead title="Live preview" titleStyle={{ fontSize: "var(--text-body)" }}>{parsed.err && lastValid && <span class="meta">last valid</span>}</PanelHead>
        <PanelBody>{title ? <ExtraEditor defs={[title]} value={preview} onChange={setPreview} /> : <span class="meta">Fix the JSON to see the form.</span>}</PanelBody>
      </Panel>
    </>
  );
}

function ImportPane({ projectId, onDone, onCancel }: { projectId: string; onDone: (f: FieldDefinition[]) => void; onCancel: () => void }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  async function run() {
    try {
      const v = JSON.parse(text) as unknown;
      const r = await importFields(projectId, Array.isArray(v) ? v : [v]);
      onDone(r.fields);
      toast(`Imported: ${r.created} new, ${r.updated} replaced`);
    } catch (e) { setError((e as Error).message); }
  }
  return (
    <div class="json-pane">
      <strong>Import field definitions</strong>
      <span class="meta">A JSON array (or a single field), into this project. Existing keys are replaced, new keys are added. Tip: “Copy prompt for AI”, describe what you need, paste the answer here.</span>
      <textarea class="f-textarea mono" style={{ flex: 1, fontSize: "12.5px" }} spellcheck={false} value={text} placeholder='[{ "key": "…", "label": "…", "type": "text" }]' onInput={(e) => { setText((e.target as HTMLTextAreaElement).value); setError(null); }} />
      {error && <Banner title="Not imported" meta={error} metaClass="mono" />}
      <div class="btn-row"><Button icon="file-import-outline" disabled={!text.trim()} onClick={() => void run()}>Import</Button><Button kind="ghost" onClick={onCancel}>Cancel</Button></div>
    </div>
  );
}
