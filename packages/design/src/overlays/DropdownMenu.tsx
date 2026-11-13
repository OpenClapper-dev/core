import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { Button } from "../actions/Button";
import type { IconName } from "../core/glyphs";
import { cx } from "../util";
import { Menu, type MenuItemData } from "./Menu";

/** A button that opens a menu below it. */
export interface DropdownMenuProps {
  label?: ComponentChildren;
  icon?: IconName;
  variant?: "secondary" | "primary" | "quiet";
  size?: "sm" | "md" | "lg";
  items: MenuItemData[];
  onSelect?: (id: string) => void;
  align?: "start" | "end";
  defaultOpen?: boolean;
  className?: string;
}

export function DropdownMenu({ label, icon, variant = "secondary", size = "md", items = [], onSelect, align = "start", defaultOpen, className }: DropdownMenuProps) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <span className={cx("oc-menu-host", align === "end" && "oc-menu-host--end", className)} onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}>
      <Button variant={variant} size={size} icon={icon} iconAfter={label ? "chevron-down" : undefined} label={label ? undefined : "Menu"} aria-haspopup="menu" aria-expanded={open} selected={open || undefined} onClick={() => setOpen((o) => !o)}>{label}</Button>
      {open && <Menu items={items} onSelect={(id) => { setOpen(false); if (onSelect) onSelect(id); }} />}
    </span>
  );
}
