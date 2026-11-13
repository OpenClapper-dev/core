// Port of guidelines/boundaries.card.html.
import { Pair } from "../../kit";

const EDGES: [label: string, border: string, color: string][] = [
  ["control", "1px solid var(--border-control)", "var(--text-secondary)"],
  ["divider", "1px solid var(--border-divider)", "var(--text-secondary)"],
  ["window", "1px solid var(--border-window)", "var(--text-secondary)"],
  ["focused", "1px solid var(--border-window-focused)", "var(--text-secondary)"],
  ["disabled", "1px dashed var(--border-control)", "var(--text-disabled)"],
];

function Demo() {
  return (
    <div className="r" style={{ margin: 0 }}>
      {EDGES.map(([label, border, color]) => (
        <span key={label} style={{ display: "grid", placeItems: "center", width: 68, height: 44, border, borderRadius: 4, font: "10px var(--font-mono)", color }}>{label}</span>
      ))}
    </div>
  );
}

export default function Card() { return <Pair Demo={Demo} />; }
