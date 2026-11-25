import type { JSX } from "preact";
import { Icon } from "../core/Icon";
import type { IconName } from "../core/glyphs";
import { cx } from "../util";

/** Provisional app and file-type icon: a glyph on a coloured tile. The final, richer family replaces its inside in step 4; the API stays. */
export interface AppIconProps extends Omit<JSX.HTMLAttributes<HTMLSpanElement>, "color" | "size" | "label" | "style"> {
  /** UI glyph name. */
  glyph?: IconName;
  /**
   * 0 neutral, 1 to 8 categorical: a glyph on a tile of that colour. 10 to 18: the outlined tile (sunken, with a border and
   * the glyph in colour 0 to 8), so every app can have a tile of its own (#426) without leaving the palette's hues.
   */
  color?: number;
  /** 16 to 64 px. */
  size?: number;
  /** Extension that is not enabled. */
  off?: boolean;
  label?: string;
  style?: JSX.CSSProperties;
}

export function AppIcon({ glyph = "window", color = 0, size = 32, off, label, className, style, ...rest }: AppIconProps) {
  // The glyph takes about 60 % of the tile, and the space left over is always an even number of pixels, so the glyph
  // sits exactly in the middle at every size (an odd remainder puts it half a pixel off).
  const even = 2 * Math.round((size * 0.6) / 2);
  const g = size <= 16 ? 12 : (size - even) % 2 === 0 ? even : even - 1;
  return (
    <span role={label ? "img" : undefined} aria-label={label} className={cx("oc-appicon", color > 0 && color < 10 && `oc-appicon--c${color}`, color >= 10 && color <= 18 && `oc-appicon--ink oc-appicon--i${color - 10}`, off && "is-off", className)} style={{ width: size, height: size, ...style }} {...rest}>
      <Icon name={glyph} size={g} />
    </span>
  );
}
