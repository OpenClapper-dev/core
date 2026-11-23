import type { ComponentChildren, JSX } from "preact";
import { cx } from "../util";

/** A 22 px mono strip at the bottom of a window for counts and facts, separated by middle dots. */
export interface StatusBarProps extends JSX.HTMLAttributes<HTMLDivElement> {
  children?: ComponentChildren;
}

export function StatusBar({ children, className, ...rest }: StatusBarProps) {
  return <div role="status" className={cx("oc-statusbar", className)} {...rest}>{children}</div>;
}
