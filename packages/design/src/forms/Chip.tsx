import type { ComponentChildren, JSX } from "preact";
import { Icon } from "../core/Icon";
import type { IconName } from "../core/glyphs";
import { cx } from "../util";

/** A pill that chooses (filter on/off) or a removable token. */
export interface ChipProps extends Omit<JSX.HTMLAttributes<HTMLElement>, "icon" | "selected" | "onToggle"> {
  /** Choice chip state. */
  selected?: boolean;
  onToggle?: (selected: boolean) => void;
  /** Makes it a removable chip. */
  onRemove?: () => void;
  icon?: IconName;
  disabled?: boolean;
  children?: ComponentChildren;
}

export function Chip({ selected, onToggle, onRemove, icon, disabled, children, className, ...rest }: ChipProps) {
  if (onRemove) {
    return (
      <span className={cx("oc-chip", disabled && "is-disabled", className)} {...rest}>
        {icon && <Icon name={icon} size={12} />}{children}
        <button type="button" className="oc-chip__x" aria-label="Remove" disabled={disabled} onClick={onRemove}><Icon name="close" size={10} /></button>
      </span>
    );
  }
  return (
    <button type="button" className={cx("oc-chip", selected && "is-selected", className)} aria-pressed={!!selected} disabled={disabled} onClick={() => onToggle && onToggle(!selected)} {...(rest as JSX.HTMLAttributes<HTMLButtonElement>)}>
      {selected ? <Icon name="check" size={12} /> : icon && <Icon name={icon} size={12} />}{children}
    </button>
  );
}
