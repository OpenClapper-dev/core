// The properties of one file as the shot, set and location windows show them: every field type of the project's
// catalogue with its control (docs/rewrite/07-organisation.md), references as chips that open the file, and a position
// set by a pin. The same panel serves a file mounted from another app (a photo's or a canvas's properties).
import { useState } from "preact/hooks";
import { AppIcon, Button, Checkbox, DropdownMenu, Icon, MapPin, NumberInput, Popover, PropertyRow, PropertySection, Select, TextArea, TextInput } from "@openclapper/design";
import { PROPS, TYPES, type FileRec, type PropDef } from "../u1/data";

type Val = string | string[];
/** Fake coordinates for a place on the stand-in map (percent of its width and height). */
export const coords = (pos: [number, number]) => `${(53.56 - pos[1] * 0.0006).toFixed(4)}° N, ${(9.9 + pos[0] * 0.0012).toFixed(4)}° E`;

/** A chip that names a file and opens it. */
export function FileChip({ file, onOpen, onRemove }: { file: FileRec | undefined; onOpen: (id: string) => void; onRemove?: () => void }) {
  if (!file || file.binned) return <span className="u3-chip is-missing"><Icon name="warning" size={12} />{file ? `${file.name} · in the bin` : "Missing"}{onRemove && <button type="button" aria-label="Remove" onClick={onRemove}><Icon name="close" size={10} /></button>}</span>;
  return <span className="u3-chip"><button type="button" className="u3-chip__open" title={`Open “${file.name}”`} onClick={() => onOpen(file.id)}><AppIcon glyph={TYPES[file.type].glyph} color={TYPES[file.type].color} size={20} />{file.name}</button>{onRemove && <button type="button" aria-label={`Remove ${file.name}`} onClick={onRemove}><Icon name="close" size={10} /></button>}</span>;
}

/** A position: placed by clicking the map, moved by clicking again, or taken away. */
function Position({ file, onPos }: { file: FileRec; onPos: (pos: [number, number] | undefined) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen} align="end" trigger={<Button size="sm" variant={file.pos ? "secondary" : "quiet"} icon="pin">{file.pos ? coords(file.pos) : "Set position"}</Button>}>
      <div className="u3-pos">
        <div className="u3-pos__map" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); onPos([Math.round(((e.clientX - r.left) / r.width) * 100), Math.round(((e.clientY - r.top) / r.height) * 100)]); }}>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><rect width="100" height="100" fill="var(--surface-sunken)" /><path d="M0 78 C 20 70, 30 86, 52 74 S 86 60, 100 66 L100 100 L0 100Z" fill="var(--cat-6)" opacity=".28" /><path d="M0 40 L100 30 M30 0 L44 100 M0 62 L60 20 M62 0 L70 70 M10 10 L90 54" stroke="var(--border-control)" stroke-width="1" vector-effect="non-scaling-stroke" fill="none" /></svg>
          {file.pos && <span className="u3-pos__pin" style={{ left: `${file.pos[0]}%`, top: `${file.pos[1]}%` }}><MapPin icon="location" label={file.name} selected /></span>}
        </div>
        <p>{file.pos ? coords(file.pos) : "Click the map to place the pin."}</p>
        <span className="u3-hint">Typing coordinates and looking up the address come with the build.</span>
        <div className="u3-bar"><span style={{ flex: 1 }} />{file.pos && <Button size="sm" variant="quiet" icon="trash" onClick={() => onPos(undefined)}>Remove</Button>}<Button size="sm" variant="primary" onClick={() => setOpen(false)}>Done</Button></div>
      </div>
    </Popover>
  );
}

export function FileProps({ file, files, onProp, onPos, onOpen }: { file: FileRec; files: FileRec[]; onProp: (key: string, value: Val) => void; onPos: (pos: [number, number] | undefined) => void; onOpen: (id: string) => void }) {
  const defs = PROPS.filter((p) => p.on.includes(file.type)), sections = [...new Set(defs.map((p) => p.section ?? "Properties"))];
  const by = (id: string) => files.find((f) => f.id === id);
  const control = (p: PropDef) => {
    const v = file.props[p.id], list = v == null || v === "" ? [] : Array.isArray(v) ? v : [v], one = list[0] ?? "";
    if (p.type === "choice") return <Select size="sm" value={one} onChange={(x) => onProp(p.id, x)} options={[{ value: "", label: "–" }, ...p.options!.map((o) => ({ value: o.value, label: o.value }))]} />;
    if (p.type === "multi") return <DropdownMenu size="sm" label={list.length ? list.join(", ") : "–"} items={p.options!.map((o) => ({ id: o.value, label: o.value, checked: list.includes(o.value) }))} onSelect={(x) => onProp(p.id, list.includes(x) ? list.filter((y) => y !== x) : [...list, x])} />;
    if (p.type === "reference") {
      const targets = files.filter((f) => f.type === p.target && !f.binned && !list.includes(f.id));
      const add = (!list.length || p.many) && <DropdownMenu size="sm" variant="quiet" icon="plus" label={list.length ? undefined : p.many ? `Add ${TYPES[p.target!].plural.toLowerCase()}` : `Pick a ${TYPES[p.target!].label.toLowerCase()}`} items={targets.length ? targets.map((f) => ({ id: f.id, label: f.name, icon: TYPES[f.type].glyph })) : [{ id: "", label: `No other ${TYPES[p.target!].plural.toLowerCase()}`, disabled: true }]} onSelect={(x) => x && onProp(p.id, p.many ? [...list, x] : x)} />;
      return <span className="u3-chips">{list.map((id) => <FileChip key={id} file={by(id)} onOpen={onOpen} onRemove={() => onProp(p.id, p.many ? list.filter((x) => x !== id) : "")} />)}{add}</span>;
    }
    if (p.type === "position") return <Position file={file} onPos={onPos} />;
    if (p.type === "long") return <TextArea rows={3} value={one} onInput={(e) => onProp(p.id, (e.target as HTMLTextAreaElement).value)} />;
    if (p.type === "number") return <NumberInput size="sm" value={one === "" ? null : Number(one)} onChange={(n) => onProp(p.id, String(n))} />;
    if (p.type === "yesno") return <Checkbox checked={one === "yes"} onChange={(c) => onProp(p.id, c ? "yes" : "")}>Yes</Checkbox>;
    return <TextInput size="sm" value={one} icon={p.type === "date" ? "calendar" : undefined} onInput={(e) => onProp(p.id, (e.target as HTMLInputElement).value)} />;
  };
  return (
    <>
      {sections.map((s) => <PropertySection key={s} title={s} icon={s === "Camera" ? "camera" : s === "Script" ? "file-text" : "tag"}>{defs.filter((p) => (p.section ?? "Properties") === s).map((p) => <PropertyRow key={p.id} label={p.name}>{control(p)}</PropertyRow>)}</PropertySection>)}
      {file.facts && <PropertySection title={`${TYPES[file.type].label} facts`} icon="lock" defaultOpen={file.type === "photo"}>{file.facts.map(([k, v]) => <PropertyRow key={k} label={k} value={v} />)}</PropertySection>}
    </>
  );
}
