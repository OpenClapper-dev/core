import { Fragment, type JSX } from "preact";
import { Icon } from "../core/Icon";
import type { IconName } from "../core/glyphs";
import { cx } from "../util";

/** The left navigation of a browser-style app: grouped rows with an icon and an optional count. */
export interface SidebarNavProps extends Omit<JSX.HTMLAttributes<HTMLElement>, "onChange" | "value"> {
  sections: { label?: string; items: { id: string; label: string; icon?: IconName; count?: number }[] }[];
  value?: string;
  onChange?: (id: string) => void;
}

export function SidebarNav({ sections = [], value, onChange, className, ...rest }: SidebarNavProps) {
  return (
    <nav className={cx("oc-nav", className)} {...rest}>
      {sections.map((s, i) => (
        <Fragment key={i}>
          {s.label && <div className="oc-nav__label">{s.label}</div>}
          {s.items.map(it => (
            <button key={it.id} type="button" className="oc-nav__item" aria-current={it.id === value ? "true" : undefined} onClick={() => onChange && onChange(it.id)}>
              {it.icon && <Icon name={it.icon} />}<span className="oc-nav__text">{it.label}</span>{it.count != null && <span className="oc-nav__count">{it.count}</span>}
            </button>
          ))}
        </Fragment>
      ))}
    </nav>
  );
}
