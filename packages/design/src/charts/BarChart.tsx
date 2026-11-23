import type { JSX } from "preact";
import { useState } from "preact/hooks";
import { ChartLegend, ChartTip, chartColor, fmtDefault, niceMax, useWidth, type ChartDatum, type ChartSeries } from "./chartKit";

function axes(max: number, ticks: number, w: number, H: number, M: { t: number; r: number; b: number; l: number }, fmt: (v: number) => string, hideY?: boolean) {
  const out: JSX.Element[] = [];
  for (let i = 0; i <= ticks; i++) {
    const v = (max / ticks) * i, y = M.t + (H - M.t - M.b) * (1 - i / ticks);
    out.push(<line key={"g" + i} className="oc-chart__grid" x1={M.l} x2={w - M.r} y1={y} y2={y} />);
    if (!hideY) out.push(<text key={"t" + i} className="oc-chart__tick oc-chart__tick--num" x={M.l - 8} y={y} dy="0.32em" text-anchor="end">{fmt(v)}</text>);
  }
  return out;
}

/** Vertical bars per category, grouped or stacked, with a hover cursor and tooltip. */
export interface BarChartProps {
  data: ChartDatum[];
  xKey?: string;
  series: ChartSeries[];
  height?: number;
  stacked?: boolean;
  hideYAxis?: boolean;
  legend?: boolean;
  format?: (v: number) => string;
  xFormat?: (v: any) => string;
  className?: string;
}

export function BarChart({ data = [], xKey = "x", series = [], height = 220, stacked, hideYAxis, legend = true, format = fmtDefault, xFormat, className }: BarChartProps) {
  const [ref, w] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const M = { t: 8, r: 4, b: 24, l: hideYAxis ? 4 : 44 };
  const totals = data.map(d => stacked ? series.reduce((s, x) => s + (Number(d[x.key]) || 0), 0) : Math.max(0, ...series.map(x => Number(d[x.key]) || 0)));
  const max = niceMax(Math.max(0, ...totals));
  const innerW = Math.max(1, w - M.l - M.r), innerH = height - M.t - M.b;
  const band = innerW / Math.max(1, data.length), pad = Math.min(16, band * 0.2);
  const groupW = band - pad * 2, barW = stacked ? groupW : Math.max(2, (groupW - (series.length - 1) * 4) / Math.max(1, series.length));
  const y = (v: number) => M.t + innerH * (1 - v / max);
  const r = Math.min(4, barW / 2);
  const bar = (x0: number, y0: number, bw: number, bh: number, top: boolean) => bh <= 0 ? "" : top
    ? "M" + x0 + "," + (y0 + bh) + "V" + (y0 + r) + "Q" + x0 + "," + y0 + " " + (x0 + r) + "," + y0 + "H" + (x0 + bw - r) + "Q" + (x0 + bw) + "," + y0 + " " + (x0 + bw) + "," + (y0 + r) + "V" + (y0 + bh) + "Z"
    : "M" + x0 + "," + y0 + "h" + bw + "v" + bh + "h" + (-bw) + "Z";
  return (
    <div ref={ref} className={"oc-chart" + (className ? " " + className : "")} onMouseLeave={() => setHover(null)}>
      <svg width={w} height={height} role="img" aria-label="Bar chart">
        {axes(max, 4, w, height, M, format, hideYAxis)}
        {hover != null && <rect className="oc-chart__cursor" x={M.l + band * hover} y={M.t} width={band} height={innerH} rx="4" />}
        {data.map((d, i) => {
          const gx = M.l + band * i + pad;
          let acc = 0;
          return (
            <g key={i}>
              {series.map((s, si) => {
                const v = Number(d[s.key]) || 0;
                if (stacked) { const y1 = y(acc + v), bh = y(acc) - y1; acc += v; return <path key={s.key} d={bar(gx, y1, barW, bh, si === series.length - 1)} fill={chartColor(s.color || si + 1)} />; }
                const y1 = y(v);
                return <path key={s.key} d={bar(gx + si * (barW + 4), y1, barW, y(0) - y1, true)} fill={chartColor(s.color || si + 1)} />;
              })}
              <text className="oc-chart__tick" x={M.l + band * i + band / 2} y={height - 6} text-anchor="middle">{xFormat ? xFormat(d[xKey]) : d[xKey]}</text>
              <rect x={M.l + band * i} y={M.t} width={band} height={innerH} fill="transparent" onMouseEnter={() => setHover(i)} />
            </g>
          );
        })}
      </svg>
      {hover != null && <ChartTip x={M.l + band * hover + band / 2} y={M.t} width={w} label={xFormat ? xFormat(data[hover][xKey]) : data[hover][xKey]} format={format}
        rows={series.map((s, si) => ({ key: s.key, label: s.label || s.key, value: data[hover][s.key], color: chartColor(s.color || si + 1) }))} />}
      {legend && series.length > 1 && <ChartLegend items={series.map((s, si) => ({ key: s.key, label: s.label || s.key, color: chartColor(s.color || si + 1) }))} />}
    </div>
  );
}
