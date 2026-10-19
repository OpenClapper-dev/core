/**
 * Form controls from the design system (forms.css): field, input, search, checkbox, switch,
 * select, chips, light chips. The combobox lives in Combobox.tsx.
 */
import { Fragment } from "preact";
import type { ComponentChildren, JSX, Ref } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { LIGHT, PHASE_ICONS, label } from "@fielder/vocab";
import { IconButton } from "./actions";
import { cx, Icon, Kbd } from "./core";
import { ErrorLine } from "./feedback";
import { useDropDirection, useOutsideClick } from "./hooks";

export interface SelectOption { value: string; label: string; /** Heading shown above the first option of a group. */ group?: string }

/**
 * A single choice in the design-system look (a native <select> list can't be styled). The
 * trigger is an f-pick; the list an f-menu below it. Keys on the trigger: ↓/Enter/Space open,
 * ↑/↓/Home/End move, Enter picks, Esc closes, a letter jumps to the next match. While open,
 * page shortcuts pause (data-overlay).
 */
export function Select({ value, options, onChange, label: aria, prefix, icon, width }: { value: string; options: readonly SelectOption[]; onChange: (v: string) => void; label: string; /** Bold word before the value ("Rig"). */ prefix?: string; icon?: string; width?: string }) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const sel = Math.max(0, options.findIndex((o) => o.value === value));
  const current = options.find((o) => o.value === value);
  useEffect(() => { if (open) setHi(sel); }, [open]);
  useOutsideClick(() => box.current, () => setOpen(false), open);
  useDropDirection(list, open);
  useEffect(() => { if (open) list.current?.querySelector(".is-hi")?.scrollIntoView({ block: "nearest" }); }, [hi, open]);
  const pick = (i: number) => { const o = options[i]; if (o) onChange(o.value); setOpen(false); };
  const onKey = (e: KeyboardEvent) => {
    const k = e.key;
    let used = true;
    if (!open) {
      if (k === "ArrowDown" || k === "ArrowUp" || k === "Enter" || k === " ") setOpen(true); else used = false;
    } else if (k === "ArrowDown") setHi((h) => Math.min(options.length - 1, h + 1));
    else if (k === "ArrowUp") setHi((h) => Math.max(0, h - 1));
    else if (k === "Home") setHi(0);
    else if (k === "End") setHi(options.length - 1);
    else if (k === "Enter" || k === " ") pick(hi);
    else if (k === "Escape" || k === "Tab") { setOpen(false); used = k === "Escape"; }
    else if (k.length === 1 && /\S/.test(k)) {
      const from = open ? hi : sel;
      const order = [...options.slice(from + 1), ...options.slice(0, from + 1)];
      const hit = order.find((o) => o.label.toLowerCase().startsWith(k.toLowerCase()));
      if (hit) setHi(options.indexOf(hit)); else used = false;
    } else used = false;
    if (used) { e.preventDefault(); e.stopPropagation(); }
  };
  return (
    <div ref={box} class="f-select" style={{ width }}>
      <button type="button" class="f-pick" style={{ width: "100%" }} aria-haspopup="listbox" aria-expanded={open} aria-label={`${aria}: ${current?.label ?? ""}`}
        onClick={() => setOpen(!open)} onKeyDown={onKey}>
        {icon && <Icon name={icon} />}{prefix && <b>{prefix}</b>}<span>{current?.label ?? ""}</span><Icon name="chevron-down" />
      </button>
      {open && (
        <div ref={list} class="f-menu f-select__list" role="listbox" aria-label={aria} data-overlay>
          {options.map((o, i) => (
            <Fragment key={o.value}>
              {o.group && o.group !== options[i - 1]?.group && <span class="f-menu__label">{o.group}</span>}
              <button type="button" role="option" aria-selected={i === sel} tabIndex={-1} class={cx("f-menu__item", i === sel && "is-sel", i === hi && "is-hi")}
                onMouseEnter={() => setHi(i)} onClick={() => pick(i)}>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{o.label}</span>{i === sel && <Icon name="check" />}
              </button>
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

/** Multi-select pill. Selected = accent fill + bold + leading check, so it never relies on colour. */
export function Chip({ selected, icon, onClick, children, disabled, title }: { selected?: boolean; icon?: string; onClick?: () => void; children: ComponentChildren; disabled?: boolean; title?: string }) {
  return (
    <button type="button" class="f-chip" aria-pressed={!!selected} disabled={disabled} title={title} onClick={onClick}>
      {selected && <Icon name="check" />}{icon && <Icon name={icon} />}{children}
    </button>
  );
}

/** Light phases (any subset) plus the separate Artificial flag. */
export function LightChips({ light, artificial, onChange }: { light: readonly string[]; artificial: boolean; onChange: (light: string[], artificial: boolean) => void }) {
  return (
    <div class="f-chips" role="group" aria-label="Light">
      {LIGHT.map((p) => (
        <Chip key={p} icon={light.includes(p) ? undefined : PHASE_ICONS[p]} selected={light.includes(p)} onClick={() => onChange(LIGHT.filter((x) => (x === p ? !light.includes(x) : light.includes(x))), artificial)}>{label(p)}</Chip>
      ))}
      <Chip icon={artificial ? undefined : PHASE_ICONS.artificial} selected={artificial} onClick={() => onChange([...light], !artificial)}>Artificial</Chip>
    </div>
  );
}

/**
 * A labelled form field (f-field): label, the control(s), then an error line and a help text.
 * Renders a <label> so a click on the label focuses the control; use `as="div"` when the
 * children hold more than one control or a component that is not a plain input.
 */
export function Field({ label: text, help, error, as = "label", labelStyle, class: extra, style, children }: {
  label: ComponentChildren; help?: ComponentChildren; error?: ComponentChildren | null; as?: "label" | "div";
  labelStyle?: JSX.CSSProperties; class?: string; style?: JSX.CSSProperties; children: ComponentChildren;
}) {
  const Tag = as;
  return (
    <Tag class={cx("f-field", extra)} style={style}>
      <span class="f-field__label" style={labelStyle}>{text}</span>
      {children}
      {error && <ErrorLine>{error}</ErrorLine>}
      {help && <span class="f-field__help">{help}</span>}
    </Tag>
  );
}

export interface InputProps extends Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "size" | "ref"> {
  /** 32 px high (toolbars, panels, rule builder). */
  sm?: boolean;
  /** Red border; pair it with an ErrorLine that says what is wrong. */
  invalid?: boolean;
  /** Unit after the value, e.g. "mm". */
  unit?: string;
  /** Anything else inside the box after the input (a key hint, a clear button). */
  after?: ComponentChildren;
  /** Wrapper element: span (default, inside a Field) or label (stand-alone, so the box focuses the input). */
  box?: "span" | "label";
  boxClass?: string;
  boxStyle?: JSX.CSSProperties;
  inputRef?: Ref<HTMLInputElement>;
}

/** Text or number input in the f-input box. Disabled also dashes the box. */
export function Input({ sm, invalid, unit, after, box = "span", boxClass, boxStyle, inputRef, disabled, ...rest }: InputProps) {
  const Box = box;
  return (
    <Box class={cx("f-input", sm && "f-input--sm", boxClass, invalid && "is-error", disabled && "is-disabled")} style={boxStyle}>
      <input ref={inputRef} disabled={disabled} {...rest} />
      {unit && <span class="f-input__unit">{unit}</span>}
      {after}
    </Box>
  );
}

/**
 * A password input with an eye button beside it that shows what was typed (issue #144: passwords are
 * easy to mistype), as on the phone. Hidden again on every mount; only the input's type flips, so
 * autofill keeps working.
 */
export function PasswordInput({ boxClass, ...props }: Omit<InputProps, "type" | "after">) {
  const [shown, setShown] = useState(false);
  const label = shown ? "Hide password" : "Show password";
  return (
    <span class="f-password">
      <Input {...props} boxClass={cx("f-password__input", boxClass)} type={shown ? "text" : "password"} autocapitalize="off" spellcheck={false} />
      <IconButton kind="secondary" size={props.sm ? "sm" : "md"} icon={shown ? "eye-off-outline" : "eye-outline"} label={label} title={label} aria-pressed={shown} disabled={props.disabled} onClick={() => setShown((v) => !v)} />
    </span>
  );
}

/** The toolbar search box: magnifier, input, and the "/" key hint unless `after` replaces it (e.g. a clear button). */
export function SearchInput({ after, inputRef, ...rest }: Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "ref"> & { after?: ComponentChildren; inputRef?: Ref<HTMLInputElement> }) {
  return (
    <label class="f-input f-input--sm f-input--search">
      <Icon name="magnify" class="f-input__icon" />
      <input ref={inputRef} {...rest} />
      {after === undefined ? <Kbd>/</Kbd> : after}
    </label>
  );
}

/**
 * Checkbox (f-check): checked = accent box + check icon, indeterminate = a minus. A <button> by
 * default; `as="span"` when a surrounding element (a table cell, a menu item) handles the click.
 */
export function Checkbox({ checked, indeterminate, as = "button", children, class: extra, ...rest }: Omit<JSX.HTMLAttributes<HTMLDivElement>, "as" | "ref"> & { checked: boolean; indeterminate?: boolean; as?: "button" | "span"; children?: ComponentChildren }) {
  // One element type for TypeScript; the runtime tag is a button or a span.
  const Tag = as as "div";
  return (
    <Tag {...(as === "button" ? { type: "button" } : {})} class={cx("f-check", checked && "is-checked", indeterminate && "is-indeterminate", extra as string | undefined)} {...rest}>
      <span class="f-check__box">{checked ? <Icon name="check" /> : indeterminate ? <Icon name="minus" /> : null}</span>{children}
    </Tag>
  );
}

/** On/off switch (f-switch) with its label; on = accent track + check in the knob. */
export function Switch({ on, onClick, children }: { on: boolean; onClick: () => void; children: ComponentChildren }) {
  return (
    <button type="button" class={cx("f-switch", on && "is-on")} role="switch" aria-checked={on} onClick={onClick}>
      <span class="f-switch__track"><span class="f-switch__knob">{on && <Icon name="check" />}</span></span>{children}
    </button>
  );
}
