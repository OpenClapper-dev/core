// Port of guidelines/film-glyphs.card.html. The custom glyphs are every GLYPHS entry with source "custom"; the Tabler
// name shown for the covered concepts is read from GLYPHS. Labels are the card's own data.
import { GLYPHS, Icon, type IconName } from "@openclapper/design";
import { L } from "../../kit";

const LABELS: Partial<Record<IconName, string>> = {
  "framing": "Frame lines, framing guide", "sensor-size": "Sensor size, crop", "focal-reducer": "Focal reducer, adapter",
  "light-fixture": "Light fixture on stand", "camera-layout": "Camera layout, control bars", "slate": "Slate, take",
  "zebra": "Zebra, overexposure", "anamorphic": "Anamorphic desqueeze",
};
const CUSTOM = (Object.keys(GLYPHS) as IconName[]).filter((n) => GLYPHS[n][0] === "custom");
const TABLER: [IconName, string][] = [
  ["thirds", "Rule of thirds"], ["aspect", "Aspect ratio"], ["crop-wide", "16:9 crop"], ["exposure", "Exposure"],
  ["histogram", "Histogram"], ["focus-assist", "Focus assist"], ["color-temp", "Colour temperature"], ["camera-settings", "Camera settings"],
  ["practical", "Practical light"], ["lens", "Lens, focal length"], ["film", "Shot, clip"], ["drone", "Drone"],
];

const gridStyle = { display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: "2px 16px" };

function Item({ n, label, custom }: { n: IconName; label: string; custom?: boolean }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "auto auto auto minmax(0,1fr)", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: "1px solid var(--border-divider)", color: "var(--text)", font: "400 13px/1.25 var(--font-sans)" }}>
      <Icon name={n} size={16} /><Icon name={n} size={20} /><Icon name={n} size={24} />
      <span>{label}<small style={{ display: "block", color: custom ? "var(--accent)" : "var(--text-secondary)", font: "400 12px/1.25 var(--font-mono)" }}>{custom ? "custom · " + n : GLYPHS[n][0]}</small></span>
    </div>
  );
}

export default function Card() {
  return (
    <div className="half" data-theme="light" style={{ width: "100%" }}>
      <L>custom · not covered by Tabler · 24 grid, 2 px stroke, round caps and joins, outline · assets/icons/film/</L>
      <div style={gridStyle}>{CUSTOM.map((n) => <Item key={n} n={n} label={LABELS[n] ?? n} custom />)}</div>
      <L>covered by Tabler · alias → tabler name</L>
      <div style={gridStyle}>{TABLER.map(([n, l]) => <Item key={n} n={n} label={l} />)}</div>
    </div>
  );
}
