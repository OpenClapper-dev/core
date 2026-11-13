// Port of guidelines/categorical.card.html.
import { Pair } from "../../kit";

const TOKENS = ["cat-1", "cat-2", "cat-3", "cat-4", "cat-5", "cat-6", "cat-7", "cat-8"];

function Demo() {
  return (
    <div className="sw" style={{ gridTemplateColumns: "repeat(8,minmax(0,1fr))" }}>
      {TOKENS.map((t) => <div key={t}><i style={{ background: `var(--${t})` }} /><b>{t}</b></div>)}
    </div>
  );
}

export default function Card() { return <Pair Demo={Demo} />; }
