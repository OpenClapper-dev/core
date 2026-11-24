import type { JSX } from "preact";
import { useState } from "preact/hooks";
import { Icon } from "../core/Icon";
import { cx } from "../util";
import { ColorPicker } from "./ColorPicker";

/** One of the eight categorical colours (1 to 8), or any colour as #rrggbb. */
export type ChosenColor = number | string;
/** A chosen colour as CSS. */
export const colorCss = (c: ChosenColor | null | undefined): string => (c == null || c === 0 ? "var(--text-secondary)" : typeof c === "number" ? `var(--cat-${c})` : c);

/**
 * Colours are always chosen the same way (docs/rewrite/ux-1-files.md): the eight predefined colours
 * and, behind "+", the design system's picker for any other. For a collection's colour and a choice
 * option's alike.
 */
export interface ColorChooserProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "onChange" | "value"> {
  value: ChosenColor | null | undefined;
  onChange: (c: ChosenColor) => void;
  label: string;
}

export function ColorChooser({ value, onChange, label, className, ...rest }: ColorChooserProps) {
  const own = typeof value === "string";
  const [open, setOpen] = useState(own);
  return (
    <div className={cx("oc-colorchooser", className)} {...rest}>
      <div className="oc-swatches" role="radiogroup" aria-label={label}>
        {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => <button type="button" key={n} role="radio" aria-checked={value === n} aria-label={`Colour ${n}`} className={cx(value === n && "is-on")} style={{ background: `var(--cat-${n})` }} onClick={() => { onChange(n); setOpen(false); }} />)}
        <button type="button" role="radio" aria-checked={own} aria-expanded={open} aria-label="A colour of your own" title="A colour of your own" className={cx("oc-swatches__own", own && "is-on")} style={{ background: own ? value : undefined }} onClick={() => setOpen(!open)}>{!own && <Icon name="plus" size={12} />}</button>
      </div>
      {open && <ColorPicker value={own ? value : "#4f6bd8"} onChange={onChange} />}
    </div>
  );
}
