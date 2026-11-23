// Port of components/charts/charts.card.html.
import { AreaChart, Badge, BarChart, Card as DsCard, DonutChart } from "@openclapper/design";
import { Pair } from "../../kit";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d, i) => ({ day: d, ext: [42, 57, 38, 64, 71, 22, 15][i], int: [18, 24, 31, 20, 26, 12, 9][i] }));
const MONTHS = ["Jun", "Jul", "Aug", "Sep", "Oct", "Nov"].map((m, i) => ({ m, gb: [4.2, 7.9, 12.4, 18.1, 27.6, 41.0][i], prev: [3.1, 5.0, 8.8, 11.2, 15.9, 22.4][i] }));
const SPLIT = [{ name: "Photos", value: 312 }, { name: "Shots", value: 96 }, { name: "Sketches", value: 48 }, { name: "Timelines", value: 12 }];

function Demo() {
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <DsCard title="Shots per day" actions={<Badge tone="success" icon="arrow-up">12 %</Badge>}><BarChart xKey="day" height={160} series={[{ key: "ext", label: "Exterior" }, { key: "int", label: "Interior", color: 2 }]} data={DAYS} /></DsCard>
      <DsCard title="Storage used"><AreaChart xKey="m" height={150} format={v => v + " GB"} series={[{ key: "gb", label: "This project" }, { key: "prev", label: "Last project", color: 2 }]} data={MONTHS} /></DsCard>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 12 }}>
        <DsCard title="Stacked"><BarChart xKey="day" height={140} stacked hideYAxis legend={false} series={[{ key: "ext", label: "Exterior" }, { key: "int", label: "Interior", color: 2 }]} data={DAYS} /></DsCard>
        <DsCard title="Files"><DonutChart size={140} data={SPLIT} centerLabel="Files" legend={false} /></DsCard>
      </div>
    </div>
  );
}

export default function Card() { return <Pair Demo={Demo} />; }
