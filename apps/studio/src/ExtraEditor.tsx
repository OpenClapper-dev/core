import { selectOptions, type Extra, type ExtraValue, type FieldDef } from "@openclapper/vocab";
import { Chip, Combobox } from "@openclapper/ui";

interface Props {
  defs: readonly FieldDef[];
  value: Extra;
  onChange: (v: Extra) => void;
  /** Leave out the top-level labels (the caller shows them, e.g. bulk edit). */
  bare?: boolean;
}

/** Form for a project's extra fields; groups nest, dependent selects follow their sibling. */
export function ExtraEditor({ defs, value, onChange, bare }: Props) {
  return (
    <div class="extra-editor">
      {defs.map((f) => (
        <Field key={f.key} def={f} value={value[f.key]} siblings={value} bare={bare}
          onChange={(v) => {
            const next: Extra = { ...value, [f.key]: v };
            // A changed parent invalidates dependent selects that no longer offer their value.
            for (const d of defs) if (d.optionsBy?.field === f.key && !selectOptions(d, next).includes(String(next[d.key] ?? ""))) delete next[d.key];
            onChange(next);
          }} />
      ))}
    </div>
  );
}

function Field({ def, value, siblings, onChange, bare }: { def: FieldDef; value: ExtraValue | undefined; siblings: Extra; onChange: (v: ExtraValue) => void; bare?: boolean }) {
  const help = def.help ? <span class="meta"> · {def.help}</span> : null;
  const title = bare ? null : <>{def.label}{help}</>;
  switch (def.type) {
    case "group":
      return (
        <fieldset class="extra-group">
          {!bare && <legend>{def.label}{help}</legend>}
          <ExtraEditor defs={def.fields ?? []} value={value && typeof value === "object" && !Array.isArray(value) ? value : {}} onChange={onChange} />
        </fieldset>
      );
    case "text":
      return <label>{title}<input aria-label={bare ? def.label : undefined} value={typeof value === "string" ? value : ""} onInput={(e) => onChange((e.target as HTMLInputElement).value)} /></label>;
    case "number":
      return (
        <label>{title}
          <input type="number" aria-label={bare ? def.label : undefined} value={typeof value === "number" ? value : ""} onInput={(e) => { const t = (e.target as HTMLInputElement).value; onChange(t === "" ? null : Number(t)); }} />
        </label>
      );
    case "boolean":
      return (
        <div class="field">
          {title && <span class="field-label">{title}</span>}
          <div class="f-chips">
            {([true, false] as const).map((b) => <Chip key={String(b)} selected={value === b} onClick={() => onChange(value === b ? null : b)}>{b ? "Yes" : "No"}</Chip>)}
          </div>
        </div>
      );
    case "select": {
      const opts = selectOptions(def, siblings);
      const waiting = def.optionsBy && opts.length === 0;
      if (def.multiple) {
        const sel = Array.isArray(value) ? value.map(String) : [];
        return (
          <div class="field">
            {title && <span class="field-label">{title}</span>}
            {waiting ? <span class="meta">Choose {def.optionsBy!.field} first</span> : (
              <div class="f-chips">
                {opts.map((o) => <Chip key={o} selected={sel.includes(o)} onClick={() => onChange(sel.includes(o) ? sel.filter((x) => x !== o) : [...sel, o])}>{o}</Chip>)}
              </div>
            )}
          </div>
        );
      }
      return (
        <label>{title}
          {waiting ? <span class="meta">Choose {def.optionsBy!.field} first</span>
            : <Combobox options={opts.map((o) => ({ value: o, label: o }))} value={typeof value === "string" ? value : null} onChange={(v) => onChange(v)} placeholder="—" />}
        </label>
      );
    }
  }
}
