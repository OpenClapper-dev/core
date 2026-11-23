// UX workshop U1: the Project app. Where a project's properties, naming patterns and extensions are set
// (docs/rewrite/07-organisation.md, 04-shots.md, 08-extensions.md). A prototype on fake data: changes stay in this page.
import { useState } from "preact/hooks";
import {
  AppIcon, Badge, Banner, BrowserLayout, Button, Checkbox, Combobox, FormField, Icon, ResizablePanel, Select, SidebarNav, StatusBar, Switch, TextInput, Toolbar, ToolbarSpacer, cx,
} from "@openclapper/design";
import { PROPS, TYPES, type FieldType, type FileType } from "./data";
import { ColourButton, FIELD, FILE_TYPES, OnIcons, type Def } from "./catalogue";
import AiEdit from "./AiEdit";
import AiNames from "./AiNames";
import { PATTERNS, PatternInput, TOKENS, check, nameFor } from "./naming";

/** Read-only properties every file has, and the facts each file type brings. Listed so the catalogue shows the whole picture. */
const SYSTEM = ["Name", "Type", "Created", "Updated", "Created by"];
const FACTS: Partial<Record<FileType, string[]>> = { photo: ["Size", "Taken", "Angle of view", "Lens", "Device", "Frame on screen", "EXIF"], canvas: ["Surface", "Frames", "Layers"], timeline: ["Clips", "Length"], preset: ["Format", "Lenses", "Delivery"], collection: ["Photos", "Colour"] };

type Section = "general" | "properties" | "names" | "extensions";
export default function ProjectApp({ say }: { say: (m: string) => void }) {
  const [section, setSection] = useState<Section>("properties");
  const [defs, setDefs] = useState<Def[]>(PROPS);
  const [open, setOpen] = useState<string | null>("status");
  const [scope, setScope] = useState("all");
  const [ai, setAi] = useState(false);
  const [aiNames, setAiNames] = useState(false);
  const [patterns, setPatterns] = useState(PATTERNS);
  const [ext, setExt] = useState({ hardware: true, flows: false });
  const [name, setName] = useState("Nachtzug");
  const [editing, setEditing] = useState<FileType>("photo");
  /** Put a token into the pattern that was last edited, at the caret. */
  const insert = (token: string) => {
    const el = document.querySelector<HTMLInputElement>(`input[data-pattern="${editing}"]`), at = el?.selectionStart ?? patterns[editing].pattern.length, end = el?.selectionEnd ?? at;
    const p = patterns[editing].pattern, text = `{${token}}`;
    setPatterns({ ...patterns, [editing]: { ...patterns[editing], pattern: p.slice(0, at) + text + p.slice(end) } });
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(at + text.length, at + text.length); });
  };

  const def = defs.find((d) => d.id === open) ?? null;
  const patch = (id: string, change: Partial<Def>) => setDefs(defs.map((d) => (d.id === id ? { ...d, ...change } : d)));
  const shown = defs.filter((d) => scope === "all" || d.on.includes(scope as FileType));
  const sections = [...new Set(shown.map((d) => d.section ?? "No section"))];
  const properties = (
    <div className="u1p-split">
      <div className="u1p-list">
        <div className="u1p-listhead">
          <Select size="sm" value={scope} onChange={setScope} options={[{ value: "all", label: "All file types" }, ...FILE_TYPES.map((t) => ({ value: t, label: `On ${TYPES[t].plural.toLowerCase()}` }))]} />
          <span style={{ flex: 1 }} />
          <Button size="sm" icon="bulb" onClick={() => setAi(true)}>Edit with AI…</Button>
          <Button size="sm" variant="primary" icon="plus" onClick={() => { const id = `new${Date.now()}`; setDefs([...defs, { id, name: "New property", type: "text", on: scope === "all" ? ["shot"] : [scope as FileType] }]); setOpen(id); }}>New property</Button>
        </div>
        {scope !== "all" && (
          <section className="u1p-group">
            <h3><Icon name="lock" size={12} /> Always there</h3>
            <p className="u1p-fixed">{SYSTEM.map((n) => <span key={n}>{n}</span>)}</p>
            {FACTS[scope as FileType] && <><h3><Icon name="lock" size={12} /> Facts of a {TYPES[scope as FileType].label.toLowerCase()} · read-only, can be hidden</h3><p className="u1p-fixed">{FACTS[scope as FileType]!.map((n) => <span key={n}>{n}</span>)}</p></>}
          </section>
        )}
        {sections.map((s) => (
          <section key={s} className="u1p-group">
            <h3>{s}</h3>
            {shown.filter((d) => (d.section ?? "No section") === s).map((d) => (
              <button type="button" key={d.id} className={cx("u1p-row", open === d.id && "is-current")} onClick={() => setOpen(d.id)}>
                <Icon name={FIELD[d.type].icon} />
                <span className="u1p-row__name">{d.name}</span>
                <span className="u1p-row__type">{FIELD[d.type].label}{d.type === "reference" && ` → ${TYPES[d.target!].label}`}{d.options && ` · ${d.options.length}`}</span>
                <OnIcons on={d.on} hidden={d.hidden} />
              </button>
            ))}
          </section>
        ))}
        <section className="u1p-group"><h3><Icon name="extension" size={12} /> Provided by apps and extensions</h3><p className="u1p-empty">None yet. An extension that calculates with a property brings it here, with a fixed meaning.</p></section>
      </div>

      <ResizablePanel side="right" defaultSize={360} min={300} max={560} className="u1p-editpanel" aria-label="Property"><div className="u1p-edit">
        {!def ? <p className="u1p-empty">Choose a property to edit it.</p> : (
          <>
            <FormField label="Name"><TextInput value={def.name} onInput={(e) => patch(def.id, { name: (e.target as HTMLInputElement).value })} /></FormField>
            <FormField label="Field type" hint={def.type === "reference" ? "Points at files; search, filters and the board work with it." : undefined}>
              <Select value={def.type} onChange={(v) => patch(def.id, { type: v as FieldType, options: v === "choice" || v === "multi" ? def.options ?? [{ value: "Option 1", color: 1 }] : undefined })} options={Object.entries(FIELD).map(([k, f]) => ({ value: k, label: f.label }))} />
            </FormField>
            {def.type === "reference" && <FormField label="Points at"><Select value={def.target ?? "set"} onChange={(v) => patch(def.id, { target: v as FileType })} options={(["set", "location", "shot", "photo", "canvas"] as FileType[]).map((t) => ({ value: t, label: TYPES[t].plural }))} /><Checkbox checked={!!def.many} onChange={(c) => patch(def.id, { many: c })}>Several files</Checkbox></FormField>}
            {def.options && (
              <FormField label="Options" hint="A colour each: click the dot for the predefined colours or one of your own. The order here is the order in menus and on the board.">
                <div className="u1p-options">
                  {def.options.map((o, i) => (
                    <div key={i} className="u1p-option">
                      <ColourButton value={o.color} label={`Colour of ${o.value}`} onChange={(c) => patch(def.id, { options: def.options!.map((x, n) => (n === i ? { ...x, color: c } : x)) })} />
                      <TextInput size="sm" value={o.value} onInput={(e) => patch(def.id, { options: def.options!.map((x, n) => (n === i ? { ...x, value: (e.target as HTMLInputElement).value } : x)) })} />
                      <Button size="sm" variant="quiet" icon="close" label="Remove option" onClick={() => patch(def.id, { options: def.options!.filter((_, n) => n !== i) })} />
                    </div>
                  ))}
                  <Button size="sm" variant="quiet" icon="plus" onClick={() => patch(def.id, { options: [...def.options!, { value: `Option ${def.options!.length + 1}`, color: (def.options!.length % 8) + 1 }] })}>Add option</Button>
                </div>
              </FormField>
            )}
            {def.type === "choice" && (
              <FormField label="Depends on" hint="Its options then follow another choice: picking a line limits the stations.">
                <Select value={def.parent ?? ""} onChange={(v) => patch(def.id, { parent: v || undefined })} options={[{ value: "", label: "Nothing" }, ...defs.filter((d) => d.id !== def.id && d.type === "choice" && d.on.some((t) => def.on.includes(t))).map((d) => ({ value: d.id, label: d.name }))]} />
              </FormField>
            )}
            <FormField label="On" hint="The file types that carry it. Hidden keeps the values.">
              <div className="u1p-on">
                {FILE_TYPES.map((t) => { const on = def.on.includes(t), hidden = def.hidden?.includes(t); return (
                  <div key={t} className="u1p-onrow">
                    <Checkbox checked={on} onChange={(c) => patch(def.id, { on: c ? [...def.on, t] : def.on.filter((x) => x !== t) })}><AppIcon glyph={TYPES[t].glyph} color={TYPES[t].color} size={20} /> {TYPES[t].plural}</Checkbox>
                    {on && <Button size="sm" variant="quiet" icon={hidden ? "eye-off" : "eye"} selected={hidden} label={hidden ? "Hidden: show again" : "Hide here"} onClick={() => patch(def.id, { hidden: hidden ? def.hidden!.filter((x) => x !== t) : [...(def.hidden ?? []), t] })} />}
                  </div>
                ); })}
              </div>
            </FormField>
            <FormField label="Section" hint="A heading in the properties list; visual only. Pick one that exists, or type a new name.">
              <Combobox value={def.section ?? ""} placeholder="No section" options={[{ value: "", label: "No section" }, ...[...new Set(defs.map((d) => d.section).filter((x): x is string => !!x))].map((x) => ({ value: x, label: x }))]} onChange={(v) => patch(def.id, { section: v || undefined })} onCreate={(v) => patch(def.id, { section: v })} />
            </FormField>
            <div className="u1p-foot"><Button variant="danger" icon="trash" onClick={() => { setDefs(defs.filter((d) => d.id !== def.id)); setOpen(null); say(`“${def.name}” moved to the bin with its values; restoring it brings both back`); }}>Delete</Button></div>
          </>
        )}
      </div></ResizablePanel>
    </div>
  );

  const names = (
    <div className="u1p-page u1p-page--wide">
      <p className="u1p-lead">Every new file gets a name from its type's pattern. Names can be changed afterwards and need not be unique.</p>
      <div className="u1p-tokens">Tokens, click one to put it into the pattern you are editing: {TOKENS.map((t) => <button type="button" key={t} className="u1p-token" onMouseDown={(e) => e.preventDefault()} onClick={() => insert(t)}>{`{${t}}`}</button>)}<span>· device and focal only on photos</span><span style={{ flex: 1 }} /><Button size="sm" icon="bulb" onClick={() => setAiNames(true)}>Edit with AI…</Button></div>
      <div className="u1p-names">
        <div className="u1p-names__head"><span>File type</span><span>Pattern</span><span>Digits</span><span>Next file is named</span></div>
        {(Object.keys(patterns) as FileType[]).map((t) => {
          const problems = check(t, patterns[t].pattern);
          return (
            <div key={t} className="u1p-names__row">
              <span className="u1p-names__type"><AppIcon glyph={TYPES[t].glyph} color={TYPES[t].color} size={20} />{TYPES[t].label}</span>
              <PatternInput value={patterns[t].pattern} type={t} label={`Pattern for ${TYPES[t].plural.toLowerCase()}`} onFocus={() => setEditing(t)} onChange={(v) => setPatterns({ ...patterns, [t]: { ...patterns[t], pattern: v } })} />
              <Select size="sm" value={String(patterns[t].digits)} onChange={(v) => setPatterns({ ...patterns, [t]: { ...patterns[t], digits: Number(v) } })} options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }))} />
              {problems.length ? <span className="u1p-names__off"><Icon name="warning" size={12} /> Not in use until the pattern is fixed</span> : <strong>{nameFor(t, patterns[t])}</strong>}
              {problems.map((m) => <p key={m} className="u1p-names__problem">{m}</p>)}
            </div>
          );
        })}
      </div>
    </div>
  );

  const extensions = (
    <div className="u1p-page">
      <p className="u1p-lead">Extensions are switched on per project. Everyone in the project then sees their apps, file types and properties. Switching one off deletes nothing: its files stay and show as “needs the extension”.</p>
      {([["hardware", "Hardware", "antenna", "Lights, batteries, cameras and video transmitters from the supported catalogue: pairing, control from the Studio through the phone, live picture.", "Adds device types and their controls to Devices."], ["flows", "Flows", "timeline", "Timed programmes that drive the controls of devices.", "Adds the file type Flow and the Flows app. Needs Hardware."]] as const).map(([id, label, glyph, what, adds]) => (
        <div key={id} className="u1p-ext">
          <AppIcon glyph={glyph} color={id === "hardware" ? 2 : 8} size={36} off={!ext[id]} />
          <div><strong>{label}</strong><p>{what}</p><p className="u1p-ext__adds">{adds}</p></div>
          <Switch checked={ext[id]} disabled={id === "flows" && !ext.hardware} onChange={(c) => { setExt(id === "hardware" && !c ? { hardware: false, flows: false } : { ...ext, [id]: c }); say(c ? `${label} switched on for this project` : `${label} switched off; its files stay`); }} aria-label={label} />
        </div>
      ))}
    </div>
  );

  const general = (
    <div className="u1p-page">
      <FormField label="Project name"><TextInput value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} style={{ maxWidth: 320 }} /></FormField>
      <FormField label="Fixed folders" hint="Made with the project; they cannot be renamed, moved or binned."><div className="u1p-fixed"><span>Desktop</span><span>Settings</span></div></FormField>
      <Banner tone="info">A project is a hard scope: its files are not shared with or moved to another project.</Banner>
    </div>
  );

  const titles: Record<Section, string> = { general: "General", properties: "Properties", names: "Naming patterns", extensions: "Extensions" };
  return (
    <>
      <BrowserLayout className="u1-browser" sidebarWidth={200} sidebarMin={160} sidebarMax={320}
        toolbar={<Toolbar><strong className="u1-title">Project · {titles[section]}</strong><ToolbarSpacer />{section === "properties" && <Badge>{defs.length} properties in this project</Badge>}</Toolbar>}
        sidebar={<SidebarNav value={section} onChange={(id) => setSection(id as Section)} sections={[{ items: [{ id: "general", label: "General", icon: "settings" }, { id: "properties", label: "Properties", icon: "tag", count: defs.length }, { id: "names", label: "Naming patterns", icon: "edit" }, { id: "extensions", label: "Extensions", icon: "extension", count: Number(ext.hardware) + Number(ext.flows) }] }]} />}
        statusBar={<StatusBar>Stored in the project’s Settings folder · changes apply to everyone in the project</StatusBar>}>
        {section === "properties" ? properties : section === "names" ? names : section === "extensions" ? extensions : general}
      </BrowserLayout>
      {aiNames && <AiNames patterns={patterns} say={say} onClose={() => setAiNames(false)} onApply={(next, summary) => { setPatterns(next); setAiNames(false); say(`Naming: ${summary}`); }} />}
      {ai && <AiEdit defs={defs} say={say} onClose={() => setAi(false)} onApply={(next, summary) => { setDefs(next); setAi(false); say(`Properties: ${summary}`); }} />}
    </>
  );
}
