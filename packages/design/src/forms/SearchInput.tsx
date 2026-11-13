import type { JSX } from "preact";
import { Icon } from "../core/Icon";
import { Kbd } from "../core/Kbd";
import { cx } from "../util";

/** Clicks on the field chrome focus the input instead of blurring it. */
const ocFocusIn = (e: JSX.TargetedMouseEvent<HTMLElement>) => { if ((e.target as Element).closest("button,input,select,textarea")) return; const i = e.currentTarget.querySelector("input"); if (i && !i.disabled) { e.preventDefault(); i.focus(); } };

/** A search field with a clear button and an optional shortcut hint. */
export interface SearchInputProps extends Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "size" | "value" | "onChange"> {
  value: string;
  onChange?: (value: string) => void;
  /** Shortcut hint shown while empty. */
  kbd?: string;
  size?: "sm" | "md" | "lg";
}

export function SearchInput({ value, onChange, placeholder = "Search", kbd, size = "md", disabled, className, style, ...rest }: SearchInputProps) {
  return (
    <span className={cx("oc-input", size !== "md" && "oc-input--" + size, disabled && "is-disabled", className)} style={style} onMouseDown={ocFocusIn}>
      <Icon name="search" />
      <input className="oc-input__el" type="text" role="searchbox" value={value} placeholder={placeholder} disabled={disabled} onInput={e => onChange && onChange(e.currentTarget.value)} {...rest} />
      {value ? <button type="button" className="oc-input__btn" aria-label="Clear" onClick={() => onChange && onChange("")}><Icon name="close" size={12} /></button> : kbd && <Kbd keys={kbd} />}
    </span>
  );
}
