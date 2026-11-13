import type { ComponentChildren } from "preact";
import { Kbd } from "../core/Kbd";
import { cx } from "../util";

/** A short name for an icon-only control, shown on hover and focus. */
export interface TooltipProps {
  label: ComponentChildren;
  /** Shortcut hint. */
  kbd?: string;
  side?: "top" | "bottom";
  /** Force visible. */
  open?: boolean;
  children: ComponentChildren;
  className?: string;
}

export function Tooltip({ label, kbd, side = "top", open, children, className }: TooltipProps) {
  return (
    <span className={cx("oc-tip-host", className)}>
      {children}
      <span role="tooltip" className={cx("oc-tip", side === "bottom" && "oc-tip--bottom", open && "is-open")}>{label}{kbd && <Kbd keys={kbd} />}</span>
    </span>
  );
}
