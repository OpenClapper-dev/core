import type { JSX } from "preact";
import { Icon } from "../core/Icon";
import type { IconName } from "../core/glyphs";
import { cx } from "../util";

/** App and file-type icon: a small clapperboard after the OpenClapper mark, the same in both themes. */
export interface AppIconProps extends Omit<JSX.HTMLAttributes<HTMLSpanElement>, "color" | "size" | "label" | "style"> {
  /** UI glyph name, drawn on the board. */
  glyph?: IconName;
  /**
   * The clapstick's colour: 0 light grey, 1 to 8 the categorical hues, 9 green, 10 cyan, 11 violet, 12 dark grey,
   * so every app can have its own (#426) on one tile drawing.
   */
  color?: number;
  /** 16 to 64 px. */
  size?: number;
  /** Extension that is not enabled. */
  off?: boolean;
  label?: string;
  style?: JSX.CSSProperties;
}

// The tile on a 32-unit grid: the board, the clapstick across its top (9 units) and the stick's stripes.
const TILE = "M7 0h18a7 7 0 0 1 7 7v18a7 7 0 0 1-7 7H7a7 7 0 0 1-7-7V7a7 7 0 0 1 7-7z";
const STICK = "M0 9V7a7 7 0 0 1 7-7h18a7 7 0 0 1 7 7v2z";
const STRIPES = "M7 0h4.5l-3 9H4zM14.5 0H19l-3 9h-4.5zM22 0h4.5l-3 9H19z";

export function AppIcon({ glyph = "window", color = 0, size = 32, off, label, className, style, ...rest }: AppIconProps) {
  const a11y = { role: label ? ("img" as const) : undefined, "aria-label": label };
  if (off) {
    return (
      <span {...a11y} className={cx("oc-appicon", "is-off", className)} style={{ width: size, height: size, ...style }} {...rest}>
        <Icon name={glyph} size={size <= 16 ? 12 : 2 * Math.round((size * 0.55) / 2)} />
      </span>
    );
  }
  // The glyph takes about 53 % of the tile and sits in the middle of the board below the stick; the space left over
  // across is kept even so it is centred on whole pixels. Below 24 px the stripes would be mush: a plain bar then.
  const g = size <= 16 ? 10 : size <= 20 ? 12 : (() => { const e = 2 * Math.round((size * 0.53) / 2); return (size - e) % 2 === 0 ? e : e - 1; })();
  const stick = (size * 9) / 32;
  const top = Math.round(stick + (size - stick - g) / 2);
  const c = color >= 0 && color <= 12 ? Math.round(color) : 0;
  return (
    <span {...a11y} className={cx("oc-appicon", className)} style={{ width: size, height: size, "--oc-stick": `var(--app-${c})`, ...style }} {...rest}>
      <svg className="oc-appicon__tile" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
        <path d={TILE} fill="var(--app-body)" />
        <path d={STICK} fill="var(--oc-stick)" />
        {size >= 24 && <path d={STRIPES} fill="var(--app-body)" />}
        <rect x={16 / size} y={16 / size} width={32 - 32 / size} height={32 - 32 / size} rx={7 - 16 / size} fill="none" stroke="var(--app-rim)" stroke-width={32 / size} />
      </svg>
      <Icon className="oc-appicon__glyph" name={glyph} size={g} style={{ left: (size - g) / 2, top }} />
    </span>
  );
}
