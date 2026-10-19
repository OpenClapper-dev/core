/**
 * The dashboard shell's building blocks (dashboard.css, the rework's additions to the design
 * system): toolbars above a page and side panels next to it.
 */
import type { ComponentChildren, JSX } from "preact";
import { useRef, useState } from "preact/hooks";
import { cx, Icon } from "./core";

/** Page toolbar; `sub` is the second, quieter row (state switch, result count). */
export function Toolbar({ sub, children }: { sub?: boolean; children: ComponentChildren }) {
  return <div class={cx("f-toolbar", sub && "f-toolbar--sub")}>{children}</div>;
}

/** Page title inside a Toolbar: optional icon, the ellipsised title, an optional count, then extras (e.g. an "Edited" badge). */
export function ToolbarTitle({ icon, count, after, children }: { icon?: string; count?: number; after?: ComponentChildren; children: ComponentChildren }) {
  return (
    <div class="f-toolbar__title">
      {icon && <Icon name={icon} />}
      <span>{children}</span>
      {count !== undefined && <span class="meta num" style={{ fontSize: "var(--text-body)" }}>{count}</span>}
      {after}
    </div>
  );
}

/** Pushes the following toolbar items to the right. */
export const ToolbarSpacer = () => <span class="f-toolbar__sp" />;

/** Width of a resizable panel, remembered per browser under `panelWidth.<key>`. */
export interface PanelResize { key: string; min: number; max: number }
function storedWidth(r: PanelResize): number | null {
  try { const v = Number(localStorage.getItem(`panelWidth.${r.key}`)); return v >= r.min && v <= r.max ? v : null; } catch { return null; }
}

/**
 * Side panel: `left` for list panels before the content, otherwise an inspector-style panel on the
 * right. `resize` adds a drag handle on its inner edge (double-click resets to `width`).
 */
export function Panel({ left, width, label, style, resize, children }: { left?: boolean; width?: string; label?: string; style?: JSX.CSSProperties; resize?: PanelResize; children: ComponentChildren }) {
  const [px, setPx] = useState<number | null>(() => (resize ? storedWidth(resize) : null));
  const drag = useRef<{ x: number; w: number } | null>(null);
  const w = px !== null ? `${px}px` : width;
  const s = w ? { "--panel-w": w, ...(style as object) } : style;
  const save = (v: number | null) => { if (!resize) return; try { if (v === null) localStorage.removeItem(`panelWidth.${resize.key}`); else localStorage.setItem(`panelWidth.${resize.key}`, String(v)); } catch { /* a preference */ } };
  return (
    <aside class={cx("f-panel", left && "f-panel--left", resize && "f-panel--resizable")} style={s as JSX.CSSProperties} aria-label={label}>
      {resize && (
        <div class="f-panel__grip" role="separator" aria-orientation="vertical" aria-label="Resize the panel" title="Drag to resize · double-click resets"
          onPointerDown={(e) => { const box = (e.currentTarget as HTMLElement).parentElement!.getBoundingClientRect(); drag.current = { x: e.clientX, w: box.width }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); e.preventDefault(); }}
          onPointerMove={(e) => { const d = drag.current; if (!d) return; const dx = (e.clientX - d.x) * (left ? 1 : -1); setPx(Math.round(Math.max(resize.min, Math.min(resize.max, d.w + dx)))); }}
          onPointerUp={() => { if (drag.current) { drag.current = null; setPx((v) => { save(v); return v; }); } }}
          onPointerCancel={() => { drag.current = null; }}
          onDblClick={() => { setPx(null); save(null); }} />
      )}
      {children}
    </aside>
  );
}

/** Panel heading: the title, then actions (a key hint, a button, a close button). */
export function PanelHead({ title, titleStyle, children }: { title: ComponentChildren; titleStyle?: JSX.CSSProperties; children?: ComponentChildren }) {
  return <div class="f-panel__head"><span class="f-panel__title" style={titleStyle}>{title}</span>{children}</div>;
}

/** Scrolling panel content; `flush` drops the padding for edge-to-edge row lists. */
export function PanelBody({ flush, style, children, ...rest }: { flush?: boolean; style?: JSX.CSSProperties; children: ComponentChildren } & Pick<JSX.HTMLAttributes<HTMLDivElement>, "role" | "aria-label">) {
  return <div class={cx("f-panel__body", flush && "f-panel__body--flush")} style={style} {...rest}>{children}</div>;
}

/** Pinned actions at the bottom of a panel. */
export const PanelFoot = ({ children }: { children: ComponentChildren }) => <div class="f-panel__foot">{children}</div>;
