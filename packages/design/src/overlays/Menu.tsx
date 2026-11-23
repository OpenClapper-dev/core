import type { JSX } from "preact";
import { Icon } from "../core/Icon";
import { Kbd } from "../core/Kbd";
import type { IconName } from "../core/glyphs";
import { cx } from "../util";

/** One entry of a menu: an item, a separator or a heading. */
export type MenuItemData =
  | { id: string; label: string; icon?: IconName; kbd?: string; danger?: boolean; disabled?: boolean; checked?: boolean; submenu?: boolean; separator?: undefined; heading?: undefined }
  | { separator: true; heading?: undefined }
  | { heading: string; separator?: undefined };

/** The menu surface shared by dropdown and context menus. */
export interface MenuProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "onSelect"> {
  items: MenuItemData[];
  onSelect?: (id: string) => void;
  /** Item with the keyboard cursor. */
  cursor?: string;
}

export function Menu({ items = [], onSelect, cursor, className, ...rest }: MenuProps) {
  const hasSlot = items.some((i) => !i.separator && i.heading == null && (i.icon || i.checked != null));
  return (
    <div role="menu" className={cx("oc-menu", className)} {...rest}>
      {items.map((it, i) => {
        if (it.separator) return <div key={i} role="separator" className="oc-menu__sep" />;
        if (it.heading != null) return <div key={i} className="oc-menu__heading">{it.heading}</div>;
        return (
          <button key={it.id} type="button" role={it.checked != null ? "menuitemcheckbox" : "menuitem"} aria-checked={it.checked != null ? !!it.checked : undefined} disabled={it.disabled}
            className={cx("oc-menu__item", it.danger && "oc-menu__item--danger", cursor === it.id && "is-cursor")} onClick={() => onSelect && onSelect(it.id)}>
            {hasSlot && (it.checked ? <Icon name="check" /> : it.icon ? <Icon name={it.icon} /> : <span className="oc-menu__slot" />)}
            <span className="oc-menu__label">{it.label}</span>
            {it.kbd && <Kbd keys={it.kbd} />}
            {it.submenu && <Icon name="chevron-right" size={12} />}
          </button>
        );
      })}
    </div>
  );
}
