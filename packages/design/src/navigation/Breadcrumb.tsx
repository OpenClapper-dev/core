import { Fragment, type JSX } from "preact";
import { Icon } from "../core/Icon";
import { cx } from "../util";

/** The path to the current folder or object; the last item is the current page. */
export interface BreadcrumbProps extends JSX.HTMLAttributes<HTMLElement> {
  items: { id: string; label: string }[];
  onNavigate?: (id: string) => void;
}

export function Breadcrumb({ items = [], onNavigate, className, ...rest }: BreadcrumbProps) {
  return (
    <nav aria-label="Path" className={cx("oc-crumbs", className)} {...rest}>
      {items.map((it, i) => {
        const last = i === items.length - 1;
        return (
          <Fragment key={it.id}>
            {i > 0 && <Icon name="chevron-right" size={12} />}
            <button type="button" className="oc-crumb" aria-current={last ? "page" : undefined} onClick={() => onNavigate && onNavigate(it.id)}>{it.label}</button>
          </Fragment>
        );
      })}
    </nav>
  );
}
