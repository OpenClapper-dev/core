import type { ComponentChildren, JSX } from "preact";
import { useRef, useState } from "preact/hooks";
import { Icon } from "../core/Icon";
import { Spinner } from "../feedback/Spinner";
import { cx } from "../util";

/** A scrolling list that refreshes when pulled down past 56 dp. React Native: RefreshControl. */
export interface PullToRefreshProps extends JSX.HTMLAttributes<HTMLDivElement> {
  onRefresh?: () => void;
  refreshing?: boolean;
  children?: ComponentChildren;
}

export function PullToRefresh({ onRefresh, refreshing, children, className, ...rest }: PullToRefreshProps) {
  const [pull, setPull] = useState(0);
  const start = useRef<number | null>(null);
  const armed = pull > 56;
  const down = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => { if (e.currentTarget.scrollTop <= 0) start.current = e.clientY; };
  const move = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => { const s = start.current; if (s != null) setPull(Math.max(0, Math.min(96, (e.clientY - s) * 0.6))); };
  const up = () => { if (armed && onRefresh) onRefresh(); start.current = null; setPull(0); };
  const h = refreshing ? 48 : pull;
  return (
    <div className={cx("oc-m__scroll", className)} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} {...rest}>
      <div className={cx("oc-m-ptr", armed && "is-armed")} style={{ height: h }}>
        {refreshing ? <Spinner size={20} /> : <Icon name="arrow-down" size={20} className="oc-m-ptr__icon" />}
        {refreshing ? "Refreshing" : armed ? "Release to refresh" : "Pull to refresh"}
      </div>
      {children}
    </div>
  );
}
