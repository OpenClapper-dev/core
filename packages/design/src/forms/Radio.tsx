import type { ComponentChildren, JSX } from "preact";
import { cx } from "../util";

/** One of a few exclusive choices, listed vertically. */
export interface RadioProps extends Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "onChange" | "checked" | "value" | "name"> {
  checked?: boolean;
  value: string;
  name?: string;
  onChange?: (value: string) => void;
  children?: ComponentChildren;
}

export function Radio({ checked, onChange, name, value, disabled, children, className, ...rest }: RadioProps) {
  return (
    <label className={cx("oc-check", "oc-check--radio", className)}>
      <input type="radio" name={name} value={value} checked={checked} disabled={disabled} onChange={() => onChange && onChange(value)} {...rest} />
      <span className="oc-check__box"><span className="oc-check__dot" /></span>
      {children}
    </label>
  );
}
