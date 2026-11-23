import type { ComponentChildren, JSX } from "preact";
import { Icon } from "../core/Icon";
import { cx } from "../util";

/** Inline navigation inside text; always underlined. */
export interface LinkProps extends JSX.AnchorHTMLAttributes<HTMLAnchorElement> {
  external?: boolean;
  disabled?: boolean;
  children?: ComponentChildren;
}

export function Link({ href, external, disabled, children, className, ...rest }: LinkProps) {
  return (
    <a className={cx("oc-link", className)} href={disabled ? undefined : href} aria-disabled={disabled || undefined}
      target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined} {...rest}>
      {children}{external && <Icon name="external" size={12} />}
    </a>
  );
}
