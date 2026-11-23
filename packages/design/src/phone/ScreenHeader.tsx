import type { ComponentChildren, JSX } from "preact";
import { Icon } from "../core/Icon";
import type { IconName } from "../core/glyphs";
import { cx } from "../util";

/** The 56 dp phone screen header with back button, title and up to two actions. */
export interface ScreenHeaderProps extends Omit<JSX.HTMLAttributes<HTMLElement>, "title"> {
  title: ComponentChildren;
  subtitle?: ComponentChildren;
  onBack?: () => void;
  /** HeaderAction elements. */
  actions?: ComponentChildren;
}

export function ScreenHeader({ title, subtitle, onBack, actions, className, ...rest }: ScreenHeaderProps) {
  return (
    <header className={cx("oc-m-header", className)} {...rest}>
      {onBack && <button type="button" className="oc-m-btn" aria-label="Back" onClick={onBack}><Icon name="arrow-left" size={24} /></button>}
      <div className="oc-m-header__title" style={onBack ? { paddingLeft: 0 } : undefined}>{title}{subtitle && <span className="oc-m-header__sub">{subtitle}</span>}</div>
      {actions}
    </header>
  );
}

/** A 48 dp icon action in the screen header. */
export interface HeaderActionProps {
  icon: IconName;
  label: string;
  onClick?: () => void;
}

export function HeaderAction({ icon, label, onClick }: HeaderActionProps) {
  return <button type="button" className="oc-m-btn" aria-label={label} onClick={onClick}><Icon name={icon} size={24} /></button>;
}
