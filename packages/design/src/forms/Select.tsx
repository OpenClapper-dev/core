import type { JSX } from "preact";
import { useRef, useState } from "preact/hooks";
import { Icon } from "../core/Icon";
import { Floating } from "../overlays/Floating";
import { cx } from "../util";

/**
 * Pick one from a short fixed list. The list is the design system's own (the same listbox as the combobox), not the
 * browser's menu, so it looks the same everywhere and in both themes. It floats above panels and dialogs and opens upward when there is no room below.
 */
export interface SelectProps extends Omit<JSX.HTMLAttributes<HTMLButtonElement>, "size" | "value" | "onChange" | "style"> {
  options: { value: string; label: string }[];
  value?: string;
  onChange?: (value: string) => void;
  size?: "sm" | "md" | "lg";
  invalid?: boolean;
  disabled?: boolean;
  style?: JSX.CSSProperties;
}

export function Select({ options = [], value, onChange, size = "md", invalid, disabled, className, style, ...rest }: SelectProps) {
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const host = useRef<HTMLSpanElement>(null);
  const current = options.find(o => o.value === value);
  const show = () => {
    if (disabled) return;
    setCursor(Math.max(0, options.findIndex(o => o.value === value)));
    setOpen(true);
  };
  const pick = (i: number) => { const o = options[i]; if (o && onChange && o.value !== value) onChange(o.value); setOpen(false); };
  const onKey = (e: JSX.TargetedKeyboardEvent<HTMLButtonElement>) => {
    if (!open) { if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) { e.preventDefault(); show(); } return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor(c => Math.min(c + 1, options.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); }
    else if (e.key === "Home") { e.preventDefault(); setCursor(0); }
    else if (e.key === "End") { e.preventDefault(); setCursor(options.length - 1); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(cursor); }
    else if (e.key === "Escape" || e.key === "Tab") setOpen(false);
    else if (e.key.length === 1) { const i = options.findIndex(o => o.label.toLowerCase().startsWith(e.key.toLowerCase())); if (i >= 0) setCursor(i); }
  };
  return (
    <span ref={host} className={cx("oc-selectbox", className)} style={style}>
      <button type="button" role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-invalid={invalid || undefined} disabled={disabled}
        className={cx("oc-input", size !== "md" && "oc-input--" + size, invalid && "is-invalid", disabled && "is-disabled", "oc-select")}
        onClick={() => (open ? setOpen(false) : show())} onKeyDown={onKey} onBlur={() => setOpen(false)} {...rest}>
        <span className="oc-select__value">{current ? current.label : ""}</span>
        <Icon name="chevron-down" />
      </button>
      {open && (
        <Floating anchor={host} matchWidth onDismiss={() => setOpen(false)}><ul className="oc-listbox" role="listbox">
          {options.map((o, i) => (
            <li key={o.value} role="option" aria-selected={o.value === value} className={cx("oc-option", i === cursor && "is-cursor")}
              onMouseDown={e => { e.preventDefault(); pick(i); }} onMouseEnter={() => setCursor(i)}>
              <Icon name="check" className="oc-option__check" />{o.label}
            </li>
          ))}
        </ul></Floating>
      )}
    </span>
  );
}
