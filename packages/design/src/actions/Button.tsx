import type { ComponentChildren, JSX } from "preact";
import { Icon } from "../core/Icon";
import type { IconName } from "../core/glyphs";
import { Spinner } from "../feedback/Spinner";
import { cx } from "../util";

/** An action: one primary per window region, secondary by default, quiet in toolbars, danger for destructive actions. */
export interface ButtonProps extends Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "children" | "icon" | "size" | "label" | "loading" | "selected"> {
  variant?: "secondary" | "primary" | "quiet" | "danger";
  size?: "sm" | "md" | "lg";
  icon?: IconName;
  iconAfter?: IconName;
  loading?: boolean;
  /** Makes it a toggle (aria-pressed). */
  selected?: boolean;
  /** Accessible name; required when there are no children (icon-only). */
  label?: string;
  children?: ComponentChildren;
}

export function Button({ variant = "secondary", size = "md", icon, iconAfter, loading, selected, disabled, label, children, className, type = "button", ...rest }: ButtonProps) {
  const iconOnly = children == null;
  return (
    <button type={type} disabled={disabled} aria-busy={loading || undefined} aria-pressed={selected == null ? undefined : !!selected}
      aria-label={iconOnly ? label : undefined} title={iconOnly ? label : undefined}
      className={cx("oc-btn", variant !== "secondary" && `oc-btn--${variant}`, size !== "md" && `oc-btn--${size}`, iconOnly && "oc-btn--icon", loading && "is-loading", selected && "is-selected", className)} {...rest}>
      {loading ? <Spinner size={14} /> : icon && <Icon name={icon} />}
      {children}
      {iconAfter && <Icon name={iconAfter} />}
    </button>
  );
}
