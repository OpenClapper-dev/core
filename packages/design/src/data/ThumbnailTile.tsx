import type { ComponentChildren, JSX } from "preact";
import { Icon } from "../core/Icon";
import { cx } from "../util";

/** An image tile: the picture letterboxed on black, opaque badges, a check when selected. */
export interface ThumbnailTileProps extends Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "name" | "selected"> {
  src?: string;
  alt?: string;
  name?: ComponentChildren;
  meta?: ComponentChildren;
  /** Short opaque labels over the picture, e.g. 'RAW'. */
  badges?: ComponentChildren[];
  selected?: boolean;
  /** Placeholder content when there is no src. */
  children?: ComponentChildren;
}

export function ThumbnailTile({ src, alt = "", name, meta, badges = [], selected, children, className, ...rest }: ThumbnailTileProps) {
  return (
    <button type="button" aria-pressed={selected == null ? undefined : !!selected} className={cx("oc-thumb", selected && "is-selected", className)} {...rest}>
      <span className="oc-thumb__img">
        {src ? <img src={src} alt={alt} /> : children}
        {badges.length > 0 && <span className="oc-thumb__badges">{badges.map((b, i) => <span key={i} className="oc-thumb__badge">{b}</span>)}</span>}
        {selected && <span className="oc-thumb__check"><Icon name="check" size={12} /></span>}
      </span>
      {name && <span className="oc-thumb__name">{name}</span>}
      {meta && <span className="oc-thumb__meta">{meta}</span>}
    </button>
  );
}
