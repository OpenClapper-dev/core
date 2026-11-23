import type { ComponentChildren, JSX } from "preact";
import { Button } from "../actions/Button";
import { cx } from "../util";

/** A modal over a window (or the screen) on a scrim. */
export interface DialogProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "title"> {
  title: ComponentChildren;
  footer?: ComponentChildren;
  onClose?: () => void;
  /** Cover the viewport instead of the nearest positioned ancestor (a window). */
  fixed?: boolean;
  children?: ComponentChildren;
}

export function Dialog({ title, footer, onClose, fixed, children, className, ...rest }: DialogProps) {
  return (
    <div className={cx("oc-scrim", fixed && "oc-scrim--fixed")} onKeyDown={(e) => { if (e.key === "Escape" && onClose) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined} className={cx("oc-dialog", className)} {...rest}>
        <div className="oc-dialog__head"><span className="oc-dialog__title">{title}</span>{onClose && <Button variant="quiet" size="sm" icon="close" label="Close" onClick={onClose} />}</div>
        <div className="oc-dialog__body">{children}</div>
        {footer && <div className="oc-dialog__foot">{footer}</div>}
      </div>
    </div>
  );
}
