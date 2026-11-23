import type { ComponentChildren, JSX, RefObject } from "preact";
import { useRef, useState } from "preact/hooks";
import { Icon } from "../core/Icon";
import { cx } from "../util";

interface GripOpts { min: number; max: number; vertical?: boolean; fromEnd?: boolean; /** Told the unclamped size while dragging. Returning false ends the drag (the panel closed or opened under the pointer). */
  onRaw?: (raw: number) => boolean | void }

function useGrip(ref: RefObject<HTMLDivElement>, size: number, setSize: (n: number) => void, opts: GripOpts) {
  const [dragging, setDragging] = useState(false);
  const clamp = (n: number) => Math.max(opts.min, Math.min(opts.max, n));
  const onPointerDown = (e: JSX.TargetedPointerEvent<HTMLButtonElement>) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); setDragging(true); };
  const onPointerMove = (e: JSX.TargetedPointerEvent<HTMLButtonElement>) => {
    if (!dragging || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const p = opts.vertical ? e.clientY - r.top : e.clientX - r.left;
    const raw = opts.fromEnd ? (opts.vertical ? r.height : r.width) - p : p;
    if (opts.onRaw && opts.onRaw(raw) === false) { setDragging(false); return; }
    setSize(clamp(raw));
  };
  const onPointerUp = () => setDragging(false);
  const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLButtonElement>) => {
    const d = ({ ArrowLeft: -8, ArrowUp: -8, ArrowRight: 8, ArrowDown: 8 } as Record<string, number>)[e.key];
    if (d) { e.preventDefault(); setSize(clamp(size + (opts.fromEnd ? -d : d))); }
  };
  return { dragging, props: { onPointerDown, onPointerMove, onPointerUp, onKeyDown } };
}

/** A panel with a grip on its inner edge, for inspectors and sidebars: at the left, at the right, or along the bottom. Double-click the grip to go back to the default size. */
export interface ResizablePanelProps extends JSX.HTMLAttributes<HTMLDivElement> {
  side?: "left" | "right" | "bottom";
  defaultSize?: number;
  min?: number;
  max?: number;
  /** The panel can be closed down to a thin rail: with the button on the rail, or by dragging it well past its smallest size. Dragging the rail back out opens it again. */
  collapsible?: boolean;
  /** Controlled open or closed state, for a button elsewhere that does the same. */
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  children?: ComponentChildren;
}

export function ResizablePanel({ side = "left", defaultSize = 220, min = 120, max = 480, collapsible, collapsed, onCollapsedChange, children, className, ...rest }: ResizablePanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(defaultSize);
  const vertical = side === "bottom";
  const [inner, setInner] = useState(false);
  const closed = collapsible ? (collapsed ?? inner) : false;
  const setClosed = (c: boolean) => { if (c === closed) return; setInner(c); if (onCollapsedChange) onCollapsedChange(c); };
  // Closing takes a clear pull past the smallest size; opening again takes a pull to half of it.
  const grip = useGrip(ref, size, setSize, { min, max, fromEnd: side !== "left", vertical, onRaw: collapsible ? (raw) => { if (!closed && raw < min - 56) { setClosed(true); return false; } if (closed && raw > min / 2) { setClosed(false); return false; } } : undefined });
  const open = side === "left" ? "chevron-right" : side === "right" ? "chevron-left" : "chevron-up";
  if (closed) return (
    <div ref={ref} className={cx("oc-panel", "oc-panel--closed", side !== "left" && `oc-panel--${side}`, className)} {...rest}>
      {/* Keyed apart from the grip: reused as the same element, the release that ends a closing pull would click the rail and reopen the panel. */}
      <button key="rail" type="button" className={cx("oc-panel__rail", vertical && "oc-panel__rail--v", grip.dragging && "is-dragging")} aria-label="Open the panel" title="Open the panel (click, or drag)" onClick={() => setClosed(false)} onPointerDown={grip.props.onPointerDown} onPointerMove={grip.props.onPointerMove} onPointerUp={grip.props.onPointerUp}><Icon name={open} size={12} /></button>
    </div>
  );
  return (
    <div ref={ref} className={cx("oc-panel", side !== "left" && `oc-panel--${side}`, className)} style={vertical ? { height: size } : { width: size }} {...rest}>
      <div className="oc-panel__body">{children}</div>
      <button key="grip" type="button" role="separator" aria-orientation={vertical ? "horizontal" : "vertical"} aria-label="Resize panel" title="Drag to resize, double-click to reset" aria-valuenow={size} aria-valuemin={min} aria-valuemax={max} className={cx("oc-grip", vertical && "oc-grip--v", grip.dragging && "is-dragging")} onDblClick={() => setSize(defaultSize)} {...grip.props} />
    </div>
  );
}
