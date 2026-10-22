/** Base pieces every other component uses: class joining, MDI icons, the mark, key caps, images that fade in. */
import type { ComponentChildren, JSX } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";

export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

/** Material Design Icons glyph (webfont loaded in index.html). Decorative unless `label` is given; `class` adds a slot class such as f-input__icon. */
export function Icon({ name, label: aria, size, class: extra }: { name: string; label?: string; size?: number; class?: string }) {
  return <i class={extra ? `mdi mdi-${name} ${extra}` : `mdi mdi-${name}`} style={size ? { fontSize: `${size}px` } : undefined} role={aria ? "img" : undefined} aria-label={aria} aria-hidden={aria ? undefined : true} />;
}

/** The slate corner every mark shares: the board, the striped stick rising off its hinge, the hinge (#249). */
const MARK_BASE = "M19 26H79A5 5 0 0 1 84 31V81A5 5 0 0 1 79 86H19A5 5 0 0 1 14 81V31A5 5 0 0 1 19 26Z M12.37 22.35L14.8 13.05L20.1 10.69L16.54 24.32L13.8 25.54Z M20.37 22.61L23.94 8.99L29.24 6.63L25.67 20.26Z M29.51 18.55L33.07 4.92L38.37 2.56L34.81 16.19Z M38.65 14.48L42.21 0.85L47.51 -1.51L43.94 12.12Z M47.78 10.41L51.35 -3.22L56.64 -5.57L53.08 8.05Z M56.92 6.35L60.48 -7.28L65.78 -9.64L62.21 3.99Z M66.05 2.28L69.62 -11.35L73.27 -12.98L74.19 -10.92L71.35 -0.08Z M15.6 29a2.4 2.4 0 1 0 4.8 0a2.4 2.4 0 1 0 -4.8 0Z";

/** The glyph cut out of the board face, per surface (the phone's mark is a tinted image in the phone's ui/core.tsx). */
const MARK_GLYPH = {
  studio: "M30.2 37.02H55.8A3.2 3.2 0 0 1 59 40.22V58.78A3.2 3.2 0 0 1 55.8 61.98H30.2A3.2 3.2 0 0 1 27 58.78V40.22A3.2 3.2 0 0 1 30.2 37.02Z M30.2 43.42H55.8V58.78H30.2Z", // a window
  admin: "M30.2 37.34Q43 31.9 55.8 37.34V49.5Q55.8 60.7 43 65.5Q30.2 60.7 30.2 49.5Z M38.52 49.5a4.48 4.48 0 1 0 8.96 0a4.48 4.48 0 1 0 -8.96 0Z", // a shield
};

/**
 * The mark (same geometry as that surface's app icon, on its 72-unit grid): the slate corner in the
 * text colour with the surface's glyph cut out, so the page shows through and it holds up in both
 * themes. Clipped to the icon tile's rounded corner, which the board and stick run into.
 */
export function Mark({ size = 22, surface = "studio" }: { size?: number; surface?: keyof typeof MARK_GLYPH }) {
  return (
    <svg class="f-mark" viewBox="0 0 72 72" width={size} height={size} style={{ clipPath: "inset(0 round 22%)" }} aria-hidden="true">
      <path fill="currentColor" fill-rule="evenodd" d={`${MARK_BASE} ${MARK_GLYPH[surface]}`} />
    </svg>
  );
}

export const Kbd = ({ children }: { children: ComponentChildren }) => <span class="f-kbd">{children}</span>;

/**
 * Names a second instance ("staging", the server's INSTANCE_LABEL) wherever it could be taken for
 * production: the Studio's taskbar and sign-in, the admin board's header. Production has no label and
 * renders nothing, so production never shows a badge.
 */
export function InstanceBadge({ label }: { label: string | null | undefined }) {
  if (!label) return null;
  return <span class="f-instance" title={`The ${label} instance, not production`}>{label}</span>;
}

/** The tab title with the instance in front ("staging · OpenClapper"), so a tab strip tells them apart too. */
export const instanceTitle = (base: string, label: string | null | undefined) => (label ? `${label} · ${base}` : base);

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
