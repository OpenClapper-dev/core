import type { ComponentChildren, JSX } from "preact";
import { Icon } from "../core/Icon";
import { cx } from "../util";

/** A setting that takes effect at once. */
export interface SwitchProps extends Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "onChange" | "checked"> {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  children?: ComponentChildren;
}

export function Switch({ checked, onChange, disabled, children, className, ...rest }: SwitchProps) {
  return (
    <label className={cx("oc-switch", className)}>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={e => onChange && onChange(e.currentTarget.checked)} {...rest} />
      <span className="oc-switch__track"><span className="oc-switch__knob"><Icon name="check" size={10} /></span></span>
      {children}
    </label>
  );
}
