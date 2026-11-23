import type { ComponentChildren, JSX } from "preact";
import { cx } from "../util";

/** A vertical list of ListRow elements. */
export interface ListProps extends JSX.HTMLAttributes<HTMLUListElement> {
  children?: ComponentChildren;
}

export function List({ children, className, ...rest }: ListProps) {
  return <ul role="listbox" className={cx("oc-list", className)} {...rest}>{children}</ul>;
}
