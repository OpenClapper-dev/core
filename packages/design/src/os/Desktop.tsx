import type { ComponentChildren, JSX } from "preact";
import { cx } from "../util";

/** The desktop surface: icon grid, selection rectangle, snap preview, windows, taskbar. */
export interface DesktopProps extends JSX.HTMLAttributes<HTMLDivElement> {
  taskbarEdge?: "bottom" | "top" | "left" | "right";
  /** FileTile elements. */
  icons?: ComponentChildren;
  marquee?: { x: number; y: number; w: number; h: number };
  snapPreview?: JSX.CSSProperties;
  taskbar?: ComponentChildren;
  /** Launcher, task view, toasts. */
  overlay?: ComponentChildren;
  /** Windows. */
  children?: ComponentChildren;
}

export function Desktop({ taskbarEdge = "bottom", icons, marquee, snapPreview, taskbar, overlay, children, className, ...rest }: DesktopProps) {
  return (
    <div className={cx("oc-desktop", `oc-desktop--${taskbarEdge}`, className)} {...rest}>
      <div className="oc-desktop__area">
        {icons && <div className="oc-desktop__icons">{icons}</div>}
        {marquee && <div className="oc-marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />}
        {children}
        {snapPreview && <div className="oc-snap-preview" style={snapPreview} />}
      </div>
      {taskbar}
      {overlay}
    </div>
  );
}

/** The grip between two snapped windows. */
export function SnapGrip(props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" role="separator" aria-orientation="vertical" aria-label="Resize snapped windows" className="oc-snapgrip" {...props} />;
}
