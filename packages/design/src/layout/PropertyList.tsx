import type { ComponentChildren, JSX } from "preact";
import { useState } from "preact/hooks";
import { Icon } from "../core/Icon";
import type { IconName } from "../core/glyphs";
import { cx } from "../util";

/** An inspector: collapsible sections of label–value rows, numbers right-aligned in mono. */
export interface PropertyListProps extends JSX.HTMLAttributes<HTMLDivElement> {
  /** PropertySection elements. */
  children?: ComponentChildren;
}

export function PropertyList({ children, className, ...rest }: PropertyListProps) {
  return <div className={cx("oc-props", className)} {...rest}>{children}</div>;
}

/** A collapsible group of PropertyRow elements. */
export interface PropertySectionProps {
  title: ComponentChildren;
  icon?: IconName;
  defaultOpen?: boolean;
  children?: ComponentChildren;
}

export function PropertySection({ title, icon, defaultOpen = true, children }: PropertySectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="oc-props__section">
      <button type="button" className="oc-props__head" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <Icon name={open ? "chevron-down" : "chevron-right"} size={12} />{icon && <Icon name={icon} />}<span>{title}</span>
      </button>
      {open && <div className="oc-props__body">{children}</div>}
    </section>
  );
}

/** One label–value row of a PropertySection. */
export interface PropertyRowProps {
  label: ComponentChildren;
  value?: ComponentChildren;
  /** Spaced after the value, in secondary text. */
  unit?: string;
  /** Right-aligned, tabular figures. Numeric values always wrap, never truncate. */
  numeric?: boolean;
  /** 'wrap' (default): up to three lines, then ellipsis with the full value as tooltip. 'truncate': one line + tooltip, for paths and file names. */
  overflow?: "wrap" | "truncate";
  /** An editable control in place of the value. */
  children?: ComponentChildren;
}

export function PropertyRow({ label, value, unit, numeric, overflow = "wrap", children }: PropertyRowProps) {
  const control = children != null;
  const mode = numeric ? "wrap" : overflow;
  const full = !control && (typeof value === "string" || typeof value === "number") ? value + (unit ? " " + unit : "") : undefined;
  return (
    <div className={cx("oc-props__row", control && "oc-props__row--control")}>
      <span className="oc-props__label" title={typeof label === "string" ? label : undefined}>{label}</span>
      <span className={cx("oc-props__value", "oc-props__value--" + mode, numeric && "is-num oc-tnum")} title={full}>{control ? children : value}{unit && <span className="oc-props__unit">{unit}</span>}</span>
    </div>
  );
}
