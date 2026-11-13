import { useEffect } from "preact/hooks";
import { Menu, type MenuProps } from "./Menu";

/** A menu at the pointer, opened by right-click; closes on outside press or Escape. */
export interface ContextMenuProps extends Omit<MenuProps, "items" | "onSelect"> {
  items: MenuProps["items"];
  x: number;
  y: number;
  onSelect?: (id: string) => void;
  onClose?: () => void;
}

export function ContextMenu({ items = [], x = 0, y = 0, onSelect, onClose, ...rest }: ContextMenuProps) {
  useEffect(() => {
    if (!onClose) return undefined;
    const close = (e: Event) => { if (e.type !== "keydown" || (e as KeyboardEvent).key === "Escape") onClose(); };
    document.addEventListener("pointerdown", close); document.addEventListener("keydown", close);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", close); };
  }, [onClose]);
  return <Menu className="oc-menu--context" style={{ left: x, top: y }} items={items} onSelect={onSelect} onPointerDown={(e) => e.stopPropagation()} {...rest} />;
}
