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
  /** Alone it makes a round button; with children a pill. */
  icon?: IconName;
  label: string;
  /** A switch that is on: filled in the accent colour, so its state reads at a glance and in sunlight. */
  pressed?: boolean;
  onClick?: () => void;
  /** Short text beside or instead of the icon: a lens, a focal length, a count. */
  children?: ComponentChildren;
}

export function CameraButton({ icon, label, pressed, onClick, children }: CameraButtonProps) {
  return <button type="button" className={cx("oc-cam__btn", children != null && "oc-cam__btn--text")} aria-label={label} title={label} aria-pressed={pressed == null ? undefined : !!pressed} onClick={onClick}>{icon && <Icon name={icon} size={children != null ? 18 : 24} />}{children}</button>;
}

/** The shutter button in the camera's control bar. */
export interface ShutterProps {
  onClick?: () => void;
  label?: string;
}

export function Shutter({ onClick, label = "Take photo" }: ShutterProps) {
  return <button type="button" className="oc-cam__shutter" aria-label={label} onClick={onClick} />;
}
