import type { ComponentChildren, JSX } from "preact";
import { Icon } from "../core/Icon";
import type { IconName } from "../core/glyphs";
import { Spinner } from "../feedback/Spinner";
import { cx } from "../util";

const TOAST_ICON: Record<NonNullable<ToastProps["tone"]>, IconName> = { success: "success", warning: "warning", danger: "error", info: "info" };

/** A brief confirmation in the corner, on the inverse surface, with an optional undo. */
export interface ToastProps extends JSX.HTMLAttributes<HTMLDivElement> {
  tone?: "info" | "success" | "warning" | "danger";
  loading?: boolean;
  action?: { label: string; onClick?: () => void };
  onDismiss?: () => void;
  children?: ComponentChildren;
}

export function Toast({ tone, loading, action, onDismiss, children, className, ...rest }: ToastProps) {
  return (
    <div role="status" className={cx("oc-toast", className)} {...rest}>
      {loading ? <Spinner size={14} /> : tone && <Icon name={TOAST_ICON[tone]} />}
      <span className="oc-toast__text">{children}</span>
      {action && <button type="button" className="oc-toast__btn" onClick={action.onClick}>{action.label}</button>}
      {onDismiss && <button type="button" className="oc-toast__btn" aria-label="Dismiss" onClick={onDismiss}><Icon name="close" size={12} /></button>}
    </div>
  );
}
