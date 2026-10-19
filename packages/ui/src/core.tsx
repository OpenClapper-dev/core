/** Base pieces every other component uses: class joining, MDI icons, the mark, key caps. */
import type { ComponentChildren } from "preact";

export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

/** Material Design Icons glyph (webfont loaded in index.html). Decorative unless `label` is given; `class` adds a slot class such as f-input__icon. */
export function Icon({ name, label: aria, size, class: extra }: { name: string; label?: string; size?: number; class?: string }) {
  return <i class={extra ? `mdi mdi-${name} ${extra}` : `mdi mdi-${name}`} style={size ? { fontSize: `${size}px` } : undefined} role={aria ? "img" : undefined} aria-label={aria} aria-hidden={aria ? undefined : true} />;
}

/**
 * The Fielder mark (same geometry as the app icon): viewfinder corners in the text colour around
 * the cinema frame in the accent, so it holds up in both themes.
 */
export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg class="f-mark" viewBox="0 0 72 72" width={size} height={size} aria-hidden="true">
      <path fill="currentColor" d="M0 0H20V12H12V20H0Z M72 0V20H60V12H52V0Z M72 72H52V60H60V52H72Z M0 72V52H12V60H20V72Z" />
      <path fill="var(--accent)" d="M18 26H54V46H18Z" />
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
