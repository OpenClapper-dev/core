import type { ComponentChildren, JSX, RefObject } from "preact";
import { useRef, useState } from "preact/hooks";
import { cx } from "../util";

interface GripOpts { min: number; max: number; vertical?: boolean; fromEnd?: boolean }

function useGrip(ref: RefObject<HTMLDivElement>, size: number, setSize: (n: number) => void, opts: GripOpts) {
  const [dragging, setDragging] = useState(false);
  const clamp = (n: number) => Math.max(opts.min, Math.min(opts.max, n));
  const onPointerDown = (e: JSX.TargetedPointerEvent<HTMLButtonElement>) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); setDragging(true); };
  const onPointerMove = (e: JSX.TargetedPointerEvent<HTMLButtonElement>) => {
    if (!dragging || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const p = opts.vertical ? e.clientY - r.top : e.clientX - r.left;
    setSize(clamp(opts.fromEnd ? (opts.vertical ? r.height : r.width) - p : p));
  };
  const onPointerUp = () => setDragging(false);
  const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLButtonElement>) => {
    const d = ({ ArrowLeft: -8, ArrowUp: -8, ArrowRight: 8, ArrowDown: 8 } as Record<string, number>)[e.key];
    if (d) { e.preventDefault(); setSize(clamp(size + (opts.fromEnd ? -d : d))); }
  };
  return { dragging, props: { onPointerDown, onPointerMove, onPointerUp, onKeyDown } };
}

/** A side panel with a grip on its inner edge, for inspectors and sidebars. */
export interface ResizablePanelProps extends JSX.HTMLAttributes<HTMLDivElement> {
  side?: "left" | "right";
  defaultSize?: number;
  min?: number;
  max?: number;
  children?: ComponentChildren;
}

export function ResizablePanel({ side = "left", defaultSize = 220, min = 120, max = 480, children, className, ...rest }: ResizablePanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(defaultSize);
  const grip = useGrip(ref, size, setSize, { min, max, fromEnd: side === "right" });
  return (
    <div ref={ref} className={cx("oc-panel", side === "right" && "oc-panel--right", className)} style={{ width: size }} {...rest}>
      <div className="oc-panel__body">{children}</div>
      <button type="button" role="separator" aria-orientation="vertical" aria-label="Resize panel" aria-valuenow={size} className={cx("oc-grip", grip.dragging && "is-dragging")} {...grip.props} />
    </div>
  );
}
