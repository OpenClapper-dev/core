import type { ComponentChildren } from "preact";
import { useRef, useState } from "preact/hooks";
import { Floating } from "./Floating";
import { cx } from "../util";

/** A small non-modal surface anchored to a control, for a few fields or details. */
export interface PopoverProps {
  trigger: ComponentChildren;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  align?: "start" | "end";
  /** The widest it may get, in px (default 280): a few fields fit the default, a small form needs more. */
  maxWidth?: number;
  children?: ComponentChildren;
  className?: string;
}

export function Popover({ trigger, open, defaultOpen, onOpenChange, align = "start", maxWidth, children, className }: PopoverProps) {
  const [inner, setInner] = useState(!!defaultOpen);
  const shown = open != null ? open : inner;
  const host = useRef<HTMLSpanElement>(null);
  const set = (v: boolean) => { setInner(v); if (onOpenChange) onOpenChange(v); };
  return (
    <span ref={host} className={cx("oc-menu-host", align === "end" && "oc-menu-host--end")} onKeyDown={(e) => { if (e.key === "Escape") set(false); }}>
      <span onClick={() => set(!shown)} style={{ display: "inline-flex" }}>{trigger}</span>
      {shown && <Floating anchor={host} align={align} onDismiss={() => set(false)}><div role="dialog" className={cx("oc-popover", className)} style={maxWidth ? { maxWidth } : undefined}>{children}</div></Floating>}
    </span>
  );
}
