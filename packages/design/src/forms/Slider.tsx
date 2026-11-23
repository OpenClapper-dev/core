import type { JSX } from "preact";
import { cx } from "../util";

/** A value in a range where the exact number matters less than the feel; pair with NumberInput for precision. */
export interface SliderProps extends Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value" | "min" | "max" | "step" | "style"> {
  value: number;
  onChange?: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  style?: JSX.CSSProperties;
}

export function Slider({ value = 0, onChange, min = 0, max = 100, step = 1, disabled, className, style, ...rest }: SliderProps) {
  const pct = ((value - min) / (max - min)) * 100;
  return <input type="range" className={cx("oc-slider", className)} style={{ ...style, "--oc-slider-pct": pct + "%" }} value={value} min={min} max={max} step={step} disabled={disabled} onInput={e => onChange && onChange(Number(e.currentTarget.value))} {...rest} />;
}
