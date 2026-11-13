import type { ComponentChildren, JSX } from "preact";
import { Icon } from "../core/Icon";
import { cx } from "../util";

/** A sheet from the bottom edge for options and short tasks; reachable with one thumb. */
export interface BottomSheetProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "title"> {
  title?: ComponentChildren;
  onClose?: () => void;
  children?: ComponentChildren;
}

export function BottomSheet({ title, onClose, children, className, ...rest }: BottomSheetProps) {
  return (
    <div className="oc-m-sheet-scrim" onClick={(e) => { if (e.target === e.currentTarget && onClose) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined} className={cx("oc-m-sheet", className)} {...rest}>
        <span className="oc-m-sheet__grip" />
        {(title || onClose) && <div className="oc-m-sheet__head"><span>{title}</span>{onClose && <button type="button" className="oc-m-btn" aria-label="Close" onClick={onClose}><Icon name="close" size={24} /></button>}</div>}
        <div className="oc-m-sheet__body">{children}</div>
      </div>
    </div>
  );
}
