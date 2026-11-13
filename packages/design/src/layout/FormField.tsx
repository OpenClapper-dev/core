import type { ComponentChildren, JSX } from "preact";
import { Icon } from "../core/Icon";
import { cx } from "../util";

/** Wraps one input with its label, hint and error. */
export interface FormFieldProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "label"> {
  label?: ComponentChildren;
  hint?: ComponentChildren;
  /** Replaces the hint; shown with a warning icon. */
  error?: ComponentChildren;
  required?: boolean;
  htmlFor?: string;
  children?: ComponentChildren;
}

export function FormField({ label, hint, error, required, htmlFor, children, className, ...rest }: FormFieldProps) {
  return (
    <div className={cx("oc-field", className)} {...rest}>
      {label && <label className="oc-field__label" htmlFor={htmlFor}>{label}{required && <span className="oc-field__req">required</span>}</label>}
      {children}
      {error ? <span className="oc-field__error" role="alert"><Icon name="warning" size={12} />{error}</span> : hint && <span className="oc-field__hint">{hint}</span>}
    </div>
  );
}
