import type { ComponentChildren, JSX } from "preact";
import { Icon } from "../core/Icon";
import type { IconName } from "../core/glyphs";
import { Spinner } from "../feedback/Spinner";
import { cx } from "../util";

const TOAST_ICON: Record<NonNullable<ToastProps["tone"]>, IconName> = { success: "success", warning: "warning", danger: "error", info: "info" };

/**
 * A brief notice in the corner, with an optional undo: its tone (info, the default; success, warning, danger) as a
 * stripe down its side and its icon in a tinted ring, the text in the normal colour so it reads in both themes.
 */
export interface ToastProps extends JSX.HTMLAttributes<HTMLDivElement> {
  tone?: "info" | "success" | "warning" | "danger";
  loading?: boolean;
  action?: { label: string; onClick?: () => void };
  onDismiss?: () => void;
  children?: ComponentChildren;
}

export function Toast({ tone, loading, action, onDismiss, children, className, ...rest }: ToastProps) {
  const t = tone ?? "info";
  return (
    <div role={t === "danger" ? "alert" : "status"} className={cx("oc-toast", `oc-toast--${t}`, className)} {...rest}>
      <span className="oc-toast__mark">{loading ? <Spinner size={14} /> : <Icon name={TOAST_ICON[t]} size={14} />}</span>
      <span className="oc-toast__text">{children}</span>
      {action && <button type="button" className="oc-toast__btn" onClick={action.onClick}>{action.label}</button>}
      {onDismiss && <button type="button" className="oc-toast__btn" aria-label="Dismiss" onClick={onDismiss}><Icon name="close" size={12} /></button>}
    </div>
  );
}
