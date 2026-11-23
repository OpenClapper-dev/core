import type { ComponentChildren, JSX } from "preact";
import { cx } from "../util";

/** Phone screen shell: header, scrolling body, footer (tabs or action bar). React Native: a View with a ScrollView. */
export interface ScreenProps extends JSX.HTMLAttributes<HTMLDivElement> {
  header?: ComponentChildren;
  footer?: ComponentChildren;
  scroll?: boolean;
  padded?: boolean;
  children?: ComponentChildren;
}

export function Screen({ header, footer, scroll = true, padded, children, className, ...rest }: ScreenProps) {
  return (
    <div className={cx("oc-m", className)} {...rest}>
      {header}
      <div className={scroll ? "oc-m__scroll" : undefined} style={scroll ? undefined : { flex: 1, minHeight: 0, position: "relative" }}>{padded ? <div className="oc-m__pad">{children}</div> : children}</div>
      {footer}
    </div>
  );
}
