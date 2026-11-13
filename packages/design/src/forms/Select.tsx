import type { JSX } from "preact";
import { Icon } from "../core/Icon";
import { cx } from "../util";

/** Pick one from a short fixed list (native menu). */
export interface SelectProps extends Omit<JSX.SelectHTMLAttributes<HTMLSelectElement>, "size" | "value" | "onChange"> {
  options: { value: string; label: string }[];
  value?: string;
  onChange?: (value: string) => void;
  size?: "sm" | "md" | "lg";
  invalid?: boolean;
}

export function Select({ options = [], value, onChange, size = "md", invalid, disabled, className, style, ...rest }: SelectProps) {
  return (
    <span className={cx("oc-input", size !== "md" && "oc-input--" + size, invalid && "is-invalid", disabled && "is-disabled", className) + " oc-select"} style={style}>
      <select className="oc-input__el" value={value} disabled={disabled} aria-invalid={invalid || undefined} onChange={e => onChange && onChange(e.currentTarget.value)} {...rest}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <Icon name="chevron-down" />
    </span>
  );
}
