import type { ComponentChildren, JSX } from "preact";
import { Icon } from "../core/Icon";
import type { IconName } from "../core/glyphs";
import { cx } from "../util";

/** One row of a list: icon, text, mono meta, optional chevron. */
export interface ListRowProps extends Omit<JSX.HTMLAttributes<HTMLLIElement>, "icon" | "size" | "selected" | "disabled"> {
  icon?: IconName;
  leading?: ComponentChildren;
  meta?: ComponentChildren;
  trailing?: ComponentChildren;
  chevron?: boolean;
  selected?: boolean;
  /** Keyboard position: an outline, independent of selection. */
  cursor?: boolean;
  disabled?: boolean;
  /** md 24, lg 32, touch 48. */
  size?: "md" | "lg" | "touch";
  children?: ComponentChildren;
}

export function ListRow({ icon, leading, meta, trailing, chevron, selected, cursor, disabled, size = "md", children, className, ...rest }: ListRowProps) {
  return (
    <li role="option" aria-selected={!!selected} aria-disabled={disabled || undefined} tabIndex={disabled ? undefined : -1}
      className={cx("oc-row", size !== "md" && "oc-row--" + size, selected && "is-selected", cursor && "is-cursor", className)} {...rest}>
      {leading}{icon && <Icon name={icon} />}
      <span className="oc-row__main">{children}</span>
      {meta != null && <span className="oc-row__meta">{meta}</span>}
      {trailing}{chevron && <Icon name="chevron-right" size={12} />}
    </li>
  );
}
