import type { ComponentChildren, JSX } from "preact";
import { Icon } from "../core/Icon";
import type { IconName } from "../core/glyphs";
import { useIndicator } from "../motion/useIndicator";
import { cx } from "../util";

/** Switch between documents or sections inside one window. Tabs are pills: they choose. */
export interface TabBarProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "onChange" | "value" | "onClose"> {
  tabs: { id: string; label: string; icon?: IconName; closable?: boolean }[];
  value: string;
  onChange?: (id: string) => void;
  onClose?: (id: string) => void;
  children?: ComponentChildren;
}

export function TabBar({ tabs = [], value, onChange, onClose, children, className, ...rest }: TabBarProps) {
  const [ref, indicator] = useIndicator<HTMLDivElement>('[aria-selected="true"]', value);
  return (
    <div ref={ref} role="tablist" className={cx("oc-tabs", "oc-has-ind", className)} {...rest}>
      {indicator}
      {tabs.map(t => (
        <button key={t.id} type="button" role="tab" aria-selected={t.id === value} className="oc-tab" onClick={() => onChange && onChange(t.id)}>
          {t.icon && <Icon name={t.icon} />}{t.label}
          {t.closable && <span className="oc-tab__x" role="button" aria-label={"Close " + t.label} onClick={e => { e.stopPropagation(); if (onClose) onClose(t.id); }}><Icon name="close" size={10} /></span>}
        </button>
      ))}
      {children}
    </div>
  );
}
