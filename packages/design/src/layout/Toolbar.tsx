import type { ComponentChildren, JSX } from "preact";
import { cx } from "../util";

/** A 36 px strip of controls at the top of a window or panel; use quiet buttons inside and ToolbarSpacer to push items right. */
export interface ToolbarProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "title"> {
  title?: ComponentChildren;
  children?: ComponentChildren;
}

export function Toolbar({ title, children, className, ...rest }: ToolbarProps) {
  return <div role="toolbar" className={cx("oc-toolbar", className)} {...rest}>{title && <span className="oc-toolbar__title">{title}</span>}{children}</div>;
}

/** Pushes the following toolbar items to the right. */
export function ToolbarSpacer() { return <span className="oc-toolbar__spacer" />; }
