import type { JSX } from "preact";
import { cx } from "../util";

/** Progress of a known or unknown length. */
export interface ProgressBarProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "value" | "max" | "label"> {
  /** Omit for indeterminate. */
  value?: number;
  max?: number;
  label?: string;
  showValue?: boolean;
}

export function ProgressBar({ value, max = 100, label, showValue, className, ...rest }: ProgressBarProps) {
  const ind = value == null;
  const pct = ind ? 0 : Math.round((value / max) * 100);
  const bar = (
    <div className={cx("oc-progress", ind && "oc-progress--indeterminate", !showValue && className)} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={ind ? undefined : value} {...rest}>
      <div className="oc-progress__bar" style={ind ? undefined : { width: pct + "%" }} />
    </div>
  );
  return showValue ? <div className={cx("oc-progress-row", className)}>{bar}<span>{ind ? "…" : pct + " %"}</span></div> : bar;
}
