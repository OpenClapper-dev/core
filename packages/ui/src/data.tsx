/** Data display from the design system (data.css): list rows, menu items, review state and sequence markers. */
import type { ComponentChildren, JSX } from "preact";
import { STATE_ICONS, label, type ShotState } from "@fielder/vocab";
import { cx, Icon } from "./core";

/** Review state: colour + icon + label (icon-only on thumbnails, then it carries a title). */
export function StateMarker({ state, iconOnly, lg }: { state: ShotState; iconOnly?: boolean; lg?: boolean }) {
  return (
    <span class={cx("f-state", `f-state--${state}`, iconOnly && "f-state--icon", lg && "f-state--lg")} title={label(state)} aria-label={iconOnly ? label(state) : undefined}>
      <Icon name={STATE_ICONS[state]} />{!iconOnly && label(state)}
    </span>
  );
}

/** "SEQ · n": solid, never translucent over a photo. */
export function SeqBadge({ count, lg, small }: { count: number; lg?: boolean; small?: boolean }) {
  return <span class={cx("f-seq", lg && "f-seq--lg")} style={small ? { height: "20px", padding: "0 6px", fontSize: "11px" } : undefined} title={`${count} photos in this shot`}>{!small && <Icon name="layers-triple-outline" />}SEQ · {count}</span>;
}

/**
 * A dense list row (f-row): optional thumbnail, title over meta, then trailing content. A
 * <button> when it does something on click, otherwise a <div>. Selected = accent bar + tint.
 */
export function ListRow({ as = "button", selected, thumb, title, meta, metaClass, trailing, tooltip, class: extra, ...rest }: Omit<JSX.HTMLAttributes<HTMLDivElement>, "title" | "as" | "ref"> & {
  as?: "button" | "div"; selected?: boolean; thumb?: ComponentChildren; title: ComponentChildren; meta?: ComponentChildren; metaClass?: string; trailing?: ComponentChildren; /** Hover text (the title attribute; `title` is the row title). */ tooltip?: string;
}) {
  // One element type for TypeScript; the runtime tag is a button or a div.
  const Tag = as as "div";
  return (
    <Tag {...(as === "button" ? { type: "button" } : {})} title={tooltip} class={cx("f-row f-row--dense", extra as string | undefined, selected && "is-selected")} {...rest}>
      {thumb}
      <div class="f-row__main"><span class="f-row__title">{title}</span>{meta !== undefined && <span class={cx("f-row__meta", metaClass)}>{meta}</span>}</div>
      {trailing}
    </Tag>
  );
}

/**
 * An entry of an f-menu (popover, project list): icon, label, optional count on the right.
 * `selected` makes it bold; `danger` red. With `count` the label ellipsises to make room.
 */
export function MenuItem({ icon, selected, highlighted, danger, count, children, ...rest }: Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "icon"> & { icon?: string; selected?: boolean; /** Keyboard highlight in a listbox (is-hi). */ highlighted?: boolean; danger?: boolean; count?: ComponentChildren; children: ComponentChildren }) {
  return (
    <button type="button" class={cx("f-menu__item", highlighted && "is-hi", selected && "is-sel", danger && "f-menu__item--danger")} {...rest}>
      {icon && <Icon name={icon} />}
      {count !== undefined ? <><span class="ellipsis" style={{ flex: 1 }}>{children}</span><span class="f-nav__count">{count}</span></> : children}
    </button>
  );
}

/** Project tag (f-ptag): a small outlined label with the project name, or "Active". */
export function ProjectTag({ icon, title, style, children }: { icon?: string; title?: string; style?: JSX.CSSProperties; children: ComponentChildren }) {
  return <span class="f-ptag" style={style} title={title}>{icon && <Icon name={icon} />}{children}</span>;
}
