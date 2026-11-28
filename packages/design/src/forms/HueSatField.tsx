import type { JSX } from "preact";
import { cx } from "../util";

const clamp = (n: number) => Math.max(0, Math.min(1, n));

/**
 * A colour as hue and saturation, picked on one field: hue across, saturation up (full at the top, white at the
 * foot). For colours without a brightness of their own, a light's say, whose brightness is its intensity: every
 * point is a colour it can make, as the pure hue mixed with white. The knob is a ring, so the field shows the colour.
 */
export interface HueSatFieldProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "onChange"> {
  /** Degrees, 0..360. */
  hue: number;
  /** 0..1. */
  sat: number;
  onChange: (hue: number, sat: number) => void;
  disabled?: boolean;
}

export function HueSatField({ hue, sat, onChange, disabled, className, ...rest }: HueSatFieldProps) {
  const at = (el: HTMLElement, e: PointerEvent) => {
    const r = el.getBoundingClientRect();
    onChange(Math.round(clamp((e.clientX - r.left) / r.width) * 360), Math.round(clamp(1 - (e.clientY - r.top) / r.height) * 100) / 100);
  };
  const keys = (e: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
    const d = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] } as Record<string, number[]>)[e.key];
    if (!d || disabled) return;
    e.preventDefault();
    const n = e.shiftKey ? 10 : 1;
    onChange((Math.round(hue) + d[0] * n + 360) % 360, Math.round(clamp(sat + d[1] * n * 0.01) * 100) / 100);
  };
  return (
    <div className={cx("oc-huesat", disabled && "is-disabled", className)} role="slider" tabIndex={disabled ? -1 : 0} aria-disabled={disabled || undefined}
      aria-label="Hue and saturation" aria-valuetext={`Hue ${Math.round(hue)}°, saturation ${Math.round(sat * 100)} %`} onKeyDown={keys}
      onPointerDown={(e) => {
        if (disabled) return;
        e.preventDefault();
        const el = e.currentTarget;
        at(el, e);
        el.focus();
        try { el.setPointerCapture(e.pointerId); } catch { /* no active pointer to capture (a synthetic event): the click itself was applied */ }
      }}
      onPointerMove={(e) => { if (!disabled && e.currentTarget.hasPointerCapture(e.pointerId)) at(e.currentTarget, e); }}
      {...rest}>
      <span className="oc-huesat__knob" style={{ left: `${(((hue % 360) + 360) % 360) / 3.6}%`, top: `${(1 - clamp(sat)) * 100}%` }} />
    </div>
  );
}
