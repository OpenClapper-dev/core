import type { ComponentChildren, JSX } from "preact";
import { Icon } from "../core/Icon";
import type { IconName } from "../core/glyphs";
import { Spinner } from "../feedback/Spinner";
import { cx } from "../util";

/** A bottom bar holding the screen's one or two main actions as TouchButtons. */
export interface ActionBarProps extends JSX.HTMLAttributes<HTMLDivElement> {
  children?: ComponentChildren;
}

export function ActionBar({ children, className, ...rest }: ActionBarProps) {
  return <div className={cx("oc-m-actionbar", className)} {...rest}>{children}</div>;
}

/** A 48 dp phone button. */
export interface TouchButtonProps extends Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "icon" | "loading"> {
  variant?: "primary" | "secondary" | "quiet";
  icon?: IconName;
  loading?: boolean;
  /** Full width. */
  block?: boolean;
  children?: ComponentChildren;
}

export function TouchButton({ variant = "secondary", icon, loading, block, children, className, ...rest }: TouchButtonProps) {
  return (
    <button type="button" className={cx("oc-m-btn", variant !== "quiet" && `oc-m-btn--${variant}`, block && "oc-m-btn--block", className)} {...rest}>
      {loading ? <Spinner size={20} /> : icon && <Icon name={icon} size={22} />}{children}
    </button>
  );
}
