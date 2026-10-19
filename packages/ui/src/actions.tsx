/**
 * Actions from the design system (actions.css): "rectangles act". Every button on the dashboard
 * is one of these, so variants, sizes and the key hint look the same everywhere.
 */
import type { ComponentChildren, JSX, Ref } from "preact";
import { cx, Icon } from "./core";

export type ButtonKind = "primary" | "secondary" | "ghost" | "approve" | "archive" | "danger" | "danger-solid";

type ButtonAttrs = Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "icon" | "size" | "label" | "ref">;

export interface ButtonProps extends ButtonAttrs {
  /** primary (accent fill) is the default; secondary is outlined, ghost borderless. */
  kind?: ButtonKind;
  /** md is 36 px (default), sm 28 px for toolbars, panels and rows. */
  size?: "sm" | "md";
  /** Leading icon. */
  icon?: string;
  /** Trailing icon, e.g. chevron-down on a menu button. */
  iconAfter?: string;
  /** Shortcut hint shown inside the button (f-btn__kbd), e.g. "Esc", "⌘S", or a count. */
  kbd?: ComponentChildren;
  btnRef?: Ref<HTMLButtonElement>;
  children?: ComponentChildren;
}

/** An action button: icon, label and optional shortcut hint, in one of the design-system variants. */
export function Button({ kind = "primary", size = "md", icon, iconAfter, kbd, btnRef, class: extra, children, ...rest }: ButtonProps) {
  return (
    <button type="button" ref={btnRef} class={cx("f-btn", kind !== "primary" && `f-btn--${kind}`, size === "sm" && "f-btn--sm", extra as string | undefined)} {...rest}>
      {icon && <Icon name={icon} />}{children}{iconAfter && <Icon name={iconAfter} />}{kbd !== undefined && kbd !== null && kbd !== false && <span class="f-btn__kbd">{kbd}</span>}
    </button>
  );
}

export interface IconButtonProps extends Omit<ButtonProps, "iconAfter" | "kbd" | "icon" | "children"> {
  icon: string;
  /** Accessible name; icon-only buttons always need one. Pass `title` as well for a hover hint. */
  label: string;
}

/** A square icon-only button. Defaults to ghost and sm, the common case in toolbars, panels and rows. */
export function IconButton({ icon, label, kind = "ghost", size = "sm", btnRef, class: extra, ...rest }: IconButtonProps) {
  return (
    <button type="button" ref={btnRef} class={cx("f-btn", kind !== "primary" && `f-btn--${kind}`, size === "sm" && "f-btn--sm", "f-btn--icon", extra as string | undefined)} aria-label={label} {...rest}>
      <Icon name={icon} />
    </button>
  );
}

interface ReorderItem { label: string; title?: string }

/** Move up / move down (/ remove, when given) for an item of an ordered list. Disables up on the first item and down on the last. */
export function ReorderButtons({ index, count, onMove, onRemove, up = { label: "Move up" }, down = { label: "Move down" }, remove }: {
  index: number; count: number; onMove: (index: number, delta: -1 | 1) => void; onRemove?: () => void;
  up?: ReorderItem; down?: ReorderItem; remove?: ReorderItem;
}) {
  return (
    <>
      <IconButton icon="arrow-up" label={up.label} title={up.title} disabled={index === 0} onClick={() => onMove(index, -1)} />
      <IconButton icon="arrow-down" label={down.label} title={down.title} disabled={index === count - 1} onClick={() => onMove(index, 1)} />
      {onRemove && remove && <IconButton icon="close" label={remove.label} title={remove.title} onClick={onRemove} />}
    </>
  );
}

/** A text-only button that reads as a link (f-linkbtn), in caption or small text. */
export function LinkButton({ size = "caption", children, ...rest }: Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "size"> & { size?: "caption" | "small"; children: ComponentChildren }) {
  return <button type="button" class="f-linkbtn" style={{ fontSize: `var(--text-${size})` }} {...rest}>{children}</button>;
}
