import type { JSX } from "preact";
import { Icon } from "../core/Icon";
import { cx } from "../util";

const ENV_LABEL = { production: "Production", staging: "Staging", development: "Development" };

/** The in-app marker that tells staging and development from production: colour plus label. */
export interface EnvMarkerProps extends JSX.HTMLAttributes<HTMLSpanElement> {
  env?: "production" | "staging" | "development";
}

export function EnvMarker({ env = "production", className, ...rest }: EnvMarkerProps) {
  return <span className={cx("oc-env", env !== "production" && `oc-env--${env}`, className)} {...rest}><Icon name="layers" size={12} />{ENV_LABEL[env]}</span>;
}
