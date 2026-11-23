import type { ComponentChildren, JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { Icon } from "../core/Icon";
import { cx } from "../util";

/** An independent yes/no choice that applies on submit. */
export interface CheckboxProps extends Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "onChange" | "checked"> {
  checked?: boolean;
  indeterminate?: boolean;
  onChange?: (checked: boolean) => void;
  children?: ComponentChildren;
}

export function Checkbox({ checked, indeterminate, onChange, disabled, children, className, ...rest }: CheckboxProps) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = !!indeterminate; }, [indeterminate]);
  return (
    <label className={cx("oc-check", className)}>
      <input ref={ref} type="checkbox" checked={checked} disabled={disabled} onChange={e => onChange && onChange(e.currentTarget.checked)} {...rest} />
      <span className="oc-check__box"><Icon name={indeterminate ? "minus" : "check"} size={12} /></span>
      {children}
    </label>
  );
}
