/** Navigation controls from the design system (navigation.css). */
import type { ComponentChildren } from "preact";
import { cx, Icon } from "./core";

export interface SegOption<T extends string> { id: T; label?: ComponentChildren; icon?: string; title?: string }

/** Segmented switch (a pill): exactly one option is on; selected = accent fill + bold. */
export function Seg<T extends string>({ options, value, onChange, label: aria, lg }: { options: readonly SegOption<T>[]; value: T; onChange: (v: T) => void; label: string; lg?: boolean }) {
  return (
    <div class={cx("f-seg", lg && "f-seg--lg")} role="radiogroup" aria-label={aria} title={aria}>
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={o.id === value} title={o.title} class="f-seg__opt" onClick={() => onChange(o.id)}>
          {o.icon && <Icon name={o.icon} />}{o.label}
        </button>
      ))}
    </div>
  );
}
