// Port of guidelines/radii-and-borders.card.html.
import type { JSX } from "preact";

const control = "1px solid var(--border-control)";
const SHAPES: [label: string, style: JSX.CSSProperties][] = [
  ["xs · 3", { border: control, borderRadius: "var(--radius-xs)" }],
  ["control · 4", { border: control, borderRadius: "var(--radius-control)" }],
  ["window · 6", { border: control, borderRadius: "var(--radius-window)" }],
  ["pill · 999", { border: control, borderRadius: "var(--radius-pill)" }],
  ["strong · 2", { border: "var(--border-w-strong) solid var(--text)", borderRadius: "var(--radius-control)" }],
  ["focus · 2 + 1", { border: "1px solid var(--focus)", outline: "var(--focus-w) solid var(--focus)", outlineOffset: "var(--focus-offset)", borderRadius: "var(--radius-control)" }],
];

export default function Card() {
  return (
    <div className="one r" style={{ gap: 16, margin: 0 }}>
      {SHAPES.map(([label, style]) => (
        <span key={label} style={{ display: "grid", gap: 6 }}>
          <i style={{ display: "block", width: 72, height: 40, ...style }} />
          <span className="oc-num oc-meta">{label}</span>
        </span>
      ))}
    </div>
  );
}
