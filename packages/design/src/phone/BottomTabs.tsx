import type { JSX } from "preact";
import { Icon } from "../core/Icon";
import type { IconName } from "../core/glyphs";
import { useIndicator } from "../motion/useIndicator";
import { cx } from "../util";

/** Phone bottom navigation, 3 to 5 destinations. Selected = pill + bold label. */
export interface BottomTabsProps extends Omit<JSX.HTMLAttributes<HTMLElement>, "onChange" | "value"> {
  tabs: { id: string; label: string; icon: IconName }[];
  value: string;
  onChange?: (id: string) => void;
}

export function BottomTabs({ tabs = [], value, onChange, className, ...rest }: BottomTabsProps) {
  const [ref, indicator] = useIndicator<HTMLElement>('[aria-selected="true"] .oc-m-tab__pill', value);
  return (
    <nav ref={ref} role="tablist" className={cx("oc-m-tabs", "oc-has-ind", className)} {...rest}>
      {indicator}
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={t.id === value} className="oc-m-tab" onClick={() => onChange && onChange(t.id)}>
          <span className="oc-m-tab__pill"><Icon name={t.icon} size={22} /></span>{t.label}
        </button>
      ))}
    </nav>
  );
}
