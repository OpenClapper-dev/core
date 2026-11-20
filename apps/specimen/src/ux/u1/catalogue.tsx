// Shared pieces of the property catalogue in the U1 prototype: field types, the colour chooser, and a property drawn
// as the input it will be in the properties panel.
import { AppIcon, Button, Checkbox, Icon, Popover, Select, TextArea, TextInput, cx, type IconName } from "@openclapper/design";
import { TYPES, type FieldType, type FileType, type PropDef } from "./data";

export type Colour = number | string;
export type Option = { value: string; color: Colour };
/** A property definition as the Project app edits it: options may carry a colour of the user's own. */
export type Def = Omit<PropDef, "options"> & { options?: Option[]; hidden?: FileType[]; parent?: string };

export const FIELD: Record<FieldType, { label: string; icon: IconName }> = {
  text: { label: "Text", icon: "note" }, long: { label: "Long text", icon: "notes" }, number: { label: "Number", icon: "ruler" }, yesno: { label: "Yes / no", icon: "check" },
  choice: { label: "Single choice", icon: "tag" }, multi: { label: "Multiple choice", icon: "tag" }, date: { label: "Date", icon: "calendar" }, reference: { label: "Reference", icon: "link" }, position: { label: "Position", icon: "pin" },
};
export const FILE_TYPES: FileType[] = ["photo", "collection", "canvas", "shot", "set", "location", "timeline", "preset", "folder"];
export const css = (c: Colour | undefined) => (c == null || c === 0 ? "var(--text-secondary)" : typeof c === "number" ? `var(--cat-${c})` : c);

/** The eight predefined colours and a picker for any other. Used for a collection's colour and for an option's. */
export function Swatches({ value, onChange, label }: { value: Colour | undefined; onChange: (c: Colour) => void; label: string }) {
  return (
    <div className="u1-swatches" role="radiogroup" aria-label={label}>
      {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => <button type="button" key={n} role="radio" aria-checked={value === n} aria-label={`Colour ${n}`} className={cx(value === n && "is-on")} style={{ background: `var(--cat-${n})` }} onClick={() => onChange(n)} />)}
      <label className={cx("u1-swatches__own", typeof value === "string" && "is-on")} title="A colour of your own" style={{ background: typeof value === "string" ? value : undefined }}>
        <Icon name="plus" size={12} /><input type="color" aria-label="A colour of your own" value={typeof value === "string" ? value : "#888888"} onInput={(e) => onChange((e.target as HTMLInputElement).value)} />
      </label>
    </div>
  );
}

/** A colour dot that opens the chooser. */
export function ColourButton({ value, onChange, label }: { value: Colour; onChange: (c: Colour) => void; label: string }) {
  return (
    <Popover trigger={<button type="button" className="u1p-swatch" style={{ background: css(value) }} aria-label={`${label}: choose a colour`} />}>
      <Swatches value={value} onChange={onChange} label={label} />
    </Popover>
  );
}

/** The file types a property is on, as their icons. */
export const OnIcons = ({ on, hidden }: { on: FileType[]; hidden?: FileType[] }) => <span className="u1p-row__on">{on.filter((t) => TYPES[t]).map((t) => <AppIcon key={t} glyph={TYPES[t].glyph} color={TYPES[t].color} size={20} label={TYPES[t].plural} off={hidden?.includes(t)} />)}</span>;

/** A property as it will appear in the properties panel: its label and the control of its field type, not editable here. */
export function FieldPreview({ def }: { def: Def }) {
  const control =
    def.type === "choice" ? <Select size="sm" value="" options={[{ value: "", label: "–" }, ...(def.options ?? []).map((o) => ({ value: o.value, label: o.value }))]} />
      : def.type === "multi" ? <span className="u1-tags">{(def.options ?? []).slice(0, 2).map((o) => <span key={o.value} className="u1-tag"><i style={{ background: css(o.color) }} />{o.value}</span>)}<span className="u1-none">+ add</span></span>
        : def.type === "yesno" ? <Checkbox checked={false}>Yes</Checkbox>
          : def.type === "long" ? <TextArea rows={2} readOnly placeholder="Several lines of text" />
            : def.type === "number" ? <TextInput size="sm" readOnly placeholder="0" style={{ width: 90 }} />
              : def.type === "date" ? <TextInput size="sm" readOnly placeholder="2026-11-20" icon="calendar" style={{ width: 150 }} />
                : def.type === "reference" ? <span className="u1-ref"><AppIcon glyph={TYPES[def.target ?? "set"].glyph} color={TYPES[def.target ?? "set"].color} size={20} />{def.many ? `Pick ${TYPES[def.target ?? "set"].plural.toLowerCase()}` : `Pick a ${TYPES[def.target ?? "set"].label.toLowerCase()}`}</span>
                  : def.type === "position" ? <Button size="sm" variant="quiet" icon="pin">Set position</Button>
                    : <TextInput size="sm" readOnly placeholder="Text" />;
  return (
    <div className="u1p-preview">
      <span className="u1p-preview__label">{def.name}</span>
      <span className="u1p-preview__control">{control}</span>
      {def.options && def.options.length > 0 && <span className="u1p-preview__options">{def.options.map((o) => <span key={o.value} className="u1-tag"><i style={{ background: css(o.color) }} />{o.value}</span>)}</span>}
    </div>
  );
}
