import type { ComponentChildren, JSX } from "preact";
import { Button } from "../actions/Button";
import { Icon } from "../core/Icon";
import type { IconName } from "../core/glyphs";
import { cx } from "../util";

const BANNER_ICON: Record<NonNullable<BannerProps["tone"]>, IconName> = { neutral: "info", info: "info", success: "success", warning: "warning", danger: "error" };

/** A persistent message at the top of a window or section; always carries an icon. */
export interface BannerProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "title" | "icon"> {
  tone?: "neutral" | "info" | "success" | "warning" | "danger";
  icon?: IconName;
  title?: ComponentChildren;
  action?: ComponentChildren;
  onDismiss?: () => void;
  children?: ComponentChildren;
}

export function Banner({ tone = "neutral", icon, title, action, onDismiss, children, className, ...rest }: BannerProps) {
  return (
    <div role={tone === "danger" || tone === "warning" ? "alert" : "status"} className={cx("oc-banner", tone !== "neutral" && `oc-banner--${tone}`, className)} {...rest}>
      <Icon name={icon || BANNER_ICON[tone]} />
      <div className="oc-banner__body">{title && <div className="oc-banner__title">{title}</div>}{children}</div>
      {(action || onDismiss) && <div className="oc-banner__actions">{action}{onDismiss && <Button variant="quiet" size="sm" icon="close" label="Dismiss" onClick={onDismiss} />}</div>}
    </div>
  );
}
