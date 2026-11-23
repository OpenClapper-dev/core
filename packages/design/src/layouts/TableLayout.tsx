import type { ComponentChildren, JSX } from "preact";
import { cx } from "../util";

/** Window template: toolbar, filter row, a full-width table, pagination footer. */
export interface TableLayoutProps extends JSX.HTMLAttributes<HTMLDivElement> {
  toolbar?: ComponentChildren;
  /** Chips, search. */
  filters?: ComponentChildren;
  footer?: ComponentChildren;
  statusBar?: ComponentChildren;
  children?: ComponentChildren;
}

export function TableLayout({ toolbar, filters, children, footer, statusBar, className, ...rest }: TableLayoutProps) {
  return (
    <div className={cx("oc-app", className)} {...rest}>
      {toolbar}
      {filters && <div className="oc-app__filters">{filters}</div>}
      <div className="oc-app__main">{children}</div>
      {footer && <div style={{ flex: "none", display: "flex", justifyContent: "flex-end", padding: "2px var(--space-4)", borderTop: "var(--border-w) solid var(--border-divider)" }}>{footer}</div>}
      {statusBar}
    </div>
  );
}
