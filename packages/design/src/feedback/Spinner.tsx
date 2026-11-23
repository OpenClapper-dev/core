import type { JSX } from "preact";
import { cx } from "../util";

/** Indeterminate activity inside a control or a row. */
export interface SpinnerProps extends Omit<JSX.SVGAttributes<SVGSVGElement>, "size"> {
  size?: number;
  label?: string;
}

export function Spinner({ size = 16, label = "Loading", className, ...rest }: SpinnerProps) {
  return (
    <svg className={cx("oc-spinner", className)} width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" role="img" aria-label={label} {...rest}>
      <circle cx="8" cy="8" r="6" opacity=".25" />
      <path d="M8 2a6 6 0 0 1 6 6" stroke-linecap="round" />
    </svg>
  );
}
