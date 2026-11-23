import type { ComponentChildren, JSX } from "preact";
import { Icon } from "../core/Icon";
import type { IconName } from "../core/glyphs";
import { cx } from "../util";

/** What a list, folder or window shows when it has nothing yet. */
export interface EmptyStateProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "title" | "icon"> {
  icon?: IconName;
  title?: ComponentChildren;
  action?: ComponentChildren;
  children?: ComponentChildren;
}

export function EmptyState({ icon = "folder", title, action, children, className, ...rest }: EmptyStateProps) {
  return (
    <div className={cx("oc-empty", className)} {...rest}>
      <span className="oc-empty__icon"><Icon name={icon} size={20} /></span>
      {title && <div className="oc-empty__title">{title}</div>}
      {children && <div className="oc-empty__text">{children}</div>}
      {action}
    </div>
  );
}
