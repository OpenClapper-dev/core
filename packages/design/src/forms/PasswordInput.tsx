import type { JSX } from "preact";
import { useState } from "preact/hooks";
import { Icon } from "../core/Icon";
import { cx } from "../util";

/** Clicks on the field chrome focus the input instead of blurring it. */
const ocFocusIn = (e: JSX.TargetedMouseEvent<HTMLElement>) => { if ((e.target as Element).closest("button,input,select,textarea")) return; const i = e.currentTarget.querySelector("input"); if (i && !i.disabled) { e.preventDefault(); i.focus(); } };

/** A password field with a show/hide button. */
export interface PasswordInputProps extends Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "size" | "type"> {
  size?: "sm" | "md" | "lg";
  invalid?: boolean;
}

export function PasswordInput({ size = "md", invalid, disabled, className, style, ...rest }: PasswordInputProps) {
  const [show, setShow] = useState(false);
  return (
    <span className={cx("oc-input", size !== "md" && "oc-input--" + size, invalid && "is-invalid", disabled && "is-disabled", className)} style={style} onMouseDown={ocFocusIn}>
      <Icon name="lock" />
      <input className="oc-input__el" type={show ? "text" : "password"} disabled={disabled} aria-invalid={invalid || undefined} {...rest} />
      {invalid && <Icon name="warning" className="oc-input__state" />}
      <button type="button" className="oc-input__btn" aria-label={show ? "Hide password" : "Show password"} aria-pressed={show} onClick={() => setShow(s => !s)}><Icon name={show ? "eye-off" : "eye"} /></button>
    </span>
  );
}
