/** Base pieces every other component uses: class joining, MDI icons, the mark, key caps, images that fade in. */
import type { ComponentChildren, JSX } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";

export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

/** Material Design Icons glyph (webfont loaded in index.html). Decorative unless `label` is given; `class` adds a slot class such as f-input__icon. */
export function Icon({ name, label: aria, size, class: extra }: { name: string; label?: string; size?: number; class?: string }) {
  return <i class={extra ? `mdi mdi-${name} ${extra}` : `mdi mdi-${name}`} style={size ? { fontSize: `${size}px` } : undefined} role={aria ? "img" : undefined} aria-label={aria} aria-hidden={aria ? undefined : true} />;
}

/** What sits in the channel between the slate stripes, per surface (the icon family, #170; the phone's glyph is drawn in the phone's ui/core.tsx). */
const MARK_GLYPH = {
  studio: "M24 26H44V31H24Z M30 33.5H50V38.5H30Z M22 41H38V46H22Z", // three staggered tracks
  admin: "M36 24.98A6.3 6.3 0 0 1 39.6 36.41L42.3 47.02H29.7L32.4 36.41A6.3 6.3 0 0 1 36 24.98Z", // a keyhole
};

/**
 * The mark (same geometry as that surface's app icon): two diagonal slate stripes in the text colour
 * with the surface's glyph in the accent between them, so it holds up in both themes.
 */
export function Mark({ size = 22, surface = "studio" }: { size?: number; surface?: keyof typeof MARK_GLYPH }) {
  return (
    <svg class="f-mark" viewBox="0 0 72 72" width={size} height={size} aria-hidden="true">
      <path fill="currentColor" d="M0 30L30 0H46L0 46Z M72 42L42 72H26L72 26Z" />
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
