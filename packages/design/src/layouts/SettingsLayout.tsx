import type { ComponentChildren, JSX } from "preact";
import type { IconName } from "../core/glyphs";
import { SidebarNav } from "../navigation/SidebarNav";
import { cx } from "../util";

/** Window template: category list on the left, a single form column on the right. */
export interface SettingsLayoutProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "onChange" | "title" | "value"> {
  /** px; the nav may shrink to 96. */
  navWidth?: number;
  sections: { label?: string; items: { id: string; label: string; icon?: IconName }[] }[];
  value?: string;
  onChange?: (id: string) => void;
  title?: ComponentChildren;
  children?: ComponentChildren;
}

export function SettingsLayout({ navWidth = 176, sections = [], value, onChange, title, children, className, ...rest }: SettingsLayoutProps) {
  return (
    <div className={cx("oc-app", className)} {...rest}>
      <div className="oc-app__body">
        <SidebarNav className="oc-app__side oc-app__side--left" style={{ width: navWidth, flexShrink: 1, minWidth: 96 }} sections={sections} value={value} onChange={onChange} />
        <div className="oc-app__settings"><div className="oc-app__settings-inner">{title && <h2>{title}</h2>}{children}</div></div>
      </div>
    </div>
  );
}

/** A titled group of fields in a settings page. */
export interface SettingsGroupProps {
  title?: ComponentChildren;
  children?: ComponentChildren;
}

export function SettingsGroup({ title, children }: SettingsGroupProps) {
  return <section className="oc-app__group">{title && <h3>{title}</h3>}{children}</section>;
}
