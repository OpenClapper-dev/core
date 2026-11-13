import type { JSX } from "preact";
import { cx } from "../util";

/** Multi-line text. */
export interface TextAreaProps extends JSX.TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export function TextArea({ invalid, className, rows = 3, ...rest }: TextAreaProps) {
  return <textarea className={cx("oc-textarea", invalid && "is-invalid", className)} rows={rows} aria-invalid={invalid || undefined} {...rest} />;
}
