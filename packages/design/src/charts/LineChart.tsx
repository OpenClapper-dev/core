import type { ChartDatum, ChartSeries } from "./chartKit";
import { AreaChart } from "./AreaChart";

/** AreaChart without fill; for comparing several series. */
export interface LineChartProps {
  data: ChartDatum[];
  xKey?: string;
  series: ChartSeries[];
  height?: number;
  dots?: boolean;
  hideYAxis?: boolean;
  legend?: boolean;
  format?: (v: number) => string;
  xFormat?: (v: any) => string;
  className?: string;
}

export function LineChart(props: LineChartProps) { return <AreaChart {...props} line />; }
