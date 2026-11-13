import type { JSX } from "preact";
import { cx } from "../util";

/** A decorative hairline between groups; never the only boundary of a control. */
export interface DividerProps extends JSX.HTMLAttributes<HTMLHRElement> {
  orientation?: "horizontal" | "vertical";
}

export function Divider({ orientation = "horizontal", className, ...rest }: DividerProps) {
  return <hr className={cx("oc-divider", orientation === "vertical" ? "oc-divider--v" : "oc-divider--h", className)} aria-orientation={orientation} {...rest} />;
}
