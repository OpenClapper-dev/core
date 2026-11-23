import type { JSX } from "preact";
import { Icon } from "../core/Icon";
import type { IconName } from "../core/glyphs";
import { cx } from "../util";

/** A stack of opaque buttons over a map (zoom by default). */
export interface MapControlProps extends JSX.HTMLAttributes<HTMLDivElement> {
  buttons?: { icon: IconName; label: string; onClick?: () => void; pressed?: boolean }[];
  onZoomIn?: () => void;
  onZoomOut?: () => void;
}

export function MapControl({ buttons, onZoomIn, onZoomOut, className, ...rest }: MapControlProps) {
  const list = buttons || [{ icon: "plus" as const, label: "Zoom in", onClick: onZoomIn, pressed: undefined }, { icon: "minus" as const, label: "Zoom out", onClick: onZoomOut, pressed: undefined }];
  return (
    <div role="group" className={cx("oc-mapctl", className)} {...rest}>
      {list.map(b => <button key={b.label} type="button" aria-label={b.label} title={b.label} aria-pressed={b.pressed == null ? undefined : !!b.pressed} onClick={b.onClick}><Icon name={b.icon} /></button>)}
    </div>
  );
}
