// Port of guidelines/states.card.html.
import { Pair } from "../../kit";

const TOKENS = ["success", "success-tint", "warning", "warning-tint", "danger", "danger-tint"];

function Demo() {
  return (
    <div className="sw" style={{ gridTemplateColumns: "repeat(6,minmax(0,1fr))" }}>
      {TOKENS.map((t) => <div key={t}><i style={{ background: `var(--${t})` }} /><b>{t}</b></div>)}
    </div>
  );
}

export default function Card() { return <Pair Demo={Demo} />; }
