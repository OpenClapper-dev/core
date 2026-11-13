// Port of guidelines/accent-and-selection.card.html.
import { Pair } from "../../kit";

const TOKENS = ["accent", "accent-hover", "accent-pressed", "accent-tint", "selection", "selection-border", "focus", "marquee"];

function Demo() {
  return (
    <div className="sw" style={{ gridTemplateColumns: "repeat(4,minmax(0,1fr))" }}>
      {TOKENS.map((t) => <div key={t}><i style={{ background: `var(--${t})` }} /><b>{t}</b></div>)}
    </div>
  );
}

export default function Card() { return <Pair Demo={Demo} />; }
