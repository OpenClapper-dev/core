import type { JSX } from "preact";
import { useMemo, useState } from "preact/hooks";
import { ChartLegend, ChartTip, chartColor, fmtDefault, monotonePath, niceMax, useWidth, type ChartDatum, type ChartSeries } from "./chartKit";

export type { ChartSeries } from "./chartKit";

function axes(max: number, ticks: number, w: number, H: number, M: { t: number; r: number; b: number; l: number }, fmt: (v: number) => string, hideY?: boolean) {
  const out: JSX.Element[] = [];
  for (let i = 0; i <= ticks; i++) {
    const v = (max / ticks) * i, y = M.t + (H - M.t - M.b) * (1 - i / ticks);
    out.push(<line key={"g" + i} className="oc-chart__grid" x1={M.l} x2={w - M.r} y1={y} y2={y} />);
    if (!hideY) out.push(<text key={"t" + i} className="oc-chart__tick oc-chart__tick--num" x={M.l - 8} y={y} dy="0.32em" text-anchor="end">{fmt(v)}</text>);
  }
  return out;
}

let gid = 0;

/** A smooth series over time with a soft gradient fill, a dashed hover cursor and tooltip. */
export interface AreaChartProps {
  data: ChartDatum[];
  xKey?: string;
  series: ChartSeries[];
  height?: number;
  /** Draw lines only (see LineChart). */
  line?: boolean;
  dots?: boolean;
  hideYAxis?: boolean;
  legend?: boolean;
  format?: (v: number) => string;
  xFormat?: (v: any) => string;
  className?: string;
}

export function AreaChart({ data = [], xKey = "x", series = [], height = 220, line, dots, hideYAxis, legend = true, format = fmtDefault, xFormat, className }: AreaChartProps) {
  const [ref, w] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const ids = useMemo(() => series.map(() => "oc-ag" + (gid++)), [series.length]);
  const M = { t: 8, r: 8, b: 24, l: hideYAxis ? 8 : 44 };
  const max = niceMax(Math.max(0, ...data.flatMap(d => series.map(s => Number(d[s.key]) || 0))));
  const innerW = Math.max(1, w - M.l - M.r), innerH = height - M.t - M.b;
  const step = data.length > 1 ? innerW / (data.length - 1) : 0;
  const x = (i: number) => M.l + step * i, y = (v: number) => M.t + innerH * (1 - v / max);
  const every = Math.max(1, Math.ceil(data.length / Math.max(1, Math.floor(innerW / 56))));
  const onMove = (e: JSX.TargetedMouseEvent<SVGSVGElement>) => { const r = e.currentTarget.getBoundingClientRect(); const i = Math.round((e.clientX - r.left - M.l) / (step || 1)); setHover(Math.max(0, Math.min(data.length - 1, i))); };
  return (
    <div ref={ref} className={"oc-chart" + (className ? " " + className : "")} onMouseLeave={() => setHover(null)}>
      <svg width={w} height={height} role="img" aria-label={line ? "Line chart" : "Area chart"} onMouseMove={onMove}>
        <defs>{series.map((s, si) => <linearGradient key={s.key} id={ids[si]} x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stop-color={chartColor(s.color || si + 1)} stop-opacity="0.4" /><stop offset="95%" stop-color={chartColor(s.color || si + 1)} stop-opacity="0.04" /></linearGradient>)}</defs>
        {axes(max, 4, w, height, M, format, hideYAxis)}
        {data.map((d, i) => i % every === 0 && <text key={i} className="oc-chart__tick" x={x(i)} y={height - 6} text-anchor={i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"}>{xFormat ? xFormat(d[xKey]) : d[xKey]}</text>)}
        {hover != null && <line className="oc-chart__cursor-line" x1={x(hover)} x2={x(hover)} y1={M.t} y2={M.t + innerH} />}
        {series.map((s, si) => {
          const pts = data.map((d, i): [number, number] => [x(i), y(Number(d[s.key]) || 0)]);
          const path = monotonePath(pts);
          const c = chartColor(s.color || si + 1);
          return (
            <g key={s.key}>
              {!line && <path d={path + "L" + x(data.length - 1) + "," + y(0) + "L" + x(0) + "," + y(0) + "Z"} fill={"url(#" + ids[si] + ")"} />}
              <path d={path} fill="none" stroke={c} stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
              {dots && pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="3" fill={c} />)}
              {hover != null && <circle className="oc-chart__dot" cx={pts[hover][0]} cy={pts[hover][1]} r="4.5" fill={c} />}
            </g>
          );
        })}
      </svg>
      {hover != null && <ChartTip x={x(hover)} y={M.t} width={w} label={xFormat ? xFormat(data[hover][xKey]) : data[hover][xKey]} format={format}
        rows={series.map((s, si) => ({ key: s.key, label: s.label || s.key, value: data[hover][s.key], color: chartColor(s.color || si + 1) }))} />}
      {legend && series.length > 1 && <ChartLegend items={series.map((s, si) => ({ key: s.key, label: s.label || s.key, color: chartColor(s.color || si + 1) }))} />}
    </div>
  );
}
