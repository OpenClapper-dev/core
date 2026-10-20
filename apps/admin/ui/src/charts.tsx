/**
 * Hand-written SVG charts for the board (no chart dependency, house rule). One hue only (the accent):
 * there is no categorical palette in the design system, so several series are small multiples,
 * never stacked colours. Marks are drawn with their text label, never colour alone.
 */
import { useEffect, useRef, useState } from "preact/hooks";

export interface Point { day: string; value: number }
export interface MarkLine { bytes: number; label: string }

/** The container's width, so text stays crisp (no viewBox scaling of glyphs). */
function useWidth<T extends HTMLElement>(): [{ current: T | null }, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

const dayMs = 86_400_000;
const t = (day: string) => Date.parse(`${day}T00:00:00Z`);
/** The next round number above v in the byte scale (1, 2, 2.5, 5 × a power of 1024), so the axis ticks read cleanly. */
function nice(v: number): number {
  const base = 1024 ** Math.max(0, Math.floor(Math.log(v) / Math.log(1024)));
  const m = v / base;
  const step = [1, 2, 2.5, 4, 5, 8, 10, 16, 20, 25, 40, 50, 80, 100, 160, 200, 250, 400, 500, 800, 1024].find((s) => s >= m) ?? Math.ceil(m);
  return step * base;
}
const shortDay = (day: string) => new Date(t(day)).toLocaleDateString([], { day: "numeric", month: "short" });

/**
 * One series over days with horizontal marks, a crosshair and a tooltip on hover. `format` renders a
 * value for the axis and the tooltip. Days without a point leave a gap in x, not in the line.
 */
export function LineChart({ points, marks = [], format, height = 220, label }: { points: Point[]; marks?: MarkLine[]; format: (v: number) => string; height?: number; label: string }) {
  const [box, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 64, r: 16, t: 12, b: 28 };
  const w = Math.max(width, 240), iw = w - pad.l - pad.r, ih = height - pad.t - pad.b;
  const xs = points.map((p) => t(p.day));
  const x0 = xs.length ? Math.min(...xs) : 0, x1 = xs.length ? Math.max(...xs) : 1;
  const span = Math.max(x1 - x0, dayMs);
  const top = nice(Math.max(1, ...points.map((p) => p.value), ...marks.map((m) => m.bytes)) * 1.08);
  const X = (ms: number) => pad.l + ((ms - x0) / span) * iw;
  const Y = (v: number) => pad.t + ih - (v / top) * ih;
  const path = points.map((p, i) => `${i ? "L" : "M"}${X(t(p.day)).toFixed(1)},${Y(p.value).toFixed(1)}`).join(" ");
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * top);
  const dayTicks = points.filter((_, i) => points.length <= 6 || i % Math.ceil(points.length / 6) === 0 || i === points.length - 1);
  const onMove = (e: MouseEvent) => {
    if (!points.length) return;
    const mx = e.offsetX;
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(X(xs[i]) - mx) < Math.abs(X(xs[best]) - mx)) best = i;
    setHover(best);
  };
  const h = hover === null ? null : points[hover];
  const summary = points.length ? `${label}: ${points.length} days from ${shortDay(points[0].day)} to ${shortDay(points[points.length - 1].day)}, latest ${format(points[points.length - 1].value)}` : `${label}: no data yet`;
  return (
    <div class="admin-chart" ref={box}>
      {width > 0 && (
        <svg width={w} height={height} role="img" aria-label={summary} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
          {ticks.map((v) => <g key={v}><line class="admin-chart__grid" x1={pad.l} x2={w - pad.r} y1={Y(v)} y2={Y(v)} /><text class="admin-chart__tick" x={pad.l - 8} y={Y(v)} text-anchor="end" dominant-baseline="middle">{format(v)}</text></g>)}
          {dayTicks.map((p) => <text key={p.day} class="admin-chart__tick" x={X(t(p.day))} y={height - 8} text-anchor="middle">{shortDay(p.day)}</text>)}
          {marks.map((m) => (
            <g key={m.bytes}>
              <line class="admin-chart__mark" x1={pad.l} x2={w - pad.r} y1={Y(m.bytes)} y2={Y(m.bytes)} />
              <text class="admin-chart__marklabel" x={w - pad.r} y={Y(m.bytes) - 4} text-anchor="end">{m.label} · {format(m.bytes)}</text>
            </g>
          ))}
          {points.length > 1 && <path class="admin-chart__line" d={path} />}
          {points.length === 1 && <circle class="admin-chart__dot" cx={X(xs[0])} cy={Y(points[0].value)} r={4} />}
          {h && <g><line class="admin-chart__cross" x1={X(t(h.day))} x2={X(t(h.day))} y1={pad.t} y2={pad.t + ih} /><circle class="admin-chart__dot" cx={X(t(h.day))} cy={Y(h.value)} r={5} /></g>}
        </svg>
      )}
      {h && <div class="admin-chart__tip" style={{ left: `${Math.min(X(t(h.day)), w - 160)}px` }}><strong>{shortDay(h.day)}</strong> <span class="num">{format(h.value)}</span></div>}
      {!points.length && <div class="admin-chart__empty meta">No snapshot yet: the first one is written by tonight's cron.</div>}
    </div>
  );
}

/** A tiny trend without axes, for a table cell; the title carries the numbers for hover. */
export function Sparkline({ points, format, width = 120, height = 28 }: { points: Point[]; format: (v: number) => string; width?: number; height?: number }) {
  if (points.length < 2) return <span class="meta">—</span>;
  const xs = points.map((p) => t(p.day));
  const x0 = Math.min(...xs), span = Math.max(Math.max(...xs) - x0, dayMs);
  const top = Math.max(1, ...points.map((p) => p.value));
  const d = points.map((p, i) => `${i ? "L" : "M"}${(2 + ((t(p.day) - x0) / span) * (width - 4)).toFixed(1)},${(height - 2 - (p.value / top) * (height - 4)).toFixed(1)}`).join(" ");
  return (
    <svg class="admin-spark" width={width} height={height} role="img" aria-label={`${format(points[0].value)} to ${format(points[points.length - 1].value)} over ${points.length} days`}>
      <title>{shortDay(points[0].day)} {format(points[0].value)} → {shortDay(points[points.length - 1].day)} {format(points[points.length - 1].value)}</title>
      <path class="admin-chart__line" d={d} />
    </svg>
  );
}
