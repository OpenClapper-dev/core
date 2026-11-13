// Port of guidelines/text.card.html.
import { Pair } from "../../kit";

const chip = { padding: "2px 6px", borderRadius: 3 };

function Demo() {
  return (
    <div style={{ display: "grid", gap: 4, fontSize: 13 }}>
      <span>text · body and labels, 7:1</span>
      <span style={{ color: "var(--text-secondary)" }}>text-secondary · meta, 4.5:1</span>
      <span style={{ color: "var(--text-disabled)" }}>text-disabled · with a dashed edge</span>
      <span style={{ display: "flex", gap: 6 }}>
        <span style={{ ...chip, background: "var(--surface-inverse)", color: "var(--text-inverse)" }}>text-inverse</span>
        <span style={{ ...chip, background: "var(--accent)", color: "var(--text-on-accent)" }}>text-on-accent</span>
      </span>
    </div>
  );
}

export default function Card() { return <Pair Demo={Demo} />; }
