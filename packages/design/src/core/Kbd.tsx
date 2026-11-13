import type { JSX } from "preact";
import { cx } from "../util";

/** The standard look of a keyboard-shortcut hint, in menus, tooltips and search fields. */
export interface KbdProps extends JSX.HTMLAttributes<HTMLElement> {
  /** "Ctrl+K" or ["Ctrl", "K"]. */
  keys: string | string[];
}

export function Kbd({ keys, className, ...rest }: KbdProps) {
  const list = Array.isArray(keys) ? keys : keys.split("+");
  return <kbd className={cx("oc-kbd", className)} {...rest}>{list.map((k, i) => <span key={i} className="oc-kbd__key">{k}</span>)}</kbd>;
}
