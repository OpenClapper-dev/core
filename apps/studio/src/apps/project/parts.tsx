// Pieces of the Project app's catalogue and naming pages (UX workshop U1, docs/features/properties.md):
// field-type looks, a property drawn as the input it will be, the file types it is on, and a naming
// pattern with its tokens in boxes.
import { AppIcon, Button, Checkbox, ColorChooser, colorCss, Popover, Select, TextArea, TextInput, cx, type IconName } from "@openclapper/design";
import { FIELD_LABELS, NAME_TOKENS, patternProblems, type Colour, type FieldType, type PropertyDef } from "@openclapper/model";
import { kindOf } from "../../fileKinds";

export const FIELD_ICON: Record<FieldType, IconName> = { text: "note", long: "notes", number: "ruler", yesno: "check", choice: "tag", multi: "tag", date: "calendar", reference: "link", position: "pin" };
export const fieldLabel = (f: FieldType) => FIELD_LABELS[f];

/** The file types a property is on, as their icons; hidden ones dimmed. */
export const OnIcons = ({ def }: { def: Pick<PropertyDef, "attached"> }) => (
  <span className="pc-row__on">{def.attached.map((a) => { const k = kindOf(a.type); return <AppIcon key={a.type} glyph={k.glyph} color={k.color} size={20} label={`${k.plural}${a.hidden ? " (hidden)" : ""}`} off={a.hidden} />; })}</span>
);

/** A colour dot that opens the chooser: the eight colours, none, or one of your own. */
export function ColourButton({ value, onChange, label }: { value: Colour; onChange: (c: Colour) => void; label: string }) {
  return (
    <Popover trigger={<button type="button" className="pc-swatch" style={{ background: colorCss(value) }} aria-label={`${label}: choose a colour`} />}>
      <ColorChooser value={value} onChange={onChange} label={label} />
    </Popover>
  );
}

/** A property as it will appear in the properties panel: its label and the control of its field type, not editable here. */
export function FieldPreview({ name, def }: { name: string; def: PropertyDef }) {
  const target = def.targets?.[0] ? kindOf(def.targets[0]) : null;
  const control =
    def.field === "choice" ? <Select size="sm" value="" onChange={() => {}} options={[{ value: "", label: "–" }, ...(def.options ?? []).map((o) => ({ value: o.id, label: o.label }))]} />
      : def.field === "multi" ? <span className="pc-tags">{(def.options ?? []).slice(0, 2).map((o) => <span key={o.id} className="pc-tag"><i style={{ background: colorCss(o.color) }} />{o.label}</span>)}<span className="pc-none">+ add</span></span>
        : def.field === "yesno" ? <Checkbox checked={false} onChange={() => {}}>Yes</Checkbox>
          : def.field === "long" ? <TextArea rows={2} readOnly placeholder="Several lines of text" />
            : def.field === "number" ? <TextInput size="sm" readOnly placeholder={def.unit ? `0 ${def.unit}` : "0"} style={{ width: 90 }} />
              : def.field === "date" ? <TextInput size="sm" readOnly placeholder="2026-11-24" icon="calendar" style={{ width: 150 }} />
                : def.field === "reference" ? <span className="pc-ref">{target && <AppIcon glyph={target.glyph} color={target.color} size={20} />}{def.many ? `Pick ${target ? target.plural.toLowerCase() : "files"}` : `Pick a ${target ? target.label.toLowerCase() : "file"}`}</span>
                  : def.field === "position" ? <Button size="sm" variant="quiet" icon="pin">Set position</Button>
                    : <TextInput size="sm" readOnly placeholder="Text" />;
  return (
    <div className="pc-preview">
      <span className="pc-preview__label">{name}</span>
      <span className="pc-preview__control">{control}</span>
      {def.options && def.options.length > 0 && <span className="pc-preview__options">{def.options.map((o) => <span key={o.id} className="pc-tag"><i style={{ background: colorCss(o.color) }} />{o.label}</span>)}</span>}
    </div>
  );
}

// ---------- Naming patterns ----------

export const TOKENS = Object.keys(NAME_TOKENS);
const tokenProblem = (token: string, type: string) => patternProblems(`{${token}}`, type)[0] ?? null;

/** A pattern's text with each {token} in a box: accent when it exists, danger and underlined when it does not or does not apply. */
export function PatternText({ value, type }: { value: string; type: string }) {
  return <>{value.split(/(\{[^{}]*\})/g).filter((x) => x !== "").map((x, n) => (/^\{[^{}]*\}$/.test(x) ? <mark key={n} className={cx(tokenProblem(x.slice(1, -1), type) && "is-bad")}>{x}</mark> : <span key={n}>{x}</span>))}</>;
}

/** A pattern field that shows its tokens: the boxes are drawn behind a transparent input, so typing and the caret behave as in any text field. */
export function PatternInput({ value, type, label, onChange, onFocus, onBlur }: { value: string; type: string; label: string; onChange: (v: string) => void; onFocus?: () => void; onBlur?: () => void }) {
  const bad = patternProblems(value, type).length > 0;
  return (
    <span className={cx("pc-pattern", bad && "is-bad")}>
      <span className="pc-pattern__back" aria-hidden="true"><PatternText value={value} type={type} /></span>
      <input data-pattern={type} value={value} aria-label={label} aria-invalid={bad || undefined} spellcheck={false} maxLength={80} onFocus={onFocus} onBlur={onBlur} onInput={(e) => onChange((e.target as HTMLInputElement).value)} />
    </span>
  );
}

/** A pattern shown, not edited. */
export const PatternView = ({ value, type }: { value: string; type: string }) => <span className="pc-patternview"><PatternText value={value} type={type} /></span>;
