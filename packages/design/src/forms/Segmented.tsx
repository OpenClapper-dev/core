import type { JSX } from "preact";
import { Icon } from "../core/Icon";
import type { IconName } from "../core/glyphs";
import { useIndicator } from "../motion/useIndicator";
import { cx } from "../util";

/** Switch between 2 to 4 views or modes. Pills choose. */
export interface SegmentedProps extends Omit<JSX.HTMLAttributes<HTMLSpanElement>, "onChange" | "value" | "label" | "disabled"> {
  options: { value: string; label?: string; icon?: IconName; title?: string }[];
  value: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  label?: string;
}

export function Segmented({ options = [], value, onChange, disabled, label, className, ...rest }: SegmentedProps) {
  const [ref, indicator] = useIndicator<HTMLSpanElement>('[aria-checked="true"]', value);
  return (
    <span ref={ref} className={cx("oc-seg", !disabled && "oc-has-ind", disabled && "is-disabled", className)} role="radiogroup" aria-label={label} {...rest}>
      {!disabled && indicator}
      {options.map(o => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} disabled={disabled} className="oc-seg__opt"
          aria-label={o.label ? undefined : o.title} title={o.title} onClick={() => onChange && onChange(o.value)}>
          {o.icon && <Icon name={o.icon} />}{o.label}
        </button>
      ))}
    </span>
  );
}
