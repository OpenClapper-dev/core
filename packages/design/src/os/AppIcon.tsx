import type { JSX } from "preact";
import { Icon } from "../core/Icon";
import type { IconName } from "../core/glyphs";
import { cx } from "../util";

/** Provisional app and file-type icon: a glyph on a coloured tile. The final, richer family replaces its inside in step 4; the API stays. */
export interface AppIconProps extends Omit<JSX.HTMLAttributes<HTMLSpanElement>, "color" | "size" | "label" | "style"> {
  /** UI glyph name. */
  glyph?: IconName;
  /** 0 neutral, 1 to 8 categorical. */
  color?: number;
  /** 16 to 64 px. */
  size?: number;
  /** Extension that is not enabled. */
  off?: boolean;
  label?: string;
  style?: JSX.CSSProperties;
}

export function AppIcon({ glyph = "window", color = 0, size = 32, off, label, className, style, ...rest }: AppIconProps) {
  const g = size <= 16 ? 12 : size <= 24 ? 16 : Math.round(size * 0.56);
  return (
    <span role={label ? "img" : undefined} aria-label={label} className={cx("oc-appicon", color > 0 && `oc-appicon--c${color}`, off && "is-off", className)} style={{ width: size, height: size, ...style }} {...rest}>
      <Icon name={glyph} size={g} />
    </span>
  );
}
