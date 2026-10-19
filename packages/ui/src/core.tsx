/** Base pieces every other component uses: class joining, MDI icons, the mark, key caps, images that fade in. */
import type { ComponentChildren, JSX } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";

export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

/** Material Design Icons glyph (webfont loaded in index.html). Decorative unless `label` is given; `class` adds a slot class such as f-input__icon. */
export function Icon({ name, label: aria, size, class: extra }: { name: string; label?: string; size?: number; class?: string }) {
  return <i class={extra ? `mdi mdi-${name} ${extra}` : `mdi mdi-${name}`} style={size ? { fontSize: `${size}px` } : undefined} role={aria ? "img" : undefined} aria-label={aria} aria-hidden={aria ? undefined : true} />;
}

/** What sits inside the viewfinder corners, per surface (the icon family, #170; the phone's frame is drawn in the phone's ui/core.tsx). */
const MARK_GLYPH = {
  studio: "M14 16H58V24H14Z M14 28H58V56H14Z", // a window with its title bar
  admin: "M20 34H52V56H20Z M24 34V18H48V34H41V25H31V34Z", // a padlock
};

/**
 * The Fielder mark (same geometry as that surface's app icon): viewfinder corners in the text colour
 * around the surface's glyph in the accent, so it holds up in both themes.
 */
export function Mark({ size = 22, surface = "studio" }: { size?: number; surface?: keyof typeof MARK_GLYPH }) {
  return (
    <svg class="f-mark" viewBox="0 0 72 72" width={size} height={size} aria-hidden="true">
      <path fill="currentColor" d="M0 0H20V12H12V20H0Z M72 0V20H60V12H52V0Z M72 72H52V60H60V52H72Z M0 72V52H12V60H20V72Z" />
      <path fill="var(--accent)" d={MARK_GLYPH[surface]} />
    </svg>
  );
}

export const Kbd = ({ children }: { children: ComponentChildren }) => <span class="f-kbd">{children}</span>;

/** Marks the first match of `q` (already lower-case) inside `text`, as one inline run so the word keeps its spacing. */
export function Highlight({ text, q }: { text: string; q: string }) {
  const i = q ? text.toLowerCase().indexOf(q) : -1;
  if (i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<mark>{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>;
}

/**
 * An image that fades in once loaded (motion, #166): CSS cannot see the load state, so the state
 * lives here. A cached image may already be complete when mounted; a failed load counts as loaded
 * too, so it never stays invisible. Behind it shows whatever the container paints (the photo
 * letterbox for photos).
 */
export function Img({ class: extra, onLoad, onError, ...rest }: Omit<JSX.ImgHTMLAttributes<HTMLImageElement>, "ref">) {
  const ref = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState(false);
  useLayoutEffect(() => { setLoaded(!!ref.current?.complete); }, [rest.src]);
  return (
    <img {...rest} ref={ref} class={cx("f-img", extra as string | undefined, loaded && "is-loaded")}
      onLoad={(e) => { setLoaded(true); onLoad?.call(e.currentTarget, e); }}
      onError={(e) => { setLoaded(true); onError?.call(e.currentTarget, e); }} />
  );
}
