// Shared chart helpers (not a public component).
import type { ComponentChildren, RefObject } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";

/** Series: `key` in each data row, `label` for legend and tooltip, `color` 1–5 (chart tokens) or a CSS colour. */
export interface ChartSeries { key: string; label?: string; color?: number | string }

/** A data row of a chart. */
export type ChartDatum = Record<string, any>;

/** A number picks a chart token; a string is used as given. */
export const chartColor = (c?: number | string) => typeof c === "number" ? "var(--chart-" + c + ")" : (c || "var(--chart-1)");

/** Rounds an axis maximum up to 1, 2, 2.5 or 5 times a power of ten. */
export function niceMax(v: number) {
  if (!(v > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

/** The element's width, kept current by a ResizeObserver, so an SVG chart can draw in pixels. */
export function useWidth(fallback?: number): [RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(fallback || 400);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const m = () => { if (el.clientWidth) setW(el.clientWidth); };
    m();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(m); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Monotone cubic interpolation (Fritsch–Carlson) through points [[x,y],...]: smooth without overshooting the data. */
export function monotonePath(pts: [number, number][]) {
  const n = pts.length;
  if (n === 0) return "";
  if (n === 1) return "M" + pts[0][0] + "," + pts[0][1];
  const dx: number[] = [], dy: number[] = [], m: number[] = [], t: number[] = [];
  for (let i = 0; i < n - 1; i++) { dx[i] = pts[i + 1][0] - pts[i][0]; dy[i] = pts[i + 1][1] - pts[i][1]; m[i] = dy[i] / dx[i]; }
  t[0] = m[0]; t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  let d = "M" + pts[0][0] + "," + pts[0][1];
  for (let i = 0; i < n - 1; i++) {
    const c = dx[i] / 3;
    d += "C" + (pts[i][0] + c) + "," + (pts[i][1] + c * t[i]) + " " + (pts[i + 1][0] - c) + "," + (pts[i + 1][1] - c * t[i + 1]) + " " + pts[i + 1][0] + "," + pts[i + 1][1];
  }
  return d;
}

/** Numbers in en-GB grouping, anything else as text. */
export const fmtDefault = (v: unknown) => typeof v === "number" ? v.toLocaleString("en-GB") : String(v);

/** The hover tooltip, clamped inside the chart. */
export function ChartTip({ x, y, width, label, rows, format }: {
  x: number; y: number; width: number; label: ComponentChildren;
  rows: { key: string; label: ComponentChildren; value: unknown; color: string }[];
  format?: (v: number) => string;
}) {
  if (label == null) return null;
  const left = Math.min(Math.max(x + 12, 0), Math.max(0, width - 150));
  const f = (format || fmtDefault) as (v: unknown) => string;
  return (
    <div className="oc-chart__tip" style={{ left, top: Math.max(0, y) }} role="status">
      <div className="oc-chart__tip-label">{label}</div>
      {rows.map(r => (
        <div key={r.key} className="oc-chart__tip-row">
          <span className="oc-chart__sw" style={{ background: r.color }} />
          <span className="oc-chart__tip-name">{r.label}</span>
          <span className="oc-chart__tip-val">{f(r.value)}</span>
        </div>
      ))}
    </div>
  );
}

/** Swatch and name per series. */
export function ChartLegend({ items }: { items: { key: string; label: ComponentChildren; color: string }[] }) {
  return <div className="oc-chart__legend">{items.map(i => <span key={i.key}><span className="oc-chart__sw" style={{ background: i.color }} />{i.label}</span>)}</div>;
}
