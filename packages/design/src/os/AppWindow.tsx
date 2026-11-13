import type { ComponentChildren, JSX } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { Icon } from "../core/Icon";
import { cx } from "../util";

type WindowState = "normal" | "max" | "snap-left" | "snap-right" | "min";
interface Box { left: number; top: number; width: number; height: number }
interface Tween { phase: "from" | "to"; from: Box; to: Box }

const reduced = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const msVar = (el: Element | null, name: string, fb: number) => { if (!el) return fb; const v = getComputedStyle(el).getPropertyValue(name).trim(); return v ? parseFloat(v) : fb; };

/** The window frame: 28 px title bar with icon, title and controls, optional toolbar and status bar, content area. */
export interface AppWindowProps extends Omit<JSX.HTMLAttributes<HTMLElement>, "title" | "icon" | "onFocus" | "onClose" | "style"> {
  title: string;
  icon?: ComponentChildren;
  focused?: boolean;
  state?: WindowState;
  /** Play the close animation, then call onClosed; remove the window there. */
  closing?: boolean;
  onClosed?: () => void;
  /** Box the window shrinks toward when minimised (e.g. its taskbar button's getBoundingClientRect()). */
  minimizeTarget?: Box;
  toolbar?: ComponentChildren;
  statusBar?: ComponentChildren;
  resizable?: boolean;
  onFocus?: () => void;
  onClose?: () => void;
  onMinimize?: () => void;
  onMaximize?: () => void;
  onBarPointerDown?: (e: JSX.TargetedPointerEvent<HTMLElement>) => void;
  onBarDoubleClick?: () => void;
  style?: JSX.CSSProperties;
  children?: ComponentChildren;
}

// Geometry changes (maximise, restore, snap) are animated with a FLIP from the old box to the new one.
// Minimise shrinks toward minimizeTarget (a DOMRect-like box, e.g. the taskbar button) before hiding.
export function AppWindow({ title, icon, focused, state = "normal", closing, onClosed, minimizeTarget, toolbar, statusBar, resizable = true, onFocus, onClose, onMinimize, onMaximize, onBarPointerDown, onBarDoubleClick, children, className, style, ...rest }: AppWindowProps) {
  const max = state === "max";
  const ref = useRef<HTMLElement>(null);
  const prevBox = useRef<Box | null>(null);
  const prevState = useRef(state);
  const [opening, setOpening] = useState(true);
  const [shownState, setShownState] = useState<WindowState>(state);
  const [minStyle, setMinStyle] = useState<JSX.CSSProperties | null>(null);
  const [tween, setTween] = useState<Tween | null>(null);
  useEffect(() => { const t = setTimeout(() => setOpening(false), 400); return () => clearTimeout(t); }, []);
  useEffect(() => {
    if (!closing) return undefined;
    const t = setTimeout(() => onClosed && onClosed(), reduced() ? 0 : msVar(ref.current, "--dur-fast", 90) + 20);
    return () => clearTimeout(t);
  }, [closing]);
  // Minimise: animate toward target, then apply the min state.
  useEffect(() => {
    const el = ref.current;
    const from = prevState.current;
    prevState.current = state;
    if (state === "min" && from !== "min" && el && !reduced()) {
      const r = el.getBoundingClientRect();
      const t = minimizeTarget || { left: r.left + r.width / 2, top: window.innerHeight, width: 0, height: 0 };
      const dx = t.left + t.width / 2 - (r.left + r.width / 2), dy = t.top + t.height / 2 - (r.top + r.height / 2);
      setMinStyle({ translate: `${dx}px ${dy}px`, scale: "0.15", opacity: 0 });
      const tm = setTimeout(() => { setMinStyle(null); setShownState("min"); }, msVar(el, "--dur", 160) + 20);
      return () => clearTimeout(tm);
    }
    if (from === "min" && state !== "min" && el && !reduced()) {
      setShownState(state);
      return undefined;
    }
    setShownState(state);
    return undefined;
  }, [state]);
  // FLIP for geometry state changes: render the old box, then the new box with the tween class, both through state.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || shownState === "min" || tween) return undefined;
    const box = { left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight };
    const old = prevBox.current;
    prevBox.current = box;
    if (!old || reduced() || !el.dataset.geomChange) return undefined;
    delete el.dataset.geomChange;
    if (old.left === box.left && old.top === box.top && old.width === box.width && old.height === box.height) return undefined;
    setTween({ phase: "from", from: old, to: box });
    return undefined;
  });
  useEffect(() => {
    if (!tween) return undefined;
    const el = ref.current;
    if (tween.phase === "from") {
      if (el) void el.offsetWidth;
      const tm = setTimeout(() => setTween((t) => t && { ...t, phase: "to" }), 20);
      const safety = setTimeout(() => setTween(null), 1000);
      return () => { clearTimeout(tm); clearTimeout(safety); };
    }
    const tm = setTimeout(() => setTween(null), msVar(el, "--dur-slow", 240) + 40);
    return () => clearTimeout(tm);
  }, [tween && tween.phase]);
  const tweenStyle: JSX.CSSProperties | null = tween ? (() => { const g = tween.phase === "from" ? tween.from : tween.to; return { left: g.left, top: g.top, width: g.width, height: g.height, right: "auto", bottom: "auto" }; })() : null;
  const prevShown = useRef(shownState);
  if (prevShown.current !== shownState) {
    if (ref.current && prevShown.current !== "min" && shownState !== "min") ref.current.dataset.geomChange = "1";
    prevShown.current = shownState;
  }
  return (
    <section ref={ref} role="dialog" aria-label={title}
      className={cx("oc-window", focused && "is-focused", shownState !== "normal" && !tween && `oc-window--${shownState}`, opening && "is-opening", closing && "is-closing", minStyle && "is-minimizing", tween && tween.phase === "to" && "is-tweening", tween && "is-flip", className)}
      style={tweenStyle ? { ...style, ...tweenStyle } : minStyle ? { ...style, ...minStyle } : style} onPointerDown={onFocus} {...rest}>
      <header className="oc-window__bar" onPointerDown={onBarPointerDown} onDblClick={onBarDoubleClick || onMaximize}>
        {icon}<span className="oc-window__title">{title}</span>
        <span className="oc-window__controls" onPointerDown={(e) => e.stopPropagation()}>
          {onMinimize && <button type="button" className="oc-window__ctl" aria-label="Minimise" onClick={onMinimize}><Icon name="minus" size={12} /></button>}
          {onMaximize && <button type="button" className="oc-window__ctl" aria-label={max ? "Restore" : "Maximise"} onClick={onMaximize}><Icon name={max ? "restore" : "maximize"} size={12} /></button>}
          {onClose && <button type="button" className="oc-window__ctl oc-window__ctl--close" aria-label="Close" onClick={onClose}><Icon name="close" size={12} /></button>}
        </span>
      </header>
      {toolbar}
      <div className="oc-window__content">{children}</div>
      {statusBar}
      {resizable && <span className="oc-window__handle" aria-hidden="true" />}
    </section>
  );
}
