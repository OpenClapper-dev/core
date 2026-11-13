import type { ComponentChildren, JSX } from "preact";
import { Icon } from "../core/Icon";
import type { IconName } from "../core/glyphs";
import { cx } from "../util";

/** Clicks on the field chrome focus the input instead of blurring it. */
const ocFocusIn = (e: JSX.TargetedMouseEvent<HTMLElement>) => { if ((e.target as Element).closest("button,input,select,textarea")) return; const i = e.currentTarget.querySelector("input"); if (i && !i.disabled) { e.preventDefault(); i.focus(); } };

/** A single-line text field. */
export interface TextInputProps extends Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "size" | "icon"> {
  size?: "sm" | "md" | "lg";
  icon?: IconName;
  suffix?: ComponentChildren;
  invalid?: boolean;
}

export function TextInput({ size = "md", icon, suffix, invalid, disabled, className, style, ...rest }: TextInputProps) {
  return (
    <span className={cx("oc-input", size !== "md" && "oc-input--" + size, invalid && "is-invalid", disabled && "is-disabled", className)} style={style} onMouseDown={ocFocusIn}>
      {icon && <Icon name={icon} />}
      <input className="oc-input__el" disabled={disabled} aria-invalid={invalid || undefined} {...rest} />
      {invalid && <Icon name="warning" className="oc-input__state" />}
      {suffix}
    </span>
  );
}
