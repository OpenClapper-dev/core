import { toChildArray, type ComponentChildren, type JSX, type RefObject } from "preact";
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

/** Two panes with a draggable grip between them; arrow keys move the grip by 8 px. */
export interface SplitViewProps extends JSX.HTMLAttributes<HTMLDivElement> {
  orientation?: "horizontal" | "vertical";
  /** Size of the first pane, px. */
  defaultSize?: number;
  min?: number;
  max?: number;
  /** Exactly two children. */
  children: ComponentChildren;
}

export function SplitView({ orientation = "horizontal", defaultSize = 200, min = 80, max = 600, children, className, ...rest }: SplitViewProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(defaultSize);
  const vertical = orientation === "vertical";
  const grip = useGrip(ref, size, setSize, { min, max, vertical });
  const [a, b] = toChildArray(children);
  return (
    <div ref={ref} className={cx("oc-split", vertical && "oc-split--v", className)} {...rest}>
      <div className="oc-split__pane" style={{ flex: "none", [vertical ? "height" : "width"]: size }}>{a}</div>
      <button type="button" role="separator" aria-orientation={vertical ? "horizontal" : "vertical"} aria-label="Resize" aria-valuenow={size}
        className={cx("oc-grip", vertical && "oc-grip--v", grip.dragging && "is-dragging")} {...grip.props} />
      <div className="oc-split__pane" style={{ flex: 1 }}>{b}</div>
    </div>
  );
}
