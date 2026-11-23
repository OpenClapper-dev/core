import type { ComponentChildren, JSX } from "preact";
import { cx } from "../util";

/** A bordered group for one object or one settings block. No shadow; never nest cards. */
export interface CardProps extends Omit<JSX.HTMLAttributes<HTMLElement>, "title" | "onClick"> {
  title?: ComponentChildren;
  actions?: ComponentChildren;
  footer?: ComponentChildren;
  /** With onClick the card is a button. */
  selected?: boolean;
  onClick?: () => void;
  children?: ComponentChildren;
}

export function Card({ title, actions, footer, selected, onClick, children, className, ...rest }: CardProps) {
  const Tag = (onClick ? "button" : "div") as "button";
  return (
    <Tag type={onClick ? "button" : undefined} onClick={onClick} aria-pressed={onClick && selected != null ? !!selected : undefined} className={cx("oc-card", selected && "is-selected", className)} {...(rest as JSX.ButtonHTMLAttributes<HTMLButtonElement>)}>
      {(title || actions) && <div className="oc-card__head"><span className="oc-card__title">{title}</span>{actions}</div>}
      {children != null && <div className="oc-card__body">{children}</div>}
      {footer && <div className="oc-card__foot">{footer}</div>}
    </Tag>
  );
}
