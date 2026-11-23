// Port of guidelines/sans-scale.card.html.
const STEPS: [label: string, token: string, weight: number, sample: string][] = [
  ["3xl · 32", "3xl", 700, "Scouting · day 3"],
  ["2xl · 24", "2xl", 700, "Project picker heading"],
  ["xl · 18", "xl", 700, "Dialog title"],
  ["lg · 15", "lg", 700, "Section heading"],
  ["md · 13", "md", 400, "Body, labels and controls. The default size in a window."],
  ["sm · 12", "sm", 400, "Secondary text, chips, table meta"],
  ["2xs · 11", "2xs", 500, "Badges, shortcut hints, status bar"],
];

export default function Card() {
  return (
    <div className="one" style={{ display: "grid", gap: 6 }}>
      {STEPS.map(([label, token, weight, sample]) => (
        <div key={token} style={{ display: "grid", gridTemplateColumns: "110px 1fr", alignItems: "baseline" }}>
          <span className="oc-num oc-meta">{label}</span>
          <span style={{ fontSize: `var(--font-size-${token})`, fontWeight: weight, lineHeight: 1.15 }}>{sample}</span>
        </div>
      ))}
    </div>
  );
}
