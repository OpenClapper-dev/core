import type { JSX } from "preact";
import { cx } from "../util";

/** A placeholder for content that is loading. Wrap the loading region in aria-busy="true"; skeletons are hidden from assistive tech. */
export interface SkeletonProps extends Omit<JSX.HTMLAttributes<HTMLSpanElement>, "size" | "width" | "height" | "style"> {
  /** block (any box), text (a line; use lines for a paragraph), heading, circle (avatars, icons), control (a 28 px field or button), thumb (3:2 image). */
  variant?: "block" | "text" | "heading" | "circle" | "control" | "thumb";
  /** Diameter for circle. */
  size?: number;
  /** Number of lines for variant text; the last is 60 % wide. */
  lines?: number;
  width?: number | string;
  height?: number | string;
  style?: JSX.CSSProperties;
}

export function Skeleton({ variant = "block", width, height, size, lines = 1, className, style, ...rest }: SkeletonProps) {
  if (variant === "text" && lines > 1) {
    return (
      <span className={cx("oc-skeleton-lines", className)} style={{ width, ...style }} aria-hidden="true" {...rest}>
        {Array.from({ length: lines }, (_, i) => <span key={i} className="oc-skeleton oc-skeleton--text" style={{ width: i === lines - 1 ? "60%" : "100%" }} />)}
      </span>
    );
  }
  const dims = variant === "circle" ? { width: size || width || 24, height: size || height || width || 24 } : { width, height };
  return <span className={cx("oc-skeleton", variant !== "block" && "oc-skeleton--" + variant, className)} style={{ ...dims, ...style }} aria-hidden="true" {...rest} />;
}
