import type { ComponentChildren, JSX } from "preact";
import { cx } from "../util";
import { Icon } from "./Icon";
import type { IconName } from "./glyphs";

/** A small static label for a state or a count; not interactive (use Chip for choices). */
export interface BadgeProps extends Omit<JSX.HTMLAttributes<HTMLSpanElement>, "icon"> {
  tone?: "neutral" | "accent" | "success" | "warning" | "danger";
  /** Required for any tone other than neutral: a state is never colour alone. */
  icon?: IconName;
  /** Round, mono, for counts. */
  count?: boolean;
  children?: ComponentChildren;
}

export function Badge({ tone = "neutral", icon, count, children, className, ...rest }: BadgeProps) {
  return (
    <span className={cx("oc-badge", tone !== "neutral" && `oc-badge--${tone}`, count && "oc-badge--count", className)} {...rest}>
      {icon && <Icon name={icon} size={12} />}{children}
    </span>
  );
}
