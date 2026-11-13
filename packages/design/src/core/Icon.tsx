import type { JSX } from "preact";
import { cx } from "../util";
import { GLYPHS, type IconName } from "./glyphs";

/** A UI glyph: Tabler outline markup or a custom film glyph. */
export interface IconProps extends Omit<JSX.SVGAttributes<SVGSVGElement>, "name" | "size" | "stroke"> {
  name: IconName;
  /** 12 · 16 · 20 on the web, 22–24 on the phone. */
  size?: number;
  /** Overrides the size-following stroke. */
  stroke?: number;
  /** Accessible name; without it the icon is decorative (aria-hidden). */
  label?: string;
}

/** Renders a glyph. The stroke follows the size so lines stay about 1.5 px on screen at 16 px and below. */
export function Icon({ name, size = 16, stroke, label, className, ...rest }: IconProps) {
  const g = GLYPHS[name];
  if (!g) return null;
  const sw = stroke ?? (size <= 12 ? 2.5 : size <= 16 ? 2 : size <= 24 ? 1.75 : 1.5);
  return (
    <svg className={cx("oc-icon", className)} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width={sw} stroke-linecap="round" stroke-linejoin="round" data-tabler={g[0]}
      role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}
      dangerouslySetInnerHTML={{ __html: g[1] }} {...rest} />
  );
}
