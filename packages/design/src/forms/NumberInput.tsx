import type { JSX } from "preact";
import { Icon } from "../core/Icon";
import { cx } from "../util";

/** Clicks on the field chrome focus the input instead of blurring it. */
const ocFocusIn = (e: JSX.TargetedMouseEvent<HTMLElement>) => { if ((e.target as Element).closest("button,input,select,textarea")) return; const i = e.currentTarget.querySelector("input"); if (i && !i.disabled) { e.preventDefault(); i.focus(); } };

/** A number with a unit, in tabular mono; arrow keys and steppers change it by `step`. */
export interface NumberInputProps extends Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "size" | "value" | "onChange" | "step" | "min" | "max"> {
  value: number | null;
  onChange?: (value: number) => void;
  /** Shown after the value, e.g. 'mm'. */
  unit?: string;
  step?: number;
  min?: number;
  max?: number;
  size?: "sm" | "md" | "lg";
  invalid?: boolean;
}

export function NumberInput({ value, onChange, unit, step = 1, min, max, size = "md", invalid, disabled, className, style, ...rest }: NumberInputProps) {
  const clamp = (n: number) => Math.min(max == null ? Infinity : max, Math.max(min == null ? -Infinity : min, n));
  const set = (n: number) => { if (onChange && !Number.isNaN(n)) onChange(clamp(n)); };
  const bump = (d: number) => set(Math.round(((Number(value) || 0) + d * step) * 1e6) / 1e6);
  const onKey = (e: JSX.TargetedKeyboardEvent<HTMLInputElement>) => { if (e.key === "ArrowUp") { e.preventDefault(); bump(1); } if (e.key === "ArrowDown") { e.preventDefault(); bump(-1); } };
  return (
    <span className={cx("oc-input", size !== "md" && "oc-input--" + size, invalid && "is-invalid", disabled && "is-disabled", className)} style={style} onMouseDown={ocFocusIn}>
      <input className="oc-input__el oc-num" inputMode="decimal" value={value == null ? "" : value} disabled={disabled} aria-invalid={invalid || undefined}
        onInput={e => set(e.currentTarget.value === "" ? 0 : parseFloat(e.currentTarget.value))} onKeyDown={onKey} {...rest} />
      {invalid && <Icon name="warning" className="oc-input__state" />}
      {unit && <span className="oc-input__unit">{unit}</span>}
      <span className="oc-input__steps">
        <button type="button" tabIndex={-1} aria-label="Increase" onClick={() => bump(1)}><Icon name="chevron-up" size={10} /></button>
        <button type="button" tabIndex={-1} aria-label="Decrease" onClick={() => bump(-1)}><Icon name="chevron-down" size={10} /></button>
      </span>
    </span>
  );
}
