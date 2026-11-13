import type { JSX } from "preact";
import { cx } from "../util";

/** A person, as initials or a picture. */
export interface AvatarProps extends Omit<JSX.HTMLAttributes<HTMLSpanElement>, "size"> {
  name: string;
  src?: string;
  size?: "sm" | "md" | "lg";
}

export function Avatar({ name, src, size = "md", className, ...rest }: AvatarProps) {
  const initials = name.split(" ").filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <span className={cx("oc-avatar", size !== "md" && `oc-avatar--${size}`, className)} role="img" aria-label={name} title={name} {...rest}>
      {src ? <img src={src} alt="" /> : initials}
    </span>
  );
}
