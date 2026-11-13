import type { ComponentChildren, JSX } from "preact";
import { Icon } from "../core/Icon";
import type { IconName } from "../core/glyphs";
import { cx } from "../util";

/** Full-screen camera: the view on black between two configurable control bars, in fixed over-content colours. */
export interface CameraLayoutProps extends JSX.HTMLAttributes<HTMLDivElement> {
  orientation?: "portrait" | "landscape";
  /** Top bar (portrait) or left bar (landscape). */
  barA?: ComponentChildren;
  /** Bottom bar (portrait) or right bar (landscape); holds the shutter. */
  barB?: ComponentChildren;
  children?: ComponentChildren;
}

export function CameraLayout({ orientation = "portrait", barA, barB, children, className, ...rest }: CameraLayoutProps) {
  return (
    <div className={cx("oc-cam", `oc-cam--${orientation}`, className)} {...rest}>
      {barA && <div className="oc-cam__bar oc-cam__bar--a">{barA}</div>}
      <div className="oc-cam__view">{children}</div>
      {barB && <div className="oc-cam__bar oc-cam__bar--b">{barB}</div>}
    </div>
  );
}

/** An icon button in a camera bar; a toggle when `pressed` is set. */
export interface CameraButtonProps {
  icon: IconName;
  label: string;
  pressed?: boolean;
  onClick?: () => void;
}

export function CameraButton({ icon, label, pressed, onClick }: CameraButtonProps) {
  return <button type="button" className="oc-cam__btn" aria-label={label} aria-pressed={pressed == null ? undefined : !!pressed} onClick={onClick}><Icon name={icon} size={24} /></button>;
}

/** The shutter button in the camera's control bar. */
export interface ShutterProps {
  onClick?: () => void;
  label?: string;
}

export function Shutter({ onClick, label = "Take photo" }: ShutterProps) {
  return <button type="button" className="oc-cam__shutter" aria-label={label} onClick={onClick} />;
}
