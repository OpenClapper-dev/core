// Port of guidelines/elevation.card.html.
import type { ComponentChildren } from "preact";
import { Pair } from "../../kit";

const LEVELS: [label: ComponentChildren, border: string, shadow: string][] = [
  ["window", "border-window", "shadow-window"],
  [<>window<br />focused</>, "border-window-focused", "shadow-window-focused"],
  ["menu", "border-control", "shadow-menu"],
  ["toast", "border-control", "shadow-toast"],
];

function Demo() {
  return (
    <div className="r" style={{ gap: 18, margin: "6px 0 0", background: "var(--bg-desktop)", padding: "18px 14px 22px" }}>
      {LEVELS.map(([label, border, shadow]) => (
        <span key={shadow} style={{ display: "grid", placeItems: "center", width: 58, height: 44, background: "var(--surface)", border: `1px solid var(--${border})`, borderRadius: "var(--radius-window)", boxShadow: `var(--${shadow})`, font: "9px var(--font-mono)", color: "var(--text-secondary)", textAlign: "center" }}>
          <span>{label}</span>
        </span>
      ))}
    </div>
  );
}

export default function Card() { return <Pair Demo={Demo} />; }
