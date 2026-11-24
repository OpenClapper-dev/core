import type { ComponentChildren, JSX } from "preact";
import { Icon } from "../core/Icon";
import { cx } from "../util";

/**
 * A file as a card in a grid: its picture or its type icon, its name and a line of facts. Clicking
 * and ticking are two things: a click makes the card the current one, the circle in its corner
 * ticks it for acting on several. The circle shows on hover, and on every card of a grid that has
 * ticks (`FileGrid` with `ticking`).
 */
export interface FileCardProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "name" | "selected"> {
  name: string;
  meta?: ComponentChildren;
  /** The picture, or the file type's icon. */
  art: ComponentChildren;
  /** Art that is a picture gets the dark stage behind it; an icon the sunken surface. */
  picture?: boolean;
  /** A small mark over the art's corner (the type icon over a picture, a shortcut's arrow). */
  badge?: ComponentChildren;
  /** Ticked. */
  selected?: boolean;
  /** The current file: outlined. */
  current?: boolean;
  /** Something is dragged over it and may be dropped. */
  dropTarget?: boolean;
  onTick?: () => void;
  onOpen?: () => void;
}

export function FileCard({ name, meta, art, picture, badge, selected, current, dropTarget, onTick, onOpen, className, ...rest }: FileCardProps) {
  return (
    <div role="option" tabIndex={0} aria-selected={!!selected} className={cx("oc-filecard", selected && "is-selected", current && "is-current", dropTarget && "is-drop", className)} onDblClick={onOpen} {...rest}>
      <span className={cx("oc-filecard__art", picture && "oc-filecard__art--picture")}>
        {art}
        {badge && <span className="oc-filecard__badge">{badge}</span>}
        {onTick && (
          <span role="checkbox" aria-checked={!!selected} aria-label={`Select ${name}`} tabIndex={0} className={cx("oc-filecard__tick", selected && "is-on")}
            onClick={(e) => { e.stopPropagation(); onTick(); }} onDblClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); e.stopPropagation(); onTick(); } }}>
            {selected && <Icon name="check" size={12} />}
          </span>
        )}
      </span>
      <span className="oc-filecard__name" title={name}>{name}</span>
      {meta != null && <span className="oc-filecard__meta">{meta}</span>}
    </div>
  );
}

/** The grid that holds file cards. `ticking` shows every card's tick circle (something is ticked). */
export interface FileGridProps extends JSX.HTMLAttributes<HTMLDivElement> {
  ticking?: boolean;
  children?: ComponentChildren;
}

export function FileGrid({ ticking, children, className, ...rest }: FileGridProps) {
  return <div role="listbox" aria-multiselectable="true" className={cx("oc-filegrid", ticking && "is-ticking", className)} {...rest}>{children}</div>;
}
