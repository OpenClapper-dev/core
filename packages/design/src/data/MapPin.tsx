import type { ComponentChildren, JSX } from "preact";
import { Icon } from "../core/Icon";
import type { IconName } from "../core/glyphs";
import { cx } from "../util";

/** A marker on a map, in fixed colours that work on any map. */
export interface MapPinProps extends Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "icon" | "label" | "selected"> {
  icon?: IconName;
  label?: ComponentChildren;
  selected?: boolean;
  /** A short number or letter when there is no icon. */
  children?: ComponentChildren;
}

export function MapPin({ icon, label, selected, children, className, ...rest }: MapPinProps) {
  return (
    <button type="button" aria-pressed={!!selected} className={cx("oc-pin", selected && "is-selected", className)} {...rest}>
      <span className="oc-pin__head">{icon ? <Icon name={icon} size={12} /> : <span className="oc-num" style={{ font: "700 10px/1 var(--font-mono)" }}>{children}</span>}</span>
      {label && <span className="oc-pin__label">{label}</span>}
    </button>
  );
}
