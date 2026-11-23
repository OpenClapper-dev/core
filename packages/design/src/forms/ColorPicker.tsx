import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import { cx } from "../util";

type Hsv = { h: number; s: number; v: number };
const clamp = (n: number) => Math.max(0, Math.min(1, n));

function hexToHsv(hex: string | undefined): Hsv {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? "");
  if (!m) return { h: 220, s: 0.6, v: 0.8 };
  const n = parseInt(m[1], 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  const h = d === 0 ? 0 : max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: max === 0 ? 0 : d / max, v: max };
}
function hsvToHex({ h, s, v }: Hsv): string {
  const f = (n: number) => { const k = (n + h / 60) % 6; return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255).toString(16).padStart(2, "0"); };
  return `#${f(5)}${f(3)}${f(1)}`;
}

/**
 * Any colour: a field for saturation and brightness, a bar for the hue, and the hex value to type or paste.
 * The design system's own, so it looks the same in every browser and in both themes. Used next to a set of
 * predefined colours, never instead of one.
 */
export interface ColorPickerProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "onChange" | "value"> {
  /** #rrggbb */
  value?: string;
  onChange?: (hex: string) => void;
}

export function ColorPicker({ value, onChange, className, ...rest }: ColorPickerProps) {
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value));
  const [text, setText] = useState(() => hsvToHex(hexToHsv(value)));
  // Follow a value set from outside, but keep the hue the user chose when the colour is grey (grey has no hue).
  useEffect(() => { if (value && value.toLowerCase() !== hsvToHex(hsv)) { setHsv(hexToHsv(value)); setText(value.toLowerCase()); } }, [value]);
  const set = (next: Hsv) => { setHsv(next); const hex = hsvToHex(next); setText(hex); if (onChange) onChange(hex); };
  const drag = (apply: (x: number, y: number) => void) => ({
    onPointerDown: (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const el = e.currentTarget, r = el.getBoundingClientRect();
      apply(clamp((e.clientX - r.left) / r.width), clamp((e.clientY - r.top) / r.height));
      el.focus();
      try { el.setPointerCapture(e.pointerId); } catch { /* no active pointer to capture (a synthetic event): the click itself was applied */ }
    },
    onPointerMove: (e: JSX.TargetedPointerEvent<HTMLDivElement>) => { if (!e.currentTarget.hasPointerCapture(e.pointerId)) return; const r = e.currentTarget.getBoundingClientRect(); apply(clamp((e.clientX - r.left) / r.width), clamp((e.clientY - r.top) / r.height)); },
  });
  const keys = (e: JSX.TargetedKeyboardEvent<HTMLDivElement>, hue: boolean) => {
    const d = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] } as Record<string, number[]>)[e.key];
    if (!d) return;
    e.preventDefault();
    set(hue ? { ...hsv, h: (hsv.h + (d[0] || d[1]) * 3 + 360) % 360 } : { ...hsv, s: clamp(hsv.s + d[0] * 0.02), v: clamp(hsv.v + d[1] * 0.02) });
  };
  return (
    <div className={cx("oc-color", className)} {...rest}>
      <div className="oc-color__area" role="slider" tabIndex={0} aria-label="Saturation and brightness" aria-valuetext={`Saturation ${Math.round(hsv.s * 100)} %, brightness ${Math.round(hsv.v * 100)} %`}
        style={{ backgroundColor: `hsl(${hsv.h} 100% 50%)` }} onKeyDown={(e) => keys(e, false)} {...drag((x, y) => set({ ...hsv, s: x, v: 1 - y }))}>
        <span className="oc-color__knob" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hsvToHex(hsv) }} />
      </div>
      <div className="oc-color__hue" role="slider" tabIndex={0} aria-label="Hue" aria-valuemin={0} aria-valuemax={360} aria-valuenow={Math.round(hsv.h)} onKeyDown={(e) => keys(e, true)} {...drag((x) => set({ ...hsv, h: Math.min(359.9, x * 360) }))}>
        <span className="oc-color__knob" style={{ left: `${(hsv.h / 360) * 100}%`, background: `hsl(${hsv.h} 100% 50%)` }} />
      </div>
      <div className="oc-color__row">
        <span className="oc-color__now" style={{ background: hsvToHex(hsv) }} />
        <span className="oc-input oc-input--sm"><input className="oc-input__el" aria-label="Hex value" spellcheck={false} maxLength={7} value={text}
          onInput={(e) => { const t = e.currentTarget.value.trim(); setText(t); const m = /^#?([0-9a-f]{6})$/i.exec(t); if (m) { const hex = `#${m[1].toLowerCase()}`; setHsv(hexToHsv(hex)); if (onChange) onChange(hex); } }} /></span>
      </div>
    </div>
  );
}
