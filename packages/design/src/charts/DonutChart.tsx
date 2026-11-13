import { useState } from "preact/hooks";
import { ChartLegend, chartColor, fmtDefault, type ChartDatum } from "./chartKit";

/** Parts of a whole as a ring with the total in the centre; hover shows one part. */
export interface DonutChartProps {
  data: ChartDatum[];
  nameKey?: string;
  valueKey?: string;
  size?: number;
  /** Ring thickness as a share of the radius. */
  thickness?: number;
  centerLabel?: string;
  centerValue?: string;
  legend?: boolean;
  format?: (v: number) => string;
  className?: string;
}

export function DonutChart({ data = [], nameKey = "name", valueKey = "value", size = 200, thickness = 0.32, centerLabel, centerValue, legend = true, format = fmtDefault, className }: DonutChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const total = data.reduce((s, d) => s + (Number(d[valueKey]) || 0), 0) || 1;
  const R0 = size / 2, r1 = R0 - 2, r0 = r1 * (1 - thickness), gap = data.length > 1 ? 0.012 : 0;
  let a = -Math.PI / 2;
  const arcs = data.map((d, i) => {
    const v = Number(d[valueKey]) || 0, span = (v / total) * Math.PI * 2;
    const s = a + gap, e = a + span - gap; a += span;
    const p = (r: number, t: number) => [R0 + r * Math.cos(t), R0 + r * Math.sin(t)];
    const large = e - s > Math.PI ? 1 : 0;
    const [x1, y1] = p(r1, s), [x2, y2] = p(r1, e), [x3, y3] = p(r0, e), [x4, y4] = p(r0, s);
    return { i, d: "M" + x1 + "," + y1 + "A" + r1 + "," + r1 + " 0 " + large + " 1 " + x2 + "," + y2 + "L" + x3 + "," + y3 + "A" + r0 + "," + r0 + " 0 " + large + " 0 " + x4 + "," + y4 + "Z", color: chartColor(d.color || i + 1) };
  });
  const cur = hover != null ? data[hover] : null;
  return (
    <div className={"oc-chart" + (className ? " " + className : "")} style={{ width: "auto" }} onMouseLeave={() => setHover(null)}>
      <svg width={size} height={size} style={{ margin: "0 auto" }} role="img" aria-label="Donut chart">
        {arcs.map(x => <path key={x.i} d={x.d} fill={x.color} opacity={hover == null || hover === x.i ? 1 : 0.35} onMouseEnter={() => setHover(x.i)} />)}
        <text className="oc-chart__center" x={R0} y={R0} dy="0.1em" text-anchor="middle">{cur ? format(cur[valueKey]) : centerValue != null ? centerValue : format(total)}</text>
        <text className="oc-chart__center-sub" x={R0} y={R0 + 20} text-anchor="middle">{cur ? cur[nameKey] : centerLabel || "Total"}</text>
      </svg>
      {legend && <ChartLegend items={data.map((d, i) => ({ key: String(i), label: d[nameKey], color: chartColor(d.color || i + 1) }))} />}
    </div>
  );
}
