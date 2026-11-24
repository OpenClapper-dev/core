// Property values in the Studio's properties panel (docs/features/properties.md): one control per field
// type, for one file or several ticked at once (bulk edit), saved as soon as a value is committed. The
// shared rules check every value; the server checks again.
import { useEffect, useState } from "preact/hooks";
import { AppIcon, Button, Combobox, colorCss, DropdownMenu, Icon, NumberInput, PropertyRow, PropertySection, Select, TextArea, TextInput } from "@openclapper/design";
import { allowedOptions, isEmptyValue, shownOn, valueError, type PropertyDef } from "@openclapper/model";
import type { FileRec } from "./api";
import { kindOf } from "./fileKinds";
import { toastError } from "./hosts";
import { setValues, type Definition } from "./props";

const MIXED = Symbol("mixed");
type Shown = unknown | typeof MIXED;

/** The value of a property across files: the one value, nothing, or "mixed". */
function common(files: readonly FileRec[], id: string): Shown {
  const vals = files.map((f) => JSON.stringify(f.values?.[id] ?? null));
  return new Set(vals).size === 1 ? files[0].values?.[id] ?? null : MIXED;
}

/** Parses "lat, lng", or a map link with "@lat,lng" or "q=lat,lng" in it. */
export function parsePosition(text: string): { lat: number; lng: number } | null {
  const m = /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/.exec(text) ?? /[?&](?:q|ll|query)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/.exec(text) ?? /^\s*(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(text);
  if (!m) return null;
  const lat = Number(m[1]), lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

/** A text field that commits on Enter or when it is left, and goes back with Escape. */
function CommitText({ value, placeholder, multiline, invalid, onCommit }: { value: string; placeholder?: string; multiline?: boolean; invalid?: (v: string) => boolean; onCommit: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const done = () => { if (v !== value && !(invalid && v.trim() && invalid(v))) onCommit(v); else if (invalid && v.trim() && invalid(v)) setV(value); };
  return multiline
    ? <TextArea rows={3} value={v} placeholder={placeholder} onInput={(e) => setV(e.currentTarget.value)} onBlur={done} />
    : <TextInput size="sm" value={v} placeholder={placeholder} invalid={!!(invalid && v.trim() && invalid(v))} onInput={(e) => setV(e.currentTarget.value)} onBlur={done}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setV(value); e.currentTarget.blur(); } }} />;
}

function Editor({ def, value, parent, files, onChange }: { def: PropertyDef; value: Shown; parent: unknown; files: readonly FileRec[]; onChange: (v: unknown) => void }) {
  const mixed = value === MIXED;
  const v = mixed ? null : value;
  const hint = mixed ? "Mixed" : undefined;
  switch (def.field) {
    case "text": return <CommitText value={typeof v === "string" ? v : ""} placeholder={hint ?? "–"} onCommit={(t) => onChange(t.trim() || null)} />;
    case "long": return <CommitText multiline value={typeof v === "string" ? v : ""} placeholder={hint ?? "–"} onCommit={(t) => onChange(t.trim() ? t : null)} />;
    case "number": return <NumberSlot value={typeof v === "number" ? v : null} unit={def.unit} placeholder={hint} onCommit={onChange} />;
    case "date": return <CommitText value={typeof v === "string" ? v : ""} placeholder={hint ?? "YYYY-MM-DD"} invalid={(t) => !!valueError(def, t.trim())} onCommit={(t) => onChange(t.trim() || null)} />;
    case "position": {
      const p = v as { lat: number; lng: number } | null;
      return <CommitText value={p ? `${p.lat}, ${p.lng}` : ""} placeholder={hint ?? "Latitude, longitude or a map link"} invalid={(t) => !parsePosition(t)} onCommit={(t) => onChange(t.trim() ? parsePosition(t) : null)} />;
    }
    case "yesno": return <Select size="sm" value={v === true ? "yes" : v === false ? "no" : ""} onChange={(x) => onChange(x === "" ? null : x === "yes")} options={[{ value: "", label: hint ?? "–" }, { value: "yes", label: "Yes" }, { value: "no", label: "No" }]} />;
    case "choice": {
      const opts = allowedOptions(def, parent);
      if (def.dependsOn && !opts.length) return <span className="st-note">Choose the property it depends on first</span>;
      return <Select size="sm" value={typeof v === "string" ? v : ""} onChange={(x) => onChange(x || null)} options={[{ value: "", label: hint ?? "–" }, ...opts.map((o) => ({ value: o.id, label: o.label }))]} />;
    }
    case "multi": {
      const list = Array.isArray(v) ? (v as string[]) : [];
      const opts = allowedOptions(def, parent);
      return (
        <span className="st-tags">
          {mixed && <span className="st-note">Mixed</span>}
          {list.map((id) => { const o = def.options?.find((x) => x.id === id); return o ? <button type="button" key={id} className="st-tag" title={`Remove ${o.label}`} onClick={() => onChange(list.filter((x) => x !== id))}><i style={{ background: colorCss(o.color) }} />{o.label}<Icon name="close" size={12} /></button> : null; })}
          <DropdownMenu size="sm" variant="quiet" icon="plus" label={list.length ? undefined : "Add"} items={opts.map((o) => ({ id: o.id, label: o.label, checked: list.includes(o.id) }))}
            onSelect={(id) => onChange(list.includes(id) ? list.filter((x) => x !== id) : [...list, id])} />
        </span>
      );
    }
    case "reference": {
      const list = Array.isArray(v) ? (v as string[]) : [];
      const byId = new Map(files.map((f) => [f.id, f]));
      const targets = def.targets ?? [];
      const candidates = files.filter((f) => !f.internal_of && !f.fixed && !list.includes(f.id) && (targets.length ? targets.includes(f.type) : !["property", "naming", "preferences"].includes(f.type)));
      return (
        <span className="st-tags">
          {mixed && <span className="st-note">Mixed</span>}
          {list.map((id) => { const f = byId.get(id); const k = f ? kindOf(f.type) : null; return (
            <button type="button" key={id} className="st-tag" title="Remove" onClick={() => onChange(list.filter((x) => x !== id))}>{k && <AppIcon glyph={k.glyph} color={k.color} size={16} />}{f?.name ?? "Missing file"}<Icon name="close" size={12} /></button>
          ); })}
          {(def.many || !list.length) && (
            <Combobox size="sm" value="" placeholder={candidates.length ? `Pick ${targets.length === 1 ? `a ${kindOf(targets[0]).label.toLowerCase()}` : "a file"}` : `No ${targets.length === 1 ? kindOf(targets[0]).plural.toLowerCase() : "files"} yet`}
              disabled={!candidates.length} options={candidates.map((f) => ({ value: f.id, label: f.name }))} onChange={(id) => { if (id) onChange(def.many ? [...list, id] : [id]); }} />
          )}
        </span>
      );
    }
  }
}

function NumberSlot({ value, unit, placeholder, onCommit }: { value: number | null; unit?: string; placeholder?: string; onCommit: (v: number | null) => void }) {
  const [v, setV] = useState<number | null>(value);
  useEffect(() => setV(value), [value]);
  return (
    <span className="st-inline">
      <NumberInput size="sm" value={v} unit={unit} placeholder={placeholder ?? "–"} style={{ width: 130 }} onChange={setV} onBlur={() => { if (v !== value) onCommit(v); }} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
      {value !== null && <Button size="sm" variant="quiet" icon="close" label="Clear" onClick={() => onCommit(null)} />}
    </span>
  );
}

/**
 * The project's properties of the given files, in their sections: those shown on every one of their
 * types. One file, or several (bulk edit: a value set here goes to all; differing values show "Mixed").
 */
export function PropertySections({ projectId, targets, defs, files }: { projectId: string; targets: readonly FileRec[]; defs: readonly Definition[]; files: readonly FileRec[] }) {
  const types = [...new Set(targets.map((f) => f.type))];
  const shown = defs.filter((d) => types.every((t) => shownOn(d.def, t)));
  if (!shown.length) return null;
  const sections = [...new Set(shown.map((d) => d.def.section ?? ""))];
  const ids = targets.map((f) => f.id);
  const set = (d: Definition, v: unknown) => void setValues(projectId, ids, { [d.id]: isEmptyValue(v) ? null : v }).catch(toastError);
  return (
    <>
      {sections.map((s) => (
        <PropertySection key={s || "none"} title={s || (targets.length > 1 ? `Properties · ${targets.length} files` : "Properties")} icon="tag">
          {shown.filter((d) => (d.def.section ?? "") === s).map((d) => {
            const parent = d.def.dependsOn ? common(targets, d.def.dependsOn.property) : undefined;
            return (
              <PropertyRow key={d.id} label={d.name}>
                <Editor def={d.def} value={common(targets, d.id)} parent={parent === MIXED ? undefined : parent} files={files} onChange={(v) => set(d, v)} />
              </PropertyRow>
            );
          })}
        </PropertySection>
      ))}
    </>
  );
}
