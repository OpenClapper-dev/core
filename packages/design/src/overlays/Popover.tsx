import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { cx } from "../util";

/** A small non-modal surface anchored to a control, for a few fields or details. */
export interface PopoverProps {
  trigger: ComponentChildren;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  align?: "start" | "end";
  children?: ComponentChildren;
  className?: string;
}

export function Popover({ trigger, open, defaultOpen, onOpenChange, align = "start", children, className }: PopoverProps) {
  const [inner, setInner] = useState(!!defaultOpen);
  const shown = open != null ? open : inner;
  const set = (v: boolean) => { setInner(v); if (onOpenChange) onOpenChange(v); };
  return (
    <span className={cx("oc-menu-host", align === "end" && "oc-menu-host--end")} onKeyDown={(e) => { if (e.key === "Escape") set(false); }}>
      <span onClick={() => set(!shown)} style={{ display: "inline-flex" }}>{trigger}</span>
      {shown && <div role="dialog" className={cx("oc-popover", className)}>{children}</div>}
    </span>
  );
}
