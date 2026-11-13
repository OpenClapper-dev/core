import type { JSX } from "preact";
import { useState } from "preact/hooks";
import { Icon } from "../core/Icon";
import { cx } from "../util";

/** Pick one from a long list by typing; arrow keys move the cursor, Enter picks. */
export interface ComboboxProps {
  options: { value: string; label: string }[];
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  size?: "sm" | "md" | "lg";
  invalid?: boolean;
  disabled?: boolean;
  defaultOpen?: boolean;
  className?: string;
  style?: JSX.CSSProperties;
}

export function Combobox({ options = [], value, onChange, placeholder, size = "md", invalid, disabled, defaultOpen, className, style }: ComboboxProps) {
  const [open, setOpen] = useState(!!defaultOpen);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const current = options.find(o => o.value === value);
  const shown = options.filter(o => o.label.toLowerCase().includes(query.toLowerCase()));
  const pick = (o: { value: string }) => { if (onChange) onChange(o.value); setOpen(false); setQuery(""); };
  const onKey = (e: JSX.TargetedKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setCursor(c => Math.min(c + 1, shown.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); }
    else if (e.key === "Enter" && open && shown[cursor]) { e.preventDefault(); pick(shown[cursor]); }
    else if (e.key === "Escape") { setOpen(false); setQuery(""); }
  };
  const onDown = (e: JSX.TargetedMouseEvent<HTMLSpanElement>) => {
    if (disabled || (e.target as Element).closest(".oc-listbox")) return;
    const inp = e.currentTarget.querySelector("input");
    if (!inp || e.target === inp) return;
    e.preventDefault();
    if (document.activeElement === inp) setOpen(o => !o); else inp.focus();
  };
  return (
    <span className="oc-combo" style={style} onMouseDown={onDown}>
      <span className={cx("oc-input", size !== "md" && "oc-input--" + size, invalid && "is-invalid", disabled && "is-disabled", className)}>
        <input className="oc-input__el" role="combobox" aria-expanded={open} aria-invalid={invalid || undefined} disabled={disabled} placeholder={placeholder}
          value={open && query ? query : (current && !query ? current.label : query)}
          onFocus={() => setOpen(true)} onClick={() => setOpen(true)} onBlur={() => { setOpen(false); setQuery(""); }}
          onInput={e => { setQuery(e.currentTarget.value); setCursor(0); setOpen(true); }} onKeyDown={onKey} />
        <Icon name="chevron-down" />
      </span>
      {open && (
        <ul className="oc-listbox" role="listbox">
          {shown.length ? shown.map((o, i) => (
            <li key={o.value} role="option" aria-selected={o.value === value} className={cx("oc-option", i === cursor && "is-cursor")}
              onMouseDown={e => { e.preventDefault(); pick(o); }} onMouseEnter={() => setCursor(i)}>
              <Icon name="check" className="oc-option__check" />{o.label}
            </li>
          )) : <li className="oc-option oc-option--empty">No matches</li>}
        </ul>
      )}
    </span>
  );
}
